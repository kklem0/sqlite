/**
 * Worker entry: owns the wasm heap, the VFS, and every open database. The main thread never
 * touches any of them.
 *
 * Ops are dispatched from a single table and each one returns a plain, structured-cloneable
 * value. Anything that needs `changes()` or `last_insert_rowid()` reads them inside the same op
 * as the statement that produced them, so concurrent calls cannot interleave between the write
 * and the read.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

import { toErrorPayload } from '../errors';
import type { ExecResult, OpenArgs, WorkerInitArgs, WorkerInitResult, WorkerRequest } from '../protocol';
import { BOOT_ID, EVENT_ID, EV_EXPORT_PROGRESS, EV_IMPORT_PROGRESS } from '../protocol';

import { Connection, wantsRows } from './engine';
import { ImageStore, deserializeInto } from './images';
import { exportJson } from './json/export';
import { importJson } from './json/import';
import { isJsonSQLite, parseJsonSQLite } from './json/validate';
import { connKey, fromPoolPath, poolPath, reserveCapacity, storageName } from './paths';
import { selectTier } from './tiers';
import { runUpgrades } from './upgrades';

/**
 * The published types declare `init()` with no parameters, but the runtime export is an
 * Emscripten module factory and does accept a Module config: that is how `print`, `printErr`
 * and `locateFile` are wired. Narrow cast rather than a broad `any` on the import.
 */
interface Sqlite3InitConfig {
  print?: (...args: any[]) => void;
  printErr?: (...args: any[]) => void;
  locateFile?: (file: string) => string;
}
const initModule = sqlite3InitModule as unknown as (config?: Sqlite3InitConfig) => Promise<any>;

let sqlite3: any = null;
let poolUtil: any = null;
let tier: 1 | 2 = 2;
/** Constructed at init, because its IndexedDB name is derived from the configured pool name. */
let images = new ImageStore('capacitor-sqlite');
const connections = new Map<string, Connection>();

function requireInit(): void {
  if (!sqlite3) throw new Error('The SQLite worker is not initialised.');
}

/** Raise a plugin event. The facade forwards these to notifyListeners. */
function raise(event: string, data: any): void {
  self.postMessage({ id: EVENT_ID, event, data });
}

/**
 * importFromJson names its own target database, which may or may not already be open. Reuse an
 * open read-write connection when there is one so the caller keeps seeing its own data, and
 * otherwise open a scratch connection and close it again.
 */
async function withWritableConnection<T>(database: string, body: (conn: Connection) => Promise<T> | T): Promise<T> {
  const existing = connections.get(connKey(database, false));
  if (existing) return body(existing);

  const storage = storageName(database);
  const conn = tier === 1 ? openRaw(storage, false) : await openTier2(storage, false);
  try {
    const result = await body(conn);
    if (tier !== 1) await images.put(storage, conn.serialize());
    return result;
  } finally {
    if (conn.isOpen) conn.close();
  }
}

function connection(database: string, readonly: boolean): Connection {
  const conn = connections.get(connKey(database, readonly));
  if (!conn) throw new Error(`Database ${database} is not open`);
  return conn;
}

/** Every connection open on a database, whichever mode it was opened in. */
function connectionsFor(database: string): Connection[] {
  return [connections.get(connKey(database, false)), connections.get(connKey(database, true))].filter(
    (c): c is Connection => !!c,
  );
}

function openRaw(storage: string, readonly: boolean): Connection {
  if (tier === 1) {
    const db = new poolUtil.OpfsSAHPoolDb(storage, readonly ? 'r' : 'cw');
    return new Connection(storage, readonly, db, sqlite3);
  }
  // Tier 2 always opens writable: sqlite3_deserialize needs it. Read-only is applied after the
  // image is loaded, with PRAGMA query_only.
  return new Connection(storage, readonly, new sqlite3.oo1.DB(':memory:', 'c'), sqlite3);
}

async function openTier2(storage: string, readonly: boolean): Promise<Connection> {
  const image = await images.get(storage);
  if (!image && readonly) throw new Error(`Database ${storage} does not exist`);
  const conn = openRaw(storage, readonly);
  if (image) deserializeInto(sqlite3, conn.raw, image);
  if (readonly) conn.setQueryOnly(true);
  return conn;
}

