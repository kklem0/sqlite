/**
 * Error plumbing for the web implementation.
 *
 * The jeep-based facade wrapped everything in `throw new Error(\`${err}\`)`, which turned a real
 * Error into the string "Error: ...". Errors are rebuilt from the worker payload here instead,
 * so `err.message` stays clean and the `name` survives the structured-clone boundary.
 */
import type { WorkerErrorPayload } from './protocol';

export const WEBSTORE_NOT_OPEN = 'WebStore is not open yet. You have to call "initWebStore()" first.';

export const MULTI_TAB_LOCKED =
  'Database is open in another tab or window. @capacitor-community/sqlite supports a single ' +
  'owning context per origin on the web; close the other tab and retry.';

export class SQLiteWebError extends Error {
  readonly code?: string;

  constructor(message: string, options?: { name?: string; code?: string; cause?: unknown }) {
    super(message);
    this.name = options?.name ?? 'SQLiteWebError';
    this.code = options?.code;
    if (options?.cause !== undefined) (this as any).cause = options.cause;
  }
}

/** Turn anything thrown into a message without the "Error: " prefix a template literal adds. */
export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  const message = (err as any)?.message;
  return typeof message === 'string' ? message : String(err);
}

/** Shape an arbitrary throwable for postMessage (Error is cloneable, but not all fields survive). */
export function toErrorPayload(err: unknown): WorkerErrorPayload {
  return {
    message: messageOf(err),
    name: err instanceof Error ? err.name : undefined,
    code: (err as any)?.code !== undefined ? String((err as any).code) : undefined,
  };
}

/** Rebuild an Error on the main thread from what the worker sent. */
export function fromErrorPayload(payload: WorkerErrorPayload | undefined): SQLiteWebError {
  return new SQLiteWebError(payload?.message ?? 'Unknown worker error', {
    name: payload?.name,
    code: payload?.code,
  });
}

/** Prefix a message the way the native implementations do, without stringifying the Error. */
export function prefixed(prefix: string, err: unknown): SQLiteWebError {
  return new SQLiteWebError(`${prefix}: ${messageOf(err)}`, {
    name: err instanceof Error ? err.name : undefined,
    code: (err as any)?.code !== undefined ? String((err as any).code) : undefined,
    cause: err,
  });
}
