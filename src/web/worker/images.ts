/**
 * Tier 2 persistence: whole-database images in IndexedDB.
 *
 * This is jeep-sqlite's durability model, reimplemented on the one engine: the database lives in
 * `:memory:` and the bytes rest in IndexedDB, written at the flush points the plugin already
 * documents (close, closeConnection, saveToStore). The image format is plain SQLite, byte for
 * byte the same thing tier 1 stores in the pool, which is what lets a database move between the
 * tiers and what the M3 jeep migration will rely on.
 *
 * Raw IndexedDB on purpose: localforage is not a dependency and will not become one.
 */
import { IMAGE_STORE_NAME, imageStoreDbName } from '../protocol';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export class ImageStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private name: string;

  constructor(poolName: string) {
    this.name = imageStoreDbName(poolName);
  }

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      const name = this.name;
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(IMAGE_STORE_NAME)) {
            req.result.createObjectStore(IMAGE_STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Could not open the image store'));
      });
    }
    return this.dbPromise;
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(IMAGE_STORE_NAME, mode).objectStore(IMAGE_STORE_NAME);
  }

  async get(storage: string): Promise<Uint8Array | null> {
    const store = await this.tx('readonly');
    const value = await request<any>(store.get(storage));
    if (!value) return null;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
  }

  async put(storage: string, image: Uint8Array): Promise<void> {
    const store = await this.tx('readwrite');
    await request(store.put(image, storage));
  }

  async delete(storage: string): Promise<void> {
    const store = await this.tx('readwrite');
    await request(store.delete(storage));
  }

  async has(storage: string): Promise<boolean> {
    const store = await this.tx('readonly');
    const count = await request<number>(store.count(storage));
    return count > 0;
  }

  async keys(): Promise<string[]> {
    const store = await this.tx('readonly');
    const keys = await request<IDBValidKey[]>(store.getAllKeys());
    return keys.map((k) => String(k));
  }
}

/**
 * Load an image into an open `:memory:` database.
 *
 * FREEONCLOSE hands the buffer's lifetime to sqlite (it was allocated with sqlite's allocator by
 * allocFromTypedArray), and RESIZEABLE is what allows writes that grow the database past the
 * size of the image it was restored from.
 */
export function deserializeInto(sqlite3: any, db: any, image: Uint8Array): void {
  const capi = sqlite3.capi;
  const pData = sqlite3.wasm.allocFromTypedArray(image);
  const rc = capi.sqlite3_deserialize(
    db.pointer,
    'main',
    pData,
    image.byteLength,
    image.byteLength,
    capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE,
  );
  db.checkRc(rc);
}
