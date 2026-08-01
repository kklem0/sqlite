/**
 * `importDatabase` (PLAN 16).
 *
 * The consumer this is designed against downloads multi-MB read-only bundles with its own
 * authenticated, resumable fetch and hands the stream over. So the properties that matter are:
 * the app never has to hold the download, a failed download cannot damage the edition already
 * installed, and the app keeps serving queries while the next edition arrives.
 */
import { afterEach, describe, expect, test } from 'vitest';

import { SQLiteConnection } from '../../src/definitions';
import { CapacitorSQLiteWeb } from '../../src/web';
import type { Tier } from '../../src/web/protocol';
import { setSqliteWebOptions, setSqliteWorkerFactory } from '../../src/web/worker-factory';

import { TIERS, stopHarness, tierLabel } from './harness';

setSqliteWorkerFactory(
  () => new Worker(new URL('../../src/web/worker/worker.ts', import.meta.url), { type: 'module' }),
);

const open: CapacitorSQLiteWeb[] = [];
let poolCounter = 0;

async function boot(tier: Tier, suffix: string): Promise<CapacitorSQLiteWeb> {
  poolCounter += 1;
  const pool = `imp-${poolCounter}-${suffix}`;
  setSqliteWebOptions({
    forceTier2: tier === 2,
    simulateInstallError: undefined,
    skipJeepMigration: true,
    poolName: pool,
    directory: `.${pool}`,
  });
  const plugin = new CapacitorSQLiteWeb();
  open.push(plugin);
  await new SQLiteConnection(plugin).initWebStore();
  return plugin;
}

/** A real database, exported to bytes, which is what a downloaded bundle looks like. */
async function bundleBytes(plugin: CapacitorSQLiteWeb, rows = 50): Promise<Uint8Array> {
  const sqlite = new SQLiteConnection(plugin);
  const db = await sqlite.createConnection('__source', false, 'no-encryption', 1, false);
  await db.open();
  await db.execute('CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY, body TEXT);');
  await db.execute('DELETE FROM pages;', false);
  for (let i = 0; i < rows; i++) await db.run('INSERT INTO pages (body) VALUES (?)', [`page ${i}`.padEnd(2000, '.')]);
  await db.execute('PRAGMA user_version = 7;', false);
  const bytes = (await (plugin as any).client.call('exportDb', { database: '__source' })).bytes as Uint8Array;
  await sqlite.closeConnection('__source', false);
  await plugin.deleteDatabaseByName?.('__source').catch?.(() => undefined);
  return bytes;
}

function streamOf(bytes: Uint8Array, chunk = 64 * 1024): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, Math.min(offset + chunk, bytes.byteLength)));
      offset += chunk;
    },
  });
}

async function rowCount(plugin: CapacitorSQLiteWeb, database: string): Promise<number> {
  const sqlite = new SQLiteConnection(plugin);
  const db = await sqlite.createConnection(database, false, 'no-encryption', 1, false);
  await db.open();
  const n = (await db.query('SELECT count(*) AS n FROM pages')).values?.[0].n;
  await sqlite.closeConnection(database, false);
  return Number(n);
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((plugin) => plugin.closeWebStore()));
  await stopHarness();
});