async function flushIfTier2(conn: Connection): Promise<void> {
  if (tier !== 1 && !conn.isReadonly && conn.isOpen) {
    await images.put(conn.storage, conn.serialize());
  }
}

async function storedNames(): Promise<string[]> {
  if (tier === 1) return (poolUtil.getFileNames() as string[]).map(fromPoolPath);
  const names = new Set(await images.keys());
  for (const conn of connections.values()) names.add(conn.storage);
  return [...names].sort();
}

const ops: Record<string, (args: any) => any> = {
  async init(args: WorkerInitArgs): Promise<WorkerInitResult> {
    if (!sqlite3) {
      sqlite3 = await initModule({
        print: () => undefined,
        printErr: () => undefined,
        // Without an override the wasm is resolved next to this worker file, which is how the
        // shipped dist/web-worker.js + dist/sqlite3.wasm pair works.
        ...(args.wasmUrl ? { locateFile: () => args.wasmUrl as string } : {}),
      });
    }
    images = new ImageStore(args.poolName);
    const selection = await selectTier(sqlite3, args);
    tier = selection.tier;
    poolUtil = selection.poolUtil;
    if (tier === 1) await reserveCapacity(poolUtil, 4);
    return {
      tier,
      sqliteVersion: sqlite3.version.libVersion,
      ...(selection.fallbackReason ? { fallbackReason: selection.fallbackReason } : {}),
    };
  },

  async open({ database, readonly, version, upgrades }: OpenArgs) {
    requireInit();
    const key = connKey(database, readonly);
    if (connections.has(key)) return { alreadyOpen: true };
    const storage = storageName(database);

    let conn = tier === 1 ? openRaw(storage, readonly) : await openTier2(storage, readonly);

    let outcome = { upgraded: false, fromVersion: conn.userVersion(), toVersion: conn.userVersion(), changes: 0 };
    if (!readonly && upgrades && upgrades.length > 0) {
      try {
        outcome = runUpgrades(conn, upgrades, version, (image) => {
          conn.close();
          if (tier === 1) {
            poolUtil.importDb(poolPath(storage), image);
            conn = openRaw(storage, false);
          } else {
            conn = openRaw(storage, false);
            deserializeInto(sqlite3, conn.raw, image);
          }
        });
      } catch (err) {
        connections.set(key, conn);
        await flushIfTier2(conn);
        throw err;
      }
    } else if (!readonly && version > conn.userVersion()) {
      conn.setUserVersion(version);
      outcome = { upgraded: false, fromVersion: outcome.fromVersion, toVersion: version, changes: 0 };
    }

    connections.set(key, conn);
    if (outcome.upgraded) await flushIfTier2(conn);
    return outcome;
  },

  async close({ database, readonly }: { database: string; readonly: boolean }) {
    requireInit();
    const key = connKey(database, readonly);
    const conn = connections.get(key);
    if (!conn) return { closed: false };
    await flushIfTier2(conn);
    conn.close();
    connections.delete(key);
    return { closed: true };
  },

  async execute({
    database,
    readonly,
    statements,
    transaction,
  }: {
    database: string;
    readonly: boolean;
    statements: string;
    transaction: boolean;
  }): Promise<ExecResult> {
    const conn = connection(database, readonly);
    return conn.withOptionalTransaction(transaction, () => conn.executeBatch(statements));
  },

  async run({
    database,
    readonly,
    statement,
    values,
    transaction,
    returnMode,
  }: {
    database: string;
    readonly: boolean;
    statement: string;
    values?: any[];
    transaction: boolean;
    returnMode?: string;
  }): Promise<ExecResult> {
    const conn = connection(database, readonly);
    const result = conn.withOptionalTransaction(transaction, () =>
      conn.run(statement, values, wantsRows(statement, returnMode)),
    );
    if (returnMode === 'one' && result.values) result.values = result.values.slice(0, 1);
    return result;
  },

  async executeSet({
    database,
    readonly,
    set,
    transaction,
    returnMode,
  }: {
    database: string;
    readonly: boolean;
    set: { statement?: string; values?: any[] }[];
    transaction: boolean;
    returnMode?: string;
  }): Promise<ExecResult> {
    const conn = connection(database, readonly);
    return conn.withOptionalTransaction(transaction, () => {
      const collected: any[] = [];
      const out: ExecResult = { changes: 0, lastId: -1, values: collected };
      set.forEach((entry, index) => {
        const statement = entry?.statement;
        if (!statement) throw new Error(`ExecuteSet: no statement for index ${index}`);
        const rows = entry.values ?? [];
        // A set entry whose values are themselves arrays runs the statement once per row.
        const batches: any[][] = Array.isArray(rows[0]) ? (rows as any[][]) : [rows];
        for (const batch of batches) {
          const step = conn.run(statement, batch, wantsRows(statement, returnMode));
          out.changes += step.changes;
          out.lastId = step.lastId;
          // Flat array of row objects, matching the native implementations.
          if (step.values?.length) collected.push(...step.values);
        }
      });
      if (returnMode === 'one') out.values = collected.slice(0, 1);
      return out;
    });
  },

  async query({
    database,
    readonly,
    statement,
    values,
  }: {
    database: string;
    readonly: boolean;
    statement: string;
    values?: any[];
  }) {
    return { values: connection(database, readonly).query(statement, values) };
  },

  async beginTransaction({ database, readonly }: { database: string; readonly: boolean }) {
    connection(database, readonly).beginTransaction();
    return { changes: 0, lastId: -1 };
  },
  async commitTransaction({ database, readonly }: { database: string; readonly: boolean }) {
    const conn = connection(database, readonly);
    conn.commitTransaction();
    await flushIfTier2(conn);
    return { changes: 0, lastId: -1 };
  },
  async rollbackTransaction({ database, readonly }: { database: string; readonly: boolean }) {
    connection(database, readonly).rollbackTransaction();
    return { changes: 0, lastId: -1 };
  },
  async isTransactionActive({ database, readonly }: { database: string; readonly: boolean }) {
    return { result: connection(database, readonly).isTransactionActive };
  },

  async getVersion({ database, readonly }: { database: string; readonly: boolean }) {
    return { version: connection(database, readonly).userVersion() };
  },

  async isDBOpen({ database, readonly }: { database: string; readonly: boolean }) {
    const conn = connections.get(connKey(database, readonly));
    return { result: !!conn && conn.isOpen };
  },

  async isDatabase({ database }: { database: string }) {
    requireInit();
    const storage = storageName(database);
    if (tier === 1) return { result: (poolUtil.getFileNames() as string[]).includes(poolPath(storage)) };
    // On tier 1 a database exists from the moment it is opened. Tier 2 only writes its image at
    // a flush point, so an open connection counts as existing too, otherwise a freshly created
    // database would report false until it was closed.
    if (connectionsFor(database).length > 0) return { result: true };
    return { result: await images.has(storage) };
  },

  async isTableExists({ database, readonly, table }: { database: string; readonly: boolean; table: string }) {
    return { result: connection(database, readonly).tableExists(table) };
  },

  async getTableList({ database, readonly }: { database: string; readonly: boolean }) {
    return { values: connection(database, readonly).tableList() };
  },

  async getDatabaseList() {
    requireInit();
    return { values: await storedNames() };
  },

  async deleteDatabase({ database }: { database: string }) {
    requireInit();
    const storage = storageName(database);
    for (const conn of connectionsFor(database)) {
      conn.close();
      connections.delete(connKey(database, conn.isReadonly));
    }
    if (tier === 1) poolUtil.unlink(poolPath(storage));
    else await images.delete(storage);
    return {};
  },

  async saveToStore({ database }: { database: string }) {
    requireInit();
    if (tier === 1) return { flushed: false }; // always durable
    const conn = connections.get(connKey(database, false));
    if (!conn) throw new Error(`Database ${database} is not open`);
    await flushIfTier2(conn);
    return { flushed: true };
  },

  async exportDb({ database }: { database: string }) {
    requireInit();
    const storage = storageName(database);
    const conn = connections.get(connKey(database, false)) ?? connections.get(connKey(database, true));
    if (conn) return { bytes: conn.serialize() };
    if (tier === 1) return { bytes: poolUtil.exportFile(poolPath(storage)) };
    const image = await images.get(storage);
    if (!image) throw new Error(`Database ${database} does not exist`);
    return { bytes: image };
  },

  // ---------------------------------------------------------------- JSON pipeline

  async isJsonValid({ jsonstring }: { jsonstring: string }) {
    try {
      return { result: isJsonSQLite(JSON.parse(jsonstring)) };
    } catch {
      return { result: false };
    }
  },

  async importFromJson({ jsonstring }: { jsonstring: string }) {
    requireInit();
    const jsonData = parseJsonSQLite(jsonstring);
    if (jsonData.encrypted) {
      throw new Error('ImportFromJson: encrypted databases are not supported on the web platform');
    }
    const mode = jsonData.mode ?? 'full';
    const database = jsonData.database;
    const storage = storageName(database);

    // `overwrite` with a full import means start from an empty database, not merge into one.
    if (jsonData.overwrite && mode === 'full') {
      for (const conn of connectionsFor(database)) {
        conn.close();
        connections.delete(connKey(database, conn.isReadonly));
      }
      if (tier === 1) poolUtil.unlink(poolPath(storage));
      else await images.delete(storage);
    }

    const progress = (message: string) => raise(EV_IMPORT_PROGRESS, { progress: message });
    progress(`Start importing the database ${database}`);

    const changes = await withWritableConnection(database, (conn) => {
      // A full import into a database that already sits at the target version is a no-op, which
      // is what makes repeated imports of the same payload cheap.
      if (mode === 'full' && conn.tableList().length > 0) {
        const current = conn.userVersion();
        if (jsonData.version < current) {
          throw new Error(`ImportFromJson: Cannot import a version lower than ${current}`);
        }
        if (jsonData.version === current) return 0;
      }
      return importJson(conn, jsonData, progress);
    });

    progress(`Import completed, changes: ${changes}`);
    return { changes, lastId: -1 };
  },

  async exportToJson({
    database,
    readonly,
    jsonexportmode,
    encrypted,
  }: {
    database: string;
    readonly: boolean;
    jsonexportmode: string;
    encrypted?: boolean;
  }) {
    if (encrypted) {
      throw new Error('ExportToJson: encrypted export is not supported on the web platform');
    }
    const conn = connection(database, readonly);
    const progress = (message: string) => raise(EV_EXPORT_PROGRESS, { progress: message });
    const exported = exportJson(conn, database, jsonexportmode, progress);
    if (tier !== 1 && !conn.isReadonly) await images.put(conn.storage, conn.serialize());
    return { export: exported };
  },

  /**
   * pauseVfs throws SQLITE_MISUSE while any database is open, so the close-first sequence is
   * part of the op rather than something the caller has to remember. Wiring these to Capacitor
   * appStateChange is M4; the ops exist now so the worker side is done.
   */
  async pause() {
    requireInit();
    if (tier !== 1) return { paused: false, reopen: [] };
    const reopen: { database: string; readonly: boolean }[] = [];
    for (const [key, conn] of connections) {
      await flushIfTier2(conn);
      conn.close();
      reopen.push({ database: key.substring(3), readonly: conn.isReadonly });
    }
    connections.clear();
    poolUtil.pauseVfs();
    return { paused: poolUtil.isPaused(), reopen };
  },

  async unpause() {
    requireInit();
    if (tier !== 1) return { paused: false };
    await poolUtil.unpauseVfs();
    return { paused: poolUtil.isPaused() };
  },

  async isPaused() {
    requireInit();
    return { paused: tier === 1 ? poolUtil.isPaused() : false };
  },
};

self.onmessage = async (event: MessageEvent) => {
  const { id, op, args } = (event.data ?? {}) as WorkerRequest;
  try {
    const fn = ops[op];
    if (!fn) throw new Error(`Unknown worker op: ${op}`);
    self.postMessage({ id, ok: true, result: await fn(args ?? {}) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: toErrorPayload(err) });
  }
};

self.postMessage({ id: BOOT_ID, ok: true, result: { booted: true } });
