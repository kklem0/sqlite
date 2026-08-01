import { WebPlugin } from '@capacitor/core';

import type {
  CapacitorSQLitePlugin,
  capConnectionOptions,
  capAllConnectionsOptions,
  capChangeSecretOptions,
  capEchoOptions,
  capEchoResult,
  capNCConnectionOptions,
  capNCDatabasePathOptions,
  capNCDatabasePathResult,
  capNCOptions,
  capSetSecretOptions,
  capSQLiteChanges,
  capSQLiteExecuteOptions,
  capSQLiteExportOptions,
  capSQLiteFromAssetsOptions,
  capSQLiteHTTPOptions,
  capSQLiteLocalDiskOptions,
  capSQLiteImportOptions,
  capSQLiteJson,
  capSQLiteOptions,
  capSQLitePathOptions,
  capSQLiteQueryOptions,
  capSQLiteResult,
  capSQLiteRunOptions,
  capSQLiteSetOptions,
  capSQLiteSyncDate,
  capSQLiteSyncDateOptions,
  capSQLiteTableOptions,
  capSQLiteUpgradeOptions,
  capSQLiteUrl,
  capSQLiteValues,
  capVersionResult,
  capSQLiteExtensionPath,
  capSQLiteExtensionEnable,
} from './definitions';
import { WorkerClient } from './web/client';
import { WEBSTORE_NOT_OPEN, prefixed } from './web/errors';
import type { SerializedUpgrade, Tier, WorkerInitResult } from './web/protocol';
import { ConnectionRegistry, parseKey, reconcile } from './web/registry';
import { connKey } from './web/worker/paths';
import { getSqliteWebOptions } from './web/worker-factory';

/**
 * Web implementation backed by `@sqlite.org/sqlite-wasm` in a dedicated worker.
 *
 * Tier 1 stores databases in OPFS through the `opfs-sahpool` VFS, which needs neither COOP/COEP
 * headers nor SharedArrayBuffer and therefore works inside Capacitor WebViews. Tier 2 is the
 * automatic fallback for platforms without OPFS sync access handles: the same engine, with
 * databases in `:memory:` and whole-file images in IndexedDB.
 */
export class CapacitorSQLiteWeb extends WebPlugin implements CapacitorSQLitePlugin {
  private client = new WorkerClient();
  private registry = new ConnectionRegistry();
  private upgrades = new Map<string, SerializedUpgrade[]>();
  private store: WorkerInitResult | null = null;

  async initWebStore(): Promise<void> {
    if (this.store) return;
    try {
      this.client.onEvent = (event, data) => this.notifyListeners(event, data);
      await this.client.start();
      this.store = await this.client.call('init', getSqliteWebOptions());
    } catch (err) {
      this.store = null;
      throw prefixed('initWebStore', err);
    }
  }

  /** Which durability tier the store selected. Additive; not part of CapacitorSQLitePlugin. */
  getWebStoreTier(): Tier | null {
    return this.store?.tier ?? null;
  }

  /**
   * Shut the worker down and release the single-owner lock, so another tab can take over.
   * Additive; not part of CapacitorSQLitePlugin. Any open connection is dropped without a
   * flush, so call `saveToStore` first if you are on tier 2 and care about unsaved changes.
   */
  async closeWebStore(): Promise<void> {
    this.client.terminate();
    this.registry.clear();
    this.store = null;
  }

  private ensureStore(): WorkerInitResult {
    if (!this.store) throw new Error(WEBSTORE_NOT_OPEN);
    return this.store;
  }

  private static optionValue<T>(options: any, key: string, fallback?: T): T {
    const value = options?.[key];
    if (value === undefined || value === null) {
      if (fallback !== undefined) return fallback;
      throw new Error(`Must provide a ${key}`);
    }
    return value as T;
  }

  private call(op: string, args: Record<string, any>, database?: string, readonly?: boolean): Promise<any> {
    this.ensureStore();
    const key = database !== undefined ? connKey(database, !!readonly) : undefined;
    return this.client.call(op, args, key);
  }

  async echo(options: capEchoOptions): Promise<capEchoResult> {
    return { value: options?.value };
  }

