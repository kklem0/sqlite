/**
 * The four properties of `importDatabase` that are not about the happy path (PLAN 16.4, 16.5,
 * 16.7 items 1, 7, 9, 10), plus `getWebStoreInfo`.
 *
 * These are the ones that would go unnoticed if they regressed: memory that grows with the
 * download rather than with the chunk, a worker that stops answering while a bundle streams, a
 * crash mid-swap, and a browser that cannot report its quota.
 */
import { afterEach, describe, expect, test } from 'vitest';

import { SQLiteConnection } from '../../src/definitions';
import { CapacitorSQLiteWeb } from '../../src/web';
import type { Tier } from '../../src/web/protocol';
import { IMAGE_STORE_NAME, IMAGE_STORE_VERSION, META_STORE_NAME, imageStoreDbName } from '../../src/web/protocol';
import { SWAP_MARKER, isStagingName, stagingName } from '../../src/web/worker/import-database';
import { setSqliteWebOptions, setSqliteWorkerFactory } from '../../src/web/worker-factory';

import { TIERS, stopHarness, tierLabel } from './harness';

setSqliteWorkerFactory(
  () => new Worker(new URL('../../src/web/worker/worker.ts', import.meta.url), { type: 'module' }),
);

const open: CapacitorSQLiteWeb[] = [];
let poolCounter = 0;

async function boot(tier: Tier, pool: string): Promise<CapacitorSQLiteWeb> {
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

async function bundleBytes(plugin: CapacitorSQLiteWeb, rows: number): Promise<Uint8Array> {
  const sqlite = new SQLiteConnection(plugin);
  const db = await sqlite.createConnection('__src', false, 'no-encryption', 1, false);
  await db.open();
  await db.execute('CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY, body TEXT);');
  await db.execute('DELETE FROM pages;', false);
  // Through the plugin's own transaction API, so the engine knows one is open and `run` does not
  // try to start a second.
  await db.beginTransaction();
  for (let i = 0; i < rows; i++) await db.run('INSERT INTO pages (body) VALUES (?)', [`p${i}`.padEnd(4000, '.')]);
  await db.commitTransaction();
  const bytes = (await (plugin as any).client.call('exportDb', { database: '__src' })).bytes as Uint8Array;
  await sqlite.closeConnection('__src', false);
  return bytes;
}

function streamOf(bytes: Uint8Array, chunk: number, onChunk?: (sent: number) => Promise<void> | void) {
  let offset = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        const slice = bytes.slice(offset, Math.min(offset + chunk, bytes.byteLength));
        offset += slice.byteLength;
        if (onChunk) await onChunk(offset);
        controller.enqueue(slice);
      },
    },
    new CountQueuingStrategy({ highWaterMark: 0 }),
  );
}

const heap = (plugin: CapacitorSQLiteWeb) => (plugin as any).client.call('wasmHeapSize', {}).then((r: any) => r.bytes);

afterEach(async () => {
  await Promise.all(open.splice(0).map((plugin) => plugin.closeWebStore()));
  await stopHarness();
});

