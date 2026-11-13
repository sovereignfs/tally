import { type Bytes, concat, fromBase64Url, randomBytes, toBase64Url } from './bytes';
import { CipherError } from './errors';

/**
 * **What a device keeps of an account's keys** (DESIGN.md §5.3): the account key's private half and the group keys it has unwrapped, in IndexedDB,
 * **sealed under an AES key this device made and cannot read back** (non-extractable), so that what is on the disk is not the keys in the clear: a
 * copy of the files holds the device key too, as the browser stores it, but no script and no export reads it. Opened in memory to use.
 *
 * One database per account (`tally-vault-<account id>`), deleted at sign-out with the rest of the device's store (`deleteVault`).
 */
const STORE = 'keys';
const DEVICE_KEY = 'device-key';
const NONCE_BYTES = 12;

const nameOf = (accountId: string) => `tally-vault-${accountId}`;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'));
  });
}

function openDatabase(accountId: string): Promise<IDBDatabase> {
  const req = indexedDB.open(nameOf(accountId), 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  return request(req);
}

async function read<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return (await request(db.transaction(STORE).objectStore(STORE).get(key))) as T | undefined;
}

async function write(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'));
  });
}

export interface Vault {
  /** Keeps `secret` under `name`, sealed under the device key. */
  put(name: string, secret: Uint8Array): Promise<void>;
  /** The secret kept under `name`, or `undefined`. */
  get(name: string): Promise<Bytes | undefined>;
  remove(name: string): Promise<void>;
  close(): void;
}

export async function openVault(accountId: string): Promise<Vault> {
  const db = await openDatabase(accountId);
  let deviceKey = await read<CryptoKey>(db, DEVICE_KEY);
  if (!deviceKey) {
    deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await write(db, DEVICE_KEY, deviceKey);
  }
  const key = deviceKey;
  const aad = (name: string) => new TextEncoder().encode(`tally/vault/1/${name}`);
  return {
    async put(name, secret) {
      if (name === DEVICE_KEY) throw new CipherError('malformed');
      const nonce = randomBytes(NONCE_BYTES);
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: nonce, additionalData: aad(name) },
          key,
          concat(secret),
        ),
      );
      await write(db, `secret:${name}`, toBase64Url(concat(nonce, sealed)));
    },
    async get(name) {
      const stored = await read<string>(db, `secret:${name}`);
      if (stored === undefined) return undefined;
      const data = fromBase64Url(stored);
      if (!data || data.length <= NONCE_BYTES) throw new CipherError('malformed');
      try {
        return new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: data.slice(0, NONCE_BYTES), additionalData: aad(name) },
            key,
            data.slice(NONCE_BYTES),
          ),
        );
      } catch {
        throw new CipherError('tampered');
      }
    },
    async remove(name) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(`secret:${name}`);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed'));
      });
    },
    close: () => db.close(),
  };
}

/** Deletes the account's vault from this device: sign-out, or a person removing this device. */
export async function deleteVault(accountId: string): Promise<void> {
  await request(indexedDB.deleteDatabase(nameOf(accountId)));
}
