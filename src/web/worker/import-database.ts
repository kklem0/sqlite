/**
 * `importDatabase`: a caller-owned byte source becomes a database, without ever holding the whole
 * thing in memory and without a failed import being able to damage what is already there.
 *
 * The shape is PLAN 16.2. Three phases, always, whether or not the name is taken:
 *
 * 1. **Stream** into a staging name, `<storage>.importing`. Chunks are pulled one at a time over a
 *    MessagePort: the worker asks, the main thread reads exactly one chunk and answers. That
 *    direction is the whole point (PLAN 3.1/A5). A producer that pushes as fast as it can read
 *    buffers the entire download in this worker's message queue, which is how M0 measured 65 MiB
 *    for the whole-buffer path against 1.10 MiB for the pulled one.
 * 2. **Verify** the staging database: SQLite header, then `PRAGMA integrity_check`. Same contract
 *    the jeep migration and the tier promotion use, from `adoption.ts`.
 * 3. **Publish** it under the real name. On tier 1 that is `VACUUM INTO`, which writes through the
 *    pool's VFS page by page rather than through a JS buffer (verified, PLAN 16.0 V2); the
 *    sahpool has no rename, and `exportFile` + `importDb` would materialise the whole file.
 *
 * Nothing touches the target until step 3, so a truncated or corrupt stream leaves an existing
 * database exactly as it was.
 */
import { SQLiteWebError, messageOf } from '../errors';

import { looksLikeSQLite } from './adoption';

/** Suffix marking a half-finished import. Filtered out of listings and swept at init. */
export const STAGING_SUFFIX = '.importing';

/** Meta-store key holding an interrupted swap, so `init` can finish or undo it. */
export const SWAP_MARKER = 'import-swap';

export interface SwapMarker {
  storage: string;
  staging: string;
}

export function stagingName(storage: string): string {
  return `${storage}${STAGING_SUFFIX}`;
}

export function isStagingName(name: string): boolean {
  return name.endsWith(STAGING_SUFFIX);
}

export const IMPORT_NAME_TAKEN = 'IMPORT_NAME_TAKEN';
export const IMPORT_SOURCE_INVALID = 'IMPORT_SOURCE_INVALID';
export const IMPORT_NOT_A_DATABASE = 'IMPORT_NOT_A_DATABASE';
export const IMPORT_TRANSACTION_ACTIVE = 'IMPORT_TRANSACTION_ACTIVE';
export const IMPORT_IN_PROGRESS = 'IMPORT_IN_PROGRESS';

export function importError(code: string, message: string): SQLiteWebError {
  return new SQLiteWebError(message, { name: 'SQLiteWebImportError', code });
}

/**
 * The pull side of the protocol. Each call asks the main thread for one chunk and resolves with it,
 * or with null when the source is exhausted. The port is closed when the import ends, which makes
 * a pending request reject rather than hang if the other side goes away.
 */
export class ChunkPuller {
  private pending: { resolve: (value: Uint8Array | null) => void; reject: (err: unknown) => void } | null = null;
  private closed = false;
  private failure: string | null = null;

  constructor(private readonly port: MessagePort) {
    port.onmessage = (event: MessageEvent) => {
      const data = event.data ?? {};
      const waiting = this.pending;
      this.pending = null;
      if (!waiting) return;
      if (data.error) {
        this.failure = String(data.error);
        waiting.reject(importError(IMPORT_SOURCE_INVALID, `the source could not be read: ${data.error}`));
        return;
      }
      waiting.resolve(data.done ? null : new Uint8Array(data.chunk));
    };
    port.start?.();
  }

  next(): Promise<Uint8Array | null> {
    if (this.failure) return Promise.reject(importError(IMPORT_SOURCE_INVALID, this.failure));
    if (this.closed) return Promise.reject(importError(IMPORT_SOURCE_INVALID, 'the source was closed'));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.port.postMessage({ want: true });
    });
  }

  close(): void {
    this.closed = true;
    this.pending?.reject(importError(IMPORT_SOURCE_INVALID, 'the source was closed'));
    this.pending = null;
    try {
      this.port.close();
    } catch {
      // Already gone, which is the state we wanted.
    }
  }
}

/**
 * Everything the import needs from the tier it is running on. Implemented in `worker.ts`, where
 * the pool and the image store live.
 */
export interface ImportTarget {
  exists(storage: string): Promise<boolean>;
  /** Stream the puller's chunks into `storage`, returning the byte count. */
  stream(storage: string, puller: ChunkPuller, onProgress: (loaded: number) => void): Promise<number>;
  /** Open `storage` and prove it is a readable database. Throws otherwise. */
  verify(storage: string): Promise<void>;
  /** Copy `from` onto `to`, which must not exist. Page by page where the tier allows it. */
  publish(from: string, to: string): Promise<void>;
  remove(storage: string): Promise<void>;
}

export interface ImportOutcome {
  bytes: number;
  replaced: boolean;
}

/**
 * Phases 1 and 2. Split out from the publish so the caller can hold its own gate around the
 * destructive part without holding it across the download, which can take minutes.
 */
export async function stageAndVerify(
  target: ImportTarget,
  storage: string,
  puller: ChunkPuller,
  onProgress: (loaded: number) => void,
): Promise<number> {
  const staging = stagingName(storage);
  await target.remove(staging).catch(() => undefined);
  let bytes: number;
  try {
    bytes = await target.stream(staging, puller, onProgress);
  } catch (err) {
    await target.remove(staging).catch(() => undefined);
    throw err;
  }
  try {
    await target.verify(staging);
  } catch (err) {
    await target.remove(staging).catch(() => undefined);
    throw importError(IMPORT_NOT_A_DATABASE, `the imported bytes are not a usable database: ${messageOf(err)}`);
  }
  return bytes;
}

/** Guard shared by the streaming path and the whole-image path. */
export function requireSQLiteHeader(bytes: Uint8Array): void {
  if (!looksLikeSQLite(bytes)) {
    throw importError(IMPORT_NOT_A_DATABASE, 'the imported bytes do not start with a SQLite header');
  }
}