describe('streaming keeps its promises', () => {
  test('the wasm heap does not grow with the size of the import', async () => {
    // The one memory figure a worker can measure about itself (PLAN 10.1 S9), and the same one
    // M0 row 2 used to show the chunked path flat at 21,037,056 B while 65 MiB streamed through.
    poolCounter += 1;
    const plugin = await boot(1, `impc-${poolCounter}-heap`);
    const bytes = await bundleBytes(plugin, 2000); // several MiB
    expect(bytes.byteLength).toBeGreaterThan(4 * 1024 * 1024);

    const before = await heap(plugin);
    const samples: number[] = [];
    await plugin.importDatabase({
      database: 'big',
      source: streamOf(bytes, 256 * 1024, async () => {
        samples.push(await heap(plugin));
      }),
    });
    const after = await heap(plugin);

    expect(samples.length).toBeGreaterThan(8);
    // Flat: no sample exceeds the starting heap by more than a couple of chunks, and certainly
    // not by the size of the file.
    const peak = Math.max(before, after, ...samples);
    expect(peak - before).toBeLessThan(4 * 1024 * 1024);
    expect(peak - before).toBeLessThan(bytes.byteLength / 2);
  });

  test('the worker keeps answering queries about other databases while a bundle streams', async () => {
    poolCounter += 1;
    const plugin = await boot(1, `impc-${poolCounter}-busy`);
    const bytes = await bundleBytes(plugin, 800);

    // The app's current edition, open and being read throughout.
    const sqlite = new SQLiteConnection(plugin);
    const current = await sqlite.createConnection('current', false, 'no-encryption', 1, false);
    await current.open();
    await current.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);');
    await current.run('INSERT INTO t (v) VALUES (?)', ['served']);

    let served = 0;
    await plugin.importDatabase({
      database: 'incoming',
      source: streamOf(bytes, 128 * 1024, async () => {
        const rows = await current.query('SELECT v FROM t');
        expect(rows.values?.[0].v).toBe('served');
        served += 1;
      }),
    });

    // Every chunk boundary was an interleaving point, and every query got through.
    expect(served).toBeGreaterThan(8);
    await sqlite.closeConnection('current', false);
  });

  test('a second import of the same name is refused while the first is running', async () => {
    poolCounter += 1;
    const plugin = await boot(1, `impc-${poolCounter}-dup`);
    const bytes = await bundleBytes(plugin, 400);

    let second: Promise<any> | null = null;
    const first = plugin.importDatabase({
      database: 'once',
      source: streamOf(bytes, 64 * 1024, () => {
        // Fire the duplicate from inside the first import, so it lands mid-stream.
        second ??= plugin.importDatabase({ database: 'once', source: bytes }).catch((err) => err);
      }),
    });

    await expect(first).resolves.toMatchObject({ database: 'once' });
    await expect(second).resolves.toMatchObject({ code: 'IMPORT_IN_PROGRESS' });
  });

  test('reads of the target during publish are refused by name, not by a vaguer error', async () => {
    poolCounter += 1;
    const plugin = await boot(1, `impc-${poolCounter}-publish`);
    const bytes = await bundleBytes(plugin, 200);
    await plugin.importDatabase({ database: 'edition', source: bytes });

    const attempts: any[] = [];
    const listener = await plugin.addListener('sqliteImportDatabaseProgressEvent', async (event: any) => {
      if (event.phase !== 'publishing') return;
      // Racing the destructive window on purpose.
      attempts.push(await plugin.isDatabase({ database: 'edition' }).catch((err) => err));
    });

    await plugin.importDatabase({ database: 'edition', source: bytes, overwrite: true });
    await listener.remove();

    expect(attempts.length).toBeGreaterThan(0);
    // Either the gate refused it, or it arrived after the window closed and was answered truthfully.
    for (const attempt of attempts) {
      if (attempt instanceof Error) expect((attempt as any).code).toBe('IMPORT_IN_PROGRESS');
      else expect(attempt).toEqual({ result: true });
    }
  });
});

describe('interruption', () => {
  test('pausing the store mid-import rejects, spares the target, and the orphan is swept', async () => {
    poolCounter += 1;
    const pool = `impc-${poolCounter}-pause`;
    const plugin = await boot(1, pool);
    const bytes = await bundleBytes(plugin, 600);
    await plugin.importDatabase({ database: 'edition', source: bytes });
    const rowsBefore = await countRows(plugin, 'edition');

    let paused = false;
    const attempt = plugin.importDatabase({
      database: 'edition',
      overwrite: true,
      source: streamOf(bytes, 64 * 1024, async (sent) => {
        if (!paused && sent > bytes.byteLength / 3) {
          paused = true;
          await plugin.pauseWebStore();
        }
      }),
    });
    await expect(attempt).rejects.toThrow();

    await plugin.resumeWebStore();
    // The edition the app was serving is exactly as it was.
    expect(await countRows(plugin, 'edition')).toBe(rowsBefore);
    await plugin.closeWebStore();

    // A staging file may well survive a paused VFS. The init sweep owns it (PLAN 16.5).
    const next = await boot(1, pool);
    expect((await next.getDatabaseList()).values.filter((n: string) => isStagingName(n))).toEqual([]);
    expect(await countRows(next, 'edition')).toBe(rowsBefore);
  });

  test('an interrupted swap is completed at the next init', async () => {
    poolCounter += 1;
    const pool = `impc-${poolCounter}-swap`;
    const plugin = await boot(2, pool); // tier 2: the store is reachable from the test
    const bytes = await bundleBytes(plugin, 50);
    await plugin.importDatabase({ database: 'edition', source: bytes });
    const rows = await countRows(plugin, 'edition');
    await plugin.closeWebStore();

    // Exactly the state a crash between "unlink the target" and "publish" leaves behind.
    const storage = 'editionSQLite.db';
    const image = await readImage(pool, storage);
    expect(image).toBeTruthy();
    await writeImage(pool, stagingName(storage), image as Uint8Array);
    await deleteImage(pool, storage);
    await writeMeta(pool, SWAP_MARKER, { storage, staging: stagingName(storage) });

    const recovered = await boot(2, pool);
    // init finished the swap rather than leaving the app with nothing, and left no staging file.
    const listed = (await recovered.getDatabaseList()).values;
    expect(listed).toContain(storage);
    expect(listed.filter((n: string) => isStagingName(n))).toEqual([]);
    expect(await countRows(recovered, 'edition')).toBe(rows);
    expect(await readMeta(pool, SWAP_MARKER)).toBeFalsy();
  });
});

