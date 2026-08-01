/**
 * The producer half of `importDatabase`'s pull protocol (PLAN 3.1/A5, 16.2).
 *
 * The worker asks for one chunk at a time over a MessagePort and this answers each request by
 * reading exactly that much and no more. The direction is the entire point: a producer that reads
 * as fast as it can and posts as it goes buffers the whole download in the worker's message queue,
 * which is how M0 measured 65 MiB for the whole-buffer path against 1.10 MiB for the pulled one.
 *
 * A MessagePort rather than a transferred `ReadableStream` because transferable streams are
 * Chrome 87, Firefox 103 and Safari 16.4, all above this plugin's engine floor of Chrome 80,
 * Safari 14, Firefox 74. MessageChannel exists everywhere the worker does.
 */

/** 1 MiB, the size M0 row 2 measured the streaming profile at. */
export const CHUNK = 1024 * 1024;

export type ImportSource = Uint8Array | Blob | ReadableStream<Uint8Array>;

/** Reads one chunk per call and returns null when the source is spent. */
interface ChunkReader {
  next(): Promise<Uint8Array | null>;
  cancel(): void;
  /** Byte length when the source knows it. Streams do not. */
  total?: number;
}

function isReadableStream(source: unknown): source is ReadableStream<Uint8Array> {
  return typeof (source as any)?.getReader === 'function';
}

function bytesReader(bytes: Uint8Array): ChunkReader {
  let offset = 0;
  return {
    total: bytes.byteLength,
    async next() {
      if (offset >= bytes.byteLength) return null;
      // slice, not subarray: the chunk is transferred, and transferring a view would hand over
      // the whole underlying buffer.
      const chunk = bytes.slice(offset, Math.min(offset + CHUNK, bytes.byteLength));
      offset += chunk.byteLength;
      return chunk;
    },
    cancel() {
      offset = bytes.byteLength;
    },
  };
}

function blobReader(blob: Blob): ChunkReader {
  let offset = 0;
  return {
    total: blob.size,
    async next() {
      if (offset >= blob.size) return null;
      // Sliced and read on demand, so a Blob backed by a file is never fully realised.
      const slice = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
      offset += slice.size;
      return new Uint8Array(await slice.arrayBuffer());
    },
    cancel() {
      offset = blob.size;
    },
  };
}

function streamReader(stream: ReadableStream<Uint8Array>): ChunkReader {
  const reader = stream.getReader();
  return {
    async next() {
      const { done, value } = await reader.read();
      if (done || !value) return null;
      return value;
    },
    cancel() {
      void reader.cancel().catch(() => undefined);
    },
  };
}

export function readerFor(source: ImportSource): ChunkReader {
  if (source instanceof Uint8Array) return bytesReader(source);
  if (typeof Blob !== 'undefined' && source instanceof Blob) return blobReader(source);
  if (isReadableStream(source)) return streamReader(source);
  throw new Error('ImportDatabase: source must be a Uint8Array, a Blob or a ReadableStream');
}

export interface SourceFeed {
  /** Hand this to the worker with the op. */
  port: MessagePort;
  /** Byte length when the source knows it, for progress reporting. */
  total?: number;
  /** Stop answering and release the source. Safe to call twice. */
  close(): void;
}

/**
 * Wire a source to a fresh MessageChannel and start answering the worker's requests.
 *
 * One outstanding request at a time by construction: the worker does not ask again until it has
 * the previous chunk, so at most one chunk is in flight and the source is read no faster than the
 * VFS drains it.
 */
export function feedSource(source: ImportSource): SourceFeed {
  const reader = readerFor(source);
  const channel = new MessageChannel();
  let closed = false;

  channel.port1.onmessage = async () => {
    if (closed) return;
    try {
      const chunk = await reader.next();
      if (closed) return;
      if (!chunk) {
        channel.port1.postMessage({ done: true });
        return;
      }
      channel.port1.postMessage({ chunk: chunk.buffer }, [chunk.buffer]);
    } catch (err) {
      // The worker turns this into an IMPORT_SOURCE_INVALID rejection, so a network failure
      // mid-download surfaces as a failed import rather than a hang.
      channel.port1.postMessage({ error: err instanceof Error ? err.message : String(err) });
    }
  };
  channel.port1.start?.();

  return {
    port: channel.port2,
    total: reader.total,
    close() {
      if (closed) return;
      closed = true;
      reader.cancel();
      try {
        channel.port1.close();
      } catch {
        // Already closed, which is the state we wanted.
      }
    },
  };
}