describe.each(TIERS)('%s', (tier) => {
  const label = tierLabel(tier);

  test(`${label}: a streamed bundle becomes a queryable database`, async () => {
    const plugin = await boot(tier, 'stream');
    const bytes = await bundleBytes(plugin);

    const result = await plugin.importDatabase({ database: 'bundle', source: streamOf(bytes) });
    expect(result).toEqual({ database: 'bundle', bytes: bytes.byteLength, replaced: false });

    expect((await plugin.getDatabaseList()).values).toContain('bundleSQLite.db');
    expect(await rowCount(plugin, 'bundle')).toBe(50);

    // VACUUM INTO carries user_version across, which the upgrade machinery keys off.
    const sqlite = new SQLiteConnection(plugin);
    const db = await sqlite.createConnection('bundle', false, 'no-encryption', 7, false);
    await db.open();
    expect((await db.getVersion()).version).toBe(7);
    await sqlite.closeConnection('bundle', false);
  });

  test(`${label}: Uint8Array and Blob sources give the same result as a stream`, async () => {
    const plugin = await boot(tier, 'sources');
    const bytes = await bundleBytes(plugin, 20);

    await plugin.importDatabase({ database: 'fromBytes', source: bytes });
    await plugin.importDatabase({ database: 'fromBlob', source: new Blob([bytes]) });
    await plugin.importDatabase({ database: 'fromStream', source: streamOf(bytes) });

    expect(await rowCount(plugin, 'fromBytes')).toBe(20);
    expect(await rowCount(plugin, 'fromBlob')).toBe(20);
    expect(await rowCount(plugin, 'fromStream')).toBe(20);
  });

  test(`${label}: a name already taken is refused unless overwrite says otherwise`, async () => {
    const plugin = await boot(tier, 'taken');
    const bytes = await bundleBytes(plugin, 10);
    await plugin.importDatabase({ database: 'edition', source: bytes });

    await expect(plugin.importDatabase({ database: 'edition', source: bytes })).rejects.toThrow(/already exists/i);
    // And the refusal did not disturb what was there.
    expect(await rowCount(plugin, 'edition')).toBe(10);
  });

  test(`${label}: overwrite replaces the database, and a connection held across it keeps working`, async () => {
    const plugin = await boot(tier, 'overwrite');
    const first = await bundleBytes(plugin, 10);
    await plugin.importDatabase({ database: 'edition', source: first });

    // The reading app holds the current edition open while the next one downloads.
    const sqlite = new SQLiteConnection(plugin);
    const db = await sqlite.createConnection('edition', false, 'no-encryption', 1, false);
    await db.open();
    expect((await db.query('SELECT count(*) AS n FROM pages')).values?.[0].n).toBe(10);

    const second = await bundleBytes(plugin, 30);
    const result = await plugin.importDatabase({ database: 'edition', source: streamOf(second), overwrite: true });
    expect(result.replaced).toBe(true);

    // Same connection object, no reopen by the caller, now serving the new edition.
    expect((await db.query('SELECT count(*) AS n FROM pages')).values?.[0].n).toBe(30);
    await sqlite.closeConnection('edition', false);
  });

  test(`${label}: a truncated stream leaves the previous edition untouched`, async () => {
    const plugin = await boot(tier, 'truncated');
    const good = await bundleBytes(plugin, 25);
    await plugin.importDatabase({ database: 'edition', source: good });

    // A download that dies half way: a real SQLite header, then nothing more.
    const truncated = good.slice(0, Math.floor(good.byteLength / 2));
    await expect(
      plugin.importDatabase({ database: 'edition', source: streamOf(truncated), overwrite: true }),
    ).rejects.toThrow(/not a usable database|not a SQLite|Byte array size/i);

    expect(await rowCount(plugin, 'edition')).toBe(25);
    // And no staging file is left pretending to be a database.
    expect((await plugin.getDatabaseList()).values.filter((n: string) => n.includes('.importing'))).toEqual([]);
  });

  test(`${label}: bytes that are not a database at all are refused on the first chunk`, async () => {
    const plugin = await boot(tier, 'garbage');
    const good = await bundleBytes(plugin, 5);
    await plugin.importDatabase({ database: 'edition', source: good });

    await expect(
      plugin.importDatabase({ database: 'edition', source: new Uint8Array(4096).fill(7), overwrite: true }),
    ).rejects.toThrow(/SQLite header/i);
    expect(await rowCount(plugin, 'edition')).toBe(5);
  });

  test(`${label}: progress events report ordered phases and monotonic bytes`, async () => {
    const plugin = await boot(tier, 'progress');
    const bytes = await bundleBytes(plugin, 40);
    const seen: any[] = [];
    const handle = await plugin.addListener('sqliteImportDatabaseProgressEvent', (event: any) => seen.push(event));

    await plugin.importDatabase({ database: 'withProgress', source: streamOf(bytes, 16 * 1024) });
    await handle.remove();

    expect(seen.length).toBeGreaterThan(2);
    expect(seen.every((e) => e.database === 'withProgress')).toBe(true);
    expect(seen[0].phase).toBe('streaming');
    expect(seen[seen.length - 1].phase).toBe('done');
    expect(seen.map((e) => e.phase)).toContain('publishing');
    const loaded = seen.map((e) => e.loaded);
    expect(loaded).toEqual([...loaded].sort((a, b) => a - b));
    expect(loaded[loaded.length - 1]).toBe(bytes.byteLength);
    // A stream cannot report its length, so total is absent unless the caller supplies it.
    expect(seen.every((e) => e.total === undefined)).toBe(true);
  });

  test(`${label}: a sized source reports a total, and totalBytes fills it in for a stream`, async () => {
    const plugin = await boot(tier, 'total');
    const bytes = await bundleBytes(plugin, 10);

    const sized: any[] = [];
    let handle = await plugin.addListener('sqliteImportDatabaseProgressEvent', (e: any) => sized.push(e));
    await plugin.importDatabase({ database: 'sized', source: bytes });
    await handle.remove();
    expect(sized.every((e) => e.total === bytes.byteLength)).toBe(true);

    const told: any[] = [];
    handle = await plugin.addListener('sqliteImportDatabaseProgressEvent', (e: any) => told.push(e));
    await plugin.importDatabase({ database: 'told', source: streamOf(bytes), totalBytes: bytes.byteLength });
    await handle.remove();
    expect(told.every((e) => e.total === bytes.byteLength)).toBe(true);
  });

  test(`${label}: an open transaction on the target refuses the import before reading a byte`, async () => {
    const plugin = await boot(tier, 'txn');
    const bytes = await bundleBytes(plugin, 5);
    await plugin.importDatabase({ database: 'edition', source: bytes });

    const sqlite = new SQLiteConnection(plugin);
    const db = await sqlite.createConnection('edition', false, 'no-encryption', 1, false);
    await db.open();
    await db.beginTransaction();

    // highWaterMark 0 so the stream does not prefetch a chunk of its own accord: `pull` then runs
    // only when something actually reads, which is what the assertion below is about.
    let pulled = 0;
    const watched = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1;
          controller.enqueue(bytes.slice(0, 1024));
          controller.close();
        },
      },
      new CountQueuingStrategy({ highWaterMark: 0 }),
    );
    await expect(plugin.importDatabase({ database: 'edition', source: watched, overwrite: true })).rejects.toThrow(
      /open transaction/i,
    );
    expect(pulled).toBe(0);

    await db.rollbackTransaction();
    await sqlite.closeConnection('edition', false);
  });
});