describe.each(TIERS)('%s', (tier) => {
  const label = tierLabel(tier);

  test(`${label}: getWebStoreInfo reports the tier and the engine`, async () => {
    poolCounter += 1;
    const pool = `impc-${poolCounter}-info`;
    const plugin = await boot(tier, pool);
    const info = await plugin.getWebStoreInfo();

    expect(info.tier).toBe(tier);
    expect(info.persistence).toBe(tier === 1 ? 'opfs' : 'indexeddb');
    expect(info.sqliteVersion).toMatch(/^3\./);
    expect(info.poolName).toBe(pool);
    expect(info.directory).toBe(`.${pool}`);
    if (tier === 2) expect(info.fallbackReason).toBeTruthy();
    else expect(info.fallbackReason).toBeUndefined();
  });

  test(`${label}: quota and usage are absent where the browser cannot report them`, async () => {
    poolCounter += 1;
    const plugin = await boot(tier, `impc-${poolCounter}-noestimate`);
    // What iOS 16.4 looks like (PLAN 12.3 F4). The worker has its own navigator, so the stub goes
    // through a worker-side flag rather than the main thread's global.
    const stubbed = await (plugin as any).client.call('getWebStoreInfo', { simulateNoEstimate: true });
    expect(stubbed.quota).toBeUndefined();
    expect(stubbed.usage).toBeUndefined();
    expect(stubbed.tier).toBe(tier);
    expect(stubbed.sqliteVersion).toMatch(/^3\./);

    // And where it does exist, the numbers come through.
    const real = await plugin.getWebStoreInfo();
    expect(typeof real.quota).toBe('number');
    expect(typeof real.usage).toBe('number');
  });
});

async function countRows(plugin: CapacitorSQLiteWeb, database: string): Promise<number> {
  const sqlite = new SQLiteConnection(plugin);
  const db = await sqlite.createConnection(database, false, 'no-encryption', 1, false);
  await db.open();
  const n = Number((await db.query('SELECT count(*) AS n FROM pages')).values?.[0].n);
  await sqlite.closeConnection(database, false);
  return n;
}

function idb<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openStore(pool: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(imageStoreDbName(pool), IMAGE_STORE_VERSION);
    req.onupgradeneeded = () => {
      for (const store of [IMAGE_STORE_NAME, META_STORE_NAME]) {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readImage(pool: string, key: string): Promise<Uint8Array | null> {
  const db = await openStore(pool);
  const value = await idb<any>(db.transaction(IMAGE_STORE_NAME, 'readonly').objectStore(IMAGE_STORE_NAME).get(key));
  db.close();
  return value ?? null;
}

async function writeImage(pool: string, key: string, bytes: Uint8Array): Promise<void> {
  const db = await openStore(pool);
  await idb(db.transaction(IMAGE_STORE_NAME, 'readwrite').objectStore(IMAGE_STORE_NAME).put(bytes, key));
  db.close();
}

async function deleteImage(pool: string, key: string): Promise<void> {
  const db = await openStore(pool);
  await idb(db.transaction(IMAGE_STORE_NAME, 'readwrite').objectStore(IMAGE_STORE_NAME).delete(key));
  db.close();
}

async function writeMeta(pool: string, key: string, value: unknown): Promise<void> {
  const db = await openStore(pool);
  await idb(db.transaction(META_STORE_NAME, 'readwrite').objectStore(META_STORE_NAME).put(value, key));
  db.close();
}

async function readMeta(pool: string, key: string): Promise<any> {
  const db = await openStore(pool);
  const value = await idb<any>(db.transaction(META_STORE_NAME, 'readonly').objectStore(META_STORE_NAME).get(key));
  db.close();
  return value;
}
