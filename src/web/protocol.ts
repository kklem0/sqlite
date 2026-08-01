/**
 * Wire types shared by the facade and the worker.
 *
 * Envelope: `{ id, op, args }` request, `{ id, ok: true, result }` or
 * `{ id, ok: false, error }` response. Values cross the boundary by structured clone, so
 * `Uint8Array` BLOBs and `BigInt` int64s survive without any JSON step.
 */

/** 1 = opfs-sahpool (durable files), 2 = :memory: plus whole-image persistence in IndexedDB. */
export type Tier = 1 | 2;

export interface WorkerInitArgs {
  poolName: string;
  directory: string;
  /** Test hook: skip the VFS install entirely and run on tier 2. */
  forceTier2?: boolean;
  /** Test hook: pretend the install rejected with this DOMException name. */
  simulateInstallError?: string;
  /** Override where sqlite3.wasm is fetched from. Defaults to a sibling of the worker file. */
  wasmUrl?: string;
}

export interface WorkerInitResult {
  tier: Tier;
  sqliteVersion: string;
  /** Reason the probe fell back, for logging. Absent on tier 1. */
  fallbackReason?: string;
}

export interface OpenArgs {
  database: string;
  readonly: boolean;
  version: number;
  upgrades: SerializedUpgrade[];
}

export interface SerializedUpgrade {
  toVersion: number;
  statements: string[];
}

export interface ExecResult {
  changes: number;
  lastId: number;
  values?: any[];
}

export interface QueryResult {
  values: any[];
}

export interface WorkerRequest {
  id: number;
  op: string;
  args: Record<string, any>;
}

export interface WorkerErrorPayload {
  message: string;
  name?: string;
  code?: string;
}

export type WorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: WorkerErrorPayload };

/** Sent unsolicited by the worker as soon as its module body has run. */
export const BOOT_ID = -1;

/**
 * Sent unsolicited by the worker to raise a plugin event. The facade forwards these to
 * `notifyListeners`, which is how the five documented web events reach the app.
 */
export const EVENT_ID = -2;

export interface WorkerEvent {
  id: typeof EVENT_ID;
  event: string;
  data: any;
}

/** The five events the web implementation has always emitted (PLAN 2.4). */
export const EV_IMPORT_PROGRESS = 'sqliteImportProgressEvent';
export const EV_EXPORT_PROGRESS = 'sqliteExportProgressEvent';
export const EV_HTTP_REQUEST_ENDED = 'sqliteHTTPRequestEndedEvent';
export const EV_PICK_DATABASE_ENDED = 'sqlitePickDatabaseEndedEvent';
export const EV_SAVE_TO_DISK = 'sqliteSaveDatabaseToDiskEvent';

/**
 * The IndexedDB database and object store backing tier 2 images.
 *
 * The database name is derived from the pool name so that the two tiers namespace identically.
 * On tier 1 the pool name already isolates one store from another (M0 finding S11); without the
 * same treatment here, two stores configured with different pool names would share their tier 2
 * databases while keeping their tier 1 ones separate, which is a difference nobody would expect
 * to depend on which tier the browser happened to select.
 */
export const IMAGE_STORE_NAME = 'databases';

export function imageStoreDbName(poolName: string): string {
  return `${poolName}-store`;
}

/**
 * Web Locks name held for the lifetime of the worker so only one context owns the pool.
 * Scoped by pool name: two stores configured with different pool names are genuinely
 * independent on disk, so they must not gate each other.
 */
export function ownerLockName(poolName: string): string {
  return `capacitor-sqlite-owner:${poolName}`;
}

/** Defaults for the sahpool. The pool name is part of the on-disk contract: changing it orphans data. */
export const DEFAULT_POOL_NAME = 'capacitor-sqlite';
export const DEFAULT_POOL_DIRECTORY = '.capacitor-sqlite';