  async saveToStore(options: capSQLiteOptions): Promise<void> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    await this.call('saveToStore', { database }, database, false);
  }

  async createConnection(options: capConnectionOptions): Promise<void> {
    this.ensureStore();
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const version = options.version ?? 1;
    const readonly = options.readonly ?? false;
    if (options.encrypted) {
      throw new Error('CreateConnection: encryption is not supported on the web platform');
    }
    this.registry.add(database, readonly, version);
  }

  async closeConnection(options: capSQLiteOptions): Promise<void> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const readonly = options.readonly ?? false;
    this.registry.require(database, readonly);
    try {
      await this.call('close', { database, readonly }, database, readonly);
    } finally {
      this.registry.delete(database, readonly);
      this.client.releaseQueue(connKey(database, readonly));
    }
  }

  async open(options: capSQLiteOptions): Promise<void> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const readonly = options.readonly ?? false;
    const entry = this.registry.require(database, readonly);
    try {
      await this.call(
        'open',
        { database, readonly, version: entry.version, upgrades: this.upgrades.get(database) ?? [] },
        database,
        readonly,
      );
      entry.isOpen = true;
    } catch (err) {
      throw prefixed('Open', err);
    }
  }

  async close(options: capSQLiteOptions): Promise<void> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const readonly = options.readonly ?? false;
    const entry = this.registry.require(database, readonly);
    await this.call('close', { database, readonly }, database, readonly);
    entry.isOpen = false;
  }

  async getVersion(options: capSQLiteOptions): Promise<capVersionResult> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const readonly = options.readonly ?? false;
    this.requireOpen(database, readonly, 'GetVersion');
    return this.call('getVersion', { database, readonly }, database, readonly);
  }

  async checkConnectionsConsistency(options: capAllConnectionsOptions): Promise<capSQLiteResult> {
    const dbNames = options?.dbNames ?? [];
    const openModes = options?.openModes ?? [];
    const claimed = dbNames.map((name, index) => `${openModes[index] ?? 'RW'}_${name}`);
    const { toClose, consistent } = reconcile(this.registry.keys(), claimed);

    for (const key of toClose) {
      const { database, readonly } = parseKey(key);
      try {
        await this.call('close', { database, readonly }, database, readonly);
      } catch {
        // A connection that cannot be closed is still one we must forget about.
      }
      this.registry.delete(database, readonly);
      this.client.releaseQueue(key);
    }
    if (!consistent) this.registry.clear();
    return { result: consistent };
  }

  async beginTransaction(options: capSQLiteOptions): Promise<capSQLiteChanges> {
    return this.transactionOp('beginTransaction', options);
  }
  async commitTransaction(options: capSQLiteOptions): Promise<capSQLiteChanges> {
    return this.transactionOp('commitTransaction', options);
  }
  async rollbackTransaction(options: capSQLiteOptions): Promise<capSQLiteChanges> {
    return this.transactionOp('rollbackTransaction', options);
  }

  private async transactionOp(op: string, options: capSQLiteOptions): Promise<capSQLiteChanges> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const readonly = options.readonly ?? false;
    this.requireOpen(database, readonly, op);
    const result = await this.call(op, { database, readonly }, database, readonly);
    return { changes: { changes: result.changes, lastId: result.lastId } };
  }

  async isTransactionActive(options: capSQLiteOptions): Promise<capSQLiteResult> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const readonly = options.readonly ?? false;
    this.requireOpen(database, readonly, 'IsTransactionActive');
    return this.call('isTransactionActive', { database, readonly }, database, readonly);
  }

  async getTableList(options: capSQLiteOptions): Promise<capSQLiteValues> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const readonly = options.readonly ?? false;
    this.requireOpen(database, readonly, 'GetTableList');
    return this.call('getTableList', { database, readonly }, database, readonly);
  }

  async execute(options: capSQLiteExecuteOptions): Promise<capSQLiteChanges> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const statements = CapacitorSQLiteWeb.optionValue<string>(options, 'statements');
    const transaction = options.transaction ?? true;
    this.rejectReadonly(options.readonly, 'Execute');
    this.requireOpen(database, false, 'Execute');
    const result = await this.call('execute', { database, readonly: false, statements, transaction }, database, false);
    return { changes: { changes: result.changes, lastId: result.lastId } };
  }

  async executeSet(options: capSQLiteSetOptions): Promise<capSQLiteChanges> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const set = CapacitorSQLiteWeb.optionValue<any[]>(options, 'set');
    const transaction = options.transaction ?? true;
    const returnMode = options.returnMode ?? 'no';
    this.rejectReadonly(options.readonly, 'ExecuteSet');
    this.requireOpen(database, false, 'ExecuteSet');
    const result = await this.call(
      'executeSet',
      { database, readonly: false, set, transaction, returnMode },
      database,
      false,
    );
    return { changes: CapacitorSQLiteWeb.changesOf(result) };
  }

  async run(options: capSQLiteRunOptions): Promise<capSQLiteChanges> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const statement = CapacitorSQLiteWeb.optionValue<string>(options, 'statement');
    const transaction = options.transaction ?? true;
    const returnMode = options.returnMode ?? 'no';
    this.rejectReadonly(options.readonly, 'Run');
    this.requireOpen(database, false, 'Run');
    const result = await this.call(
      'run',
      { database, readonly: false, statement, values: options.values ?? [], transaction, returnMode },
      database,
      false,
    );
    return { changes: CapacitorSQLiteWeb.changesOf(result) };
  }

  async query(options: capSQLiteQueryOptions): Promise<capSQLiteValues> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const statement = CapacitorSQLiteWeb.optionValue<string>(options, 'statement');
    const readonly = options.readonly ?? false;
    this.requireOpen(database, readonly, 'Query');
    return this.call('query', { database, readonly, statement, values: options.values ?? [] }, database, readonly);
  }

  async isDBExists(options: capSQLiteOptions): Promise<capSQLiteResult> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const readonly = options.readonly ?? false;
    this.registry.require(database, readonly);
    return this.call('isDatabase', { database });
  }

  async isDBOpen(options: capSQLiteOptions): Promise<capSQLiteResult> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const readonly = options.readonly ?? false;
    this.registry.require(database, readonly);
    return this.call('isDBOpen', { database, readonly });
  }

  async isDatabase(options: capSQLiteOptions): Promise<capSQLiteResult> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    return this.call('isDatabase', { database });
  }

  async isTableExists(options: capSQLiteTableOptions): Promise<capSQLiteResult> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const table = CapacitorSQLiteWeb.optionValue<string>(options, 'table');
    const readonly = options.readonly ?? false;
    this.requireOpen(database, readonly, 'IsTableExists');
    return this.call('isTableExists', { database, readonly, table }, database, readonly);
  }

  async deleteDatabase(options: capSQLiteOptions): Promise<void> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    this.rejectReadonly(options.readonly, 'DeleteDatabase');
    this.registry.require(database, false);
    await this.call('deleteDatabase', { database }, database, false);
    const entry = this.registry.get(database, false);
    if (entry) entry.isOpen = false;
  }

  async getDatabaseList(): Promise<capSQLiteValues> {
    return this.call('getDatabaseList', {});
  }

  async addUpgradeStatement(options: capSQLiteUpgradeOptions): Promise<void> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const upgrade = CapacitorSQLiteWeb.optionValue<any[]>(options, 'upgrade');
    const serialized: SerializedUpgrade[] = upgrade.map((entry, index) => {
      if (entry?.toVersion === undefined || !Array.isArray(entry?.statements)) {
        throw new Error(`AddUpgradeStatement: upgrade[${index}] needs toVersion and statements`);
      }
      return { toVersion: entry.toVersion, statements: entry.statements };
    });
    const existing = this.upgrades.get(database) ?? [];
    const merged = new Map<number, SerializedUpgrade>();
    for (const item of [...existing, ...serialized]) merged.set(item.toVersion, item);
    this.upgrades.set(
      database,
      [...merged.values()].sort((a, b) => a.toVersion - b.toVersion),
    );
  }

  private requireOpen(database: string, readonly: boolean, context: string): void {
    const entry = this.registry.require(database, readonly);
    if (!entry.isOpen) throw new Error(`${context}: Database ${database} not opened`);
  }

  private rejectReadonly(readonly: boolean | undefined, context: string): void {
    if (readonly) throw new Error(`${context}: not allowed in read-only mode`);
  }

  private static changesOf(result: any): { changes: number; lastId: number; values?: any[] } {
    const changes: { changes: number; lastId: number; values?: any[] } = {
      changes: result.changes,
      lastId: result.lastId,
    };
    if (result.values !== undefined) changes.values = result.values;
    return changes;
  }

  ////////////////////////////////////
  ////// JSON PIPELINE
  ////////////////////////////////////

  async isJsonValid(options: capSQLiteImportOptions): Promise<capSQLiteResult> {
    const jsonstring = CapacitorSQLiteWeb.optionValue<string>(options, 'jsonstring');
    return this.call('isJsonValid', { jsonstring });
  }

  async importFromJson(options: capSQLiteImportOptions): Promise<capSQLiteChanges> {
    const jsonstring = CapacitorSQLiteWeb.optionValue<string>(options, 'jsonstring');
    const result = await this.call('importFromJson', { jsonstring });
    return { changes: { changes: result.changes, lastId: result.lastId } };
  }

  async exportToJson(options: capSQLiteExportOptions): Promise<capSQLiteJson> {
    const database = CapacitorSQLiteWeb.optionValue<string>(options, 'database');
    const jsonexportmode = CapacitorSQLiteWeb.optionValue<string>(options, 'jsonexportmode');
    const readonly = options.readonly ?? false;
    this.requireOpen(database, readonly, 'ExportToJson');
    return this.call(
      'exportToJson',
      { database, readonly, jsonexportmode, encrypted: options.encrypted ?? false },
      database,
      readonly,
    );
  }

  async createSyncTable(options: capSQLiteOptions): Promise<capSQLiteChanges> {
    console.log('createSyncTable', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async setSyncDate(options: capSQLiteSyncDateOptions): Promise<void> {
    console.log('setSyncDate', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async getSyncDate(options: capSQLiteOptions): Promise<capSQLiteSyncDate> {
    console.log('getSyncDate', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async deleteExportedRows(options: capSQLiteOptions): Promise<void> {
    console.log('deleteExportedRows', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async copyFromAssets(options: capSQLiteFromAssetsOptions): Promise<void> {
    console.log('copyFromAssets', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async getFromHTTPRequest(options: capSQLiteHTTPOptions): Promise<void> {
    console.log('getFromHTTPRequest', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async getFromLocalDiskToStore(options: capSQLiteLocalDiskOptions): Promise<void> {
    console.log('getFromLocalDiskToStore', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async saveToLocalDisk(options: capSQLiteOptions): Promise<void> {
    console.log('saveToLocalDisk', options);
    throw this.unimplemented('Not implemented on web.');
  }


  ////////////////////////////////////
  ////// UNIMPLEMENTED METHODS
  ////////////////////////////////////

  async getUrl(): Promise<capSQLiteUrl> {
    throw this.unimplemented('Not implemented on web.');
  }

  async getMigratableDbList(options: capSQLitePathOptions): Promise<capSQLiteValues> {
    console.log('getMigratableDbList', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async addSQLiteSuffix(options: capSQLitePathOptions): Promise<void> {
    console.log('addSQLiteSuffix', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async deleteOldDatabases(options: capSQLitePathOptions): Promise<void> {
    console.log('deleteOldDatabases', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async moveDatabasesAndAddSuffix(options: capSQLitePathOptions): Promise<void> {
    console.log('moveDatabasesAndAddSuffix', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async isSecretStored(): Promise<capSQLiteResult> {
    throw this.unimplemented('Not implemented on web.');
  }

  async setEncryptionSecret(options: capSetSecretOptions): Promise<void> {
    console.log('setEncryptionSecret', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async changeEncryptionSecret(options: capChangeSecretOptions): Promise<void> {
    console.log('changeEncryptionSecret', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async clearEncryptionSecret(): Promise<void> {
    console.log('clearEncryptionSecret');
    throw this.unimplemented('Not implemented on web.');
  }

  async checkEncryptionSecret(options: capSetSecretOptions): Promise<capSQLiteResult> {
    console.log('checkEncryptionPassPhrase', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async getNCDatabasePath(options: capNCDatabasePathOptions): Promise<capNCDatabasePathResult> {
    console.log('getNCDatabasePath', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async createNCConnection(options: capNCConnectionOptions): Promise<void> {
    console.log('createNCConnection', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async closeNCConnection(options: capNCOptions): Promise<void> {
    console.log('closeNCConnection', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async isNCDatabase(options: capNCOptions): Promise<capSQLiteResult> {
    console.log('isNCDatabase', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async isDatabaseEncrypted(options: capSQLiteOptions): Promise<capSQLiteResult> {
    console.log('isDatabaseEncrypted', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async isInConfigEncryption(): Promise<capSQLiteResult> {
    throw this.unimplemented('Not implemented on web.');
  }

  async isInConfigBiometricAuth(): Promise<capSQLiteResult> {
    throw this.unimplemented('Not implemented on web.');
  }

  async loadExtension(options: capSQLiteExtensionPath): Promise<void> {
    console.log('loadExtension', options);
    throw this.unimplemented('Not implemented on web.');
  }

  async enableLoadExtension(options: capSQLiteExtensionEnable): Promise<void> {
    console.log('enableLoadExtension', options);
    throw this.unimplemented('Not implemented on web.');
  }
}
