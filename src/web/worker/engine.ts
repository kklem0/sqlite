/**
 * Thin wrapper over sqlite-wasm's oo1 API.
 *
 * The semantics are the ones `electron/src/electron-utils/utilsSQLite.ts` (MIT, this repo)
 * defines over better-sqlite3: `changes` is a `total_changes()` delta, `lastId` comes from
 * `last_insert_rowid()`, and `execute` runs a whole batch. Two deliberate differences:
 *
 * - changes and lastId are read inside the same worker op as the statement, so nothing can
 *   interleave between the write and the read.
 * - RETURNING is executed directly. better-sqlite3 cannot step a RETURNING statement with
 *   `.run()`, which is why the electron port strips the clause and re-selects by rowid range;
 *   sqlite-wasm has no such limit, so the rows come straight from the statement that produced
 *   them and the rowid-range race disappears.
 */
import { prefixed } from '../errors';
import type { ExecResult } from '../protocol';

import { producesRows, replaceUndefinedByNull, softDeleteRewrite } from './statements';

export class Connection {
  private transactionActive = false;
  /**
   * Whether this database participates in the soft-delete protocol, cached because answering it
   * means a PRAGMA per table. Invalidated whenever DDL runs, since that is the only thing that
   * can add or remove the `last_modified` / `sql_deleted` pair.
   */
  private syncEnabledCache: boolean | null = null;

  constructor(
    readonly storage: string,
    readonly isReadonly: boolean,
    private readonly db: any,
    private readonly sqlite3: any,
  ) {}

  get pointer(): number {
    return this.db.pointer;
  }

  /** The oo1 handle. Needed by the tier 2 deserialize path; nothing else should reach for it. */
  get raw(): any {
    return this.db;
  }

  get isOpen(): boolean {
    return !!this.db.pointer;
  }

  close(): void {
    this.db.close();
  }

  private totalChanges(): number {
    return this.db.changes(true, false);
  }

  private lastInsertRowid(): number {
    return Number(this.sqlite3.capi.sqlite3_last_insert_rowid(this.db.pointer));
  }

  userVersion(): number {
    return Number(this.db.selectValue('PRAGMA user_version') ?? 0);
  }

  setUserVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${Math.trunc(version)}`);
  }

  /**
   * Tier 2 opens `:memory:` with create flags because a deserialize needs a writable handle, so
   * a read-only connection is enforced here instead of by the open flags. Tier 1 gets the real
   * thing from the 'r' flag and does not need this.
   */
  setQueryOnly(on: boolean): void {
    this.db.exec(`PRAGMA query_only = ${on ? 'ON' : 'OFF'}`);
  }

  setForeignKeyConstraintsEnabled(enabled: boolean): void {
    this.db.exec(`PRAGMA foreign_keys = ${enabled ? 'ON' : 'OFF'}`);
  }

  /**
   * Gate for the DELETE rewrite. The port source keys off the columns rather than the presence
   * of `sync_table`, so a database gains soft-delete behaviour as soon as its schema declares
   * the pair, which is also when `createSyncTable` will accept it.
   */
  get syncEnabled(): boolean {
    if (this.syncEnabledCache === null) {
      this.syncEnabledCache = hasSyncColumns(this);
    }
    return this.syncEnabledCache;
  }

  invalidateSyncCache(): void {
    this.syncEnabledCache = null;
  }

  /** A batch of raw statements, as `execute()` receives it. */
  executeBatch(statements: string): ExecResult {
    this.invalidateSyncCache();
    const before = this.totalChanges();
    try {
      this.db.exec(statements);
    } catch (err) {
      throw prefixed('Execute', err);
    }
    return { changes: this.totalChanges() - before, lastId: this.lastInsertRowid() };
  }

  /**
   * One statement with its bind values. `wantRows` collects RETURNING / SELECT output.
   *
   * `rewriteDeletes` is the equivalent of the port source's `fromJson` flag. A DELETE the
   * plugin generates itself must run as a real delete: `deleteExportedRows` exists precisely to
   * reclaim soft-deleted rows, and a JSON import replicating a server-side deletion has already
   * been told the row is gone. Rewriting those would make both operations no-ops.
   */
  run(rawStatement: string, values: any[] | undefined, wantRows: boolean, rewriteDeletes = true): ExecResult {
    const statement = rewriteDeletes ? softDeleteRewrite(rawStatement, this.syncEnabled) : rawStatement;
    const bind = replaceUndefinedByNull(values);
    const before = this.totalChanges();
    let rows: any[] | undefined;
    try {
      if (wantRows) {
        rows = this.db.exec({
          sql: statement,
          bind: bind.length > 0 ? bind : undefined,
          rowMode: 'object',
          returnValue: 'resultRows',
        });
      } else {
        this.db.exec({ sql: statement, bind: bind.length > 0 ? bind : undefined });
      }
    } catch (err) {
      throw prefixed('Run', err);
    }
    const result: ExecResult = { changes: this.totalChanges() - before, lastId: this.lastInsertRowid() };
    if (rows !== undefined) result.values = rows;
    return result;
  }

  query(statement: string, values?: any[]): any[] {
    const bind = replaceUndefinedByNull(values);
    try {
      return this.db.exec({
        sql: statement,
        bind: bind.length > 0 ? bind : undefined,
        rowMode: 'object',
        returnValue: 'resultRows',
      });
    } catch (err) {
      throw prefixed('Query', err);
    }
  }

  beginTransaction(): void {
    if (this.transactionActive) throw new Error('a transaction is already active');
    this.db.exec('BEGIN TRANSACTION;');
    this.transactionActive = true;
  }

  commitTransaction(): void {
    if (!this.transactionActive) throw new Error('no transaction is active');
    this.db.exec('COMMIT TRANSACTION;');
    this.transactionActive = false;
  }

  rollbackTransaction(): void {
    if (!this.transactionActive) throw new Error('no transaction is active');
    this.db.exec('ROLLBACK TRANSACTION;');
    this.transactionActive = false;
  }

  get isTransactionActive(): boolean {
    return this.transactionActive;
  }

  /**
   * Run `body` inside a transaction the caller asked for, but never nest: `execute`/`run` default
   * to transaction=true and are routinely called from inside an explicit beginTransaction().
   */
  withOptionalTransaction<T>(wanted: boolean, body: () => T): T {
    const own = wanted && !this.transactionActive;
    if (!own) return body();
    this.beginTransaction();
    try {
      const out = body();
      this.commitTransaction();
      return out;
    } catch (err) {
      try {
        this.rollbackTransaction();
      } catch {
        this.transactionActive = false;
      }
      throw err;
    }
  }

  tableList(): any[] {
    return this.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).map((row: any) => row.name);
  }

  tableExists(table: string): boolean {
    const found = this.db.selectValue("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
    return Number(found ?? 0) > 0;
  }

  /** Whole-file image, used by tier 2 flushes and by exportDb. */
  serialize(): Uint8Array {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer);
  }
}

/** Statement-level helper shared by run/executeSet so both decide row collection identically. */
export function wantsRows(statement: string, returnMode: string | undefined): boolean {
  if (returnMode === 'all' || returnMode === 'one') return producesRows(statement);
  return false;
}

/**
 * Local copy of the sync-column probe. It lives here rather than in `sync.ts` to avoid a
 * circular import: `sync.ts` needs Connection, and Connection needs this answer.
 */
function hasSyncColumns(conn: Connection): boolean {
  let lastModified = false;
  let sqlDeleted = false;
  for (const table of conn.tableList()) {
    if (table === 'sync_table') continue;
    for (const row of conn.query(`PRAGMA table_info(${table})`)) {
      if (row.name === 'last_modified') lastModified = true;
      if (row.name === 'sql_deleted') sqlDeleted = true;
    }
    if (lastModified && sqlDeleted) return true;
  }
  return false;
}
