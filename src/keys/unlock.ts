import { fromBase64Url, toBase64Url, type Bytes } from '../cipher/bytes';
import { CipherError } from '../cipher/errors';
import { exportX25519Private, generateX25519, importX25519Private } from '../cipher/hpke';
import { PASSWORD_V1 } from '../cipher/password';
import { type Vault, openVault } from '../cipher/vault';
import {
  unwrapWithPrivateKey,
  unwrapWithSecret,
  wrapToPublicKey,
  wrapToSecret,
} from '../cipher/wrap';

/**
 * **Unlocking an account's key on a device** (DESIGN.md §5.3), in the browser: with what signed it in (the password, a passkey's PRF), or from
 * another of the account's devices, or, the last resort, a new key. What the server is asked and told goes through `KeyApi`, so that this is tested
 * with no browser (`unlock.test.ts`); `httpKeyApi` is the real one. The private half is kept in the device's vault (`src/cipher/vault.ts`) and nowhere
 * else, and never sent.
 */
export interface ServerKeys {
  accountKey: { publicKey: string; version: number } | null;
  wraps: {
    id: string;
    version: number;
    method: string;
    credentialId: string | null;
    params: string | null;
    wrapped: string;
  }[];
  requests: { id: string; publicKey: string; label: string; createdAt: number }[];
}

export interface NewWrap {
  method: 'password' | 'passkey' | 'recovery';
  credentialId?: string | null;
  params?: string | null;
  wrapped: string;
}

export interface KeyApi {
  get(): Promise<ServerKeys>;
  /** Makes the key; `exists` when another device made one first. */
  create(publicKey: string, wraps: NewWrap[]): Promise<{ version: number } | 'exists'>;
  replace(
    expectedVersion: number,
    publicKey: string,
    wraps: NewWrap[],
  ): Promise<{ version: number }>;
  putWrap(version: number, wrap: NewWrap): Promise<void>;
  createRequest(publicKey: string, label: string): Promise<string>;
  getRequest(id: string): Promise<{ wrapped: string | null } | null>;
  approveRequest(id: string, wrapped: string): Promise<void>;
  deleteRequest(id: string): Promise<void>;
}

/** The parameters a password wrap is made with, as the wrap says them, so that raising them later is a new value and not a guess. */
export const PASSWORD_PARAMS = `argon2id:${PASSWORD_V1.version}`;

/** The account key, unlocked on this device. */
export interface UnlockedKey {
  version: number;
  publicKey: Bytes;
  privateKey: CryptoKey;
  /** The 32 bytes of the private half, for wrapping it to another way in. Held in memory only while it is used. */
  privateBytes: Bytes;
}

const VAULT_KEY = 'account-key';

/** Bindings: what each wrap of the account key is for, so that one cannot be passed off as another's (`src/cipher/wrap.ts`). */
const bind = {
  password: (accountId: string, version: number) => [accountId, version],
  recovery: (accountId: string, version: number) => [accountId, version],
  passkey: (accountId: string, version: number, credentialId: string) => [
    accountId,
    version,
    credentialId,
  ],
  device: (accountId: string, version: number, requestId: string) => [
    accountId,
    version,
    requestId,
  ],
};

function decodeKey(value: string): Bytes {
  const bytes = fromBase64Url(value);
  if (!bytes || bytes.length !== 32) throw new CipherError('malformed');
  return bytes;
}

/** What the vault keeps: the version, the public half and the private half, together. */
function packVaulted(version: number, publicKey: Uint8Array, privateBytes: Uint8Array): Bytes {
  const out = new Uint8Array(new ArrayBuffer(4 + 64));
  new DataView(out.buffer).setUint32(0, version);
  out.set(publicKey, 4);
  out.set(privateBytes, 36);
  return out;
}

async function unpackVaulted(bytes: Uint8Array): Promise<UnlockedKey> {
  if (bytes.length !== 68) throw new CipherError('malformed');
  const version = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  const publicKey = bytes.slice(4, 36) as Bytes;
  const privateBytes = bytes.slice(36, 68) as Bytes;
  return {
    version,
    publicKey,
    privateBytes,
    privateKey: await importX25519Private(privateBytes, publicKey),
  };
}

export class AccountKeys {
  constructor(
    readonly accountId: string,
    private readonly api: KeyApi,
    private readonly vault: Vault,
  ) {}

  static async open(accountId: string, api: KeyApi): Promise<AccountKeys> {
    return new AccountKeys(accountId, api, await openVault(accountId));
  }

  /** The key this device holds, or undefined: the device is not unlocked. */
  async onDevice(): Promise<UnlockedKey | undefined> {
    const kept = await this.vault.get(VAULT_KEY);
    return kept ? unpackVaulted(kept) : undefined;
  }

  private async keep(
    version: number,
    publicKey: Uint8Array,
    privateBytes: Uint8Array,
  ): Promise<UnlockedKey> {
    await this.vault.put(VAULT_KEY, packVaulted(version, publicKey, privateBytes));
    const kept = await this.onDevice();
    if (!kept) throw new CipherError('malformed');
    return kept;
  }

  /** Whether the key this device holds is the server's current one: a device holding a replaced key is locked, not unlocked with a stale key. */
  async current(): Promise<UnlockedKey | undefined> {
    const [kept, server] = await Promise.all([this.onDevice(), this.api.get()]);
    if (!kept || !server.accountKey) return undefined;
    if (
      server.accountKey.version !== kept.version ||
      server.accountKey.publicKey !== toBase64Url(kept.publicKey)
    ) {
      await this.vault.remove(VAULT_KEY);
      return undefined;
    }
    return kept;
  }

  private async newKey(): Promise<{ publicKey: Bytes; privateBytes: Bytes }> {
    const pair = await generateX25519(true);
    return { publicKey: pair.publicKey, privateBytes: await exportX25519Private(pair.privateKey) };
  }

  private passwordWrap(
    privateBytes: Uint8Array,
    unwrap: Uint8Array,
    version: number,
  ): Promise<string> {
    return wrapToSecret(privateBytes, unwrap, 'password', bind.password(this.accountId, version));
  }

  /**
   * **After a password signs in** (DESIGN.md §5.3): unlocks with the password's unwrapping value, or makes the account's key if it has none, wrapped by
   * it. Answers `unlocked`, or `locked` when the password cannot open the key (it was reset by email, or the wrap is of an older key): the device then
   * offers the fallbacks.
   */
  async afterPassword(unwrap: Uint8Array): Promise<'unlocked' | 'locked'> {
    const server = await this.api.get();
    if (!server.accountKey) {
      const { publicKey, privateBytes } = await this.newKey();
      const made = await this.api.create(toBase64Url(publicKey), [
        {
          method: 'password',
          params: PASSWORD_PARAMS,
          wrapped: await this.passwordWrap(privateBytes, unwrap, 1),
        },
      ]);
      // Another device of the account made one at the same moment: unlock that one instead.
      if (made === 'exists') return this.afterPassword(unwrap);
      await this.keep(made.version, publicKey, privateBytes);
      return 'unlocked';
    }
    const { version, publicKey } = server.accountKey;
    const wrap = server.wraps.find((w) => w.method === 'password' && w.version === version);
    if (wrap) {
      try {
        const privateBytes = await unwrapWithSecret(
          wrap.wrapped,
          unwrap,
          'password',
          bind.password(this.accountId, version),
        );
        await this.keep(version, decodeKey(publicKey), privateBytes);
        return 'unlocked';
      } catch (error) {
        if (!(error instanceof CipherError)) throw error;
      }
    }
    // The password does not open the key (reset by email, or no wrap of this version): if this device holds the key, make the password's wrap anew.
    const held = await this.current();
    if (held) {
      await this.api.putWrap(held.version, {
        method: 'password',
        params: PASSWORD_PARAMS,
        wrapped: await this.passwordWrap(held.privateBytes, unwrap, held.version),
      });
      return 'unlocked';
    }
    return 'locked';
  }

  /** After the password is changed while signed in: the key wrapped by the new password, replacing the old wrap. */
  async rewrapPassword(unwrap: Uint8Array): Promise<void> {
    const held = await this.current();
    if (!held) throw new CipherError('wrong_key');
    await this.api.putWrap(held.version, {
      method: 'password',
      params: PASSWORD_PARAMS,
      wrapped: await this.passwordWrap(held.privateBytes, unwrap, held.version),
    });
  }

  /**
   * **After a passkey signs in**, with its PRF output (DESIGN.md §5.3): unlocks with that passkey's wrap; or, if this device already holds the key,
   * wraps it to the passkey, so that the passkey unlocks the next device by itself. `locked` when neither.
   */
  async afterPasskey(credentialId: string, secret: Uint8Array): Promise<'unlocked' | 'locked'> {
    const server = await this.api.get();
    if (!server.accountKey) return 'locked';
    const { version, publicKey } = server.accountKey;
    const binding = bind.passkey(this.accountId, version, credentialId);
    const wrap = server.wraps.find(
      (w) => w.method === 'passkey' && w.credentialId === credentialId && w.version === version,
    );
    if (wrap) {
      try {
        await this.keep(
          version,
          decodeKey(publicKey),
          await unwrapWithSecret(wrap.wrapped, secret, 'passkey', binding),
        );
        return 'unlocked';
      } catch (error) {
        if (!(error instanceof CipherError)) throw error;
      }
    }
    const held = await this.current();
    if (!held) return 'locked';
    await this.api.putWrap(version, {
      method: 'passkey',
      credentialId,
      wrapped: await wrapToSecret(held.privateBytes, secret, 'passkey', binding),
    });
    return 'unlocked';
  }

  /** Wraps the key this device holds to a secret: the recovery code's (task 15.4). */
  async putSecretWrap(method: 'recovery', secret: Uint8Array): Promise<void> {
    const held = await this.current();
    if (!held) throw new CipherError('wrong_key');
    await this.api.putWrap(held.version, {
      method,
      wrapped: await wrapToSecret(
        held.privateBytes,
        secret,
        method,
        bind[method](this.accountId, held.version),
      ),
    });
  }

  /** Unlocks with a secret wrap: the recovery code's. `wrong_key` when it does not open. */
  async unlockWithSecret(method: 'recovery', secret: Uint8Array): Promise<UnlockedKey> {
    const server = await this.api.get();
    if (!server.accountKey) throw new CipherError('wrong_key');
    const { version, publicKey } = server.accountKey;
    const wrap = server.wraps.find((w) => w.method === method && w.version === version);
    if (!wrap) throw new CipherError('wrong_key');
    const privateBytes = await unwrapWithSecret(
      wrap.wrapped,
      secret,
      method,
      bind[method](this.accountId, version),
    );
    return this.keep(version, decodeKey(publicKey), privateBytes);
  }

  /**
   * **A new device asks another of the account's devices** (DESIGN.md §5.3): a one-time key pair, made here and kept in memory, whose public half is
   * the request. `waitForApproval` asks after it until a device allows it or it expires.
   */
  async askAnotherDevice(label: string): Promise<{
    requestId: string;
    waitForApproval: (signal?: AbortSignal, everyMs?: number) => Promise<'unlocked' | 'expired'>;
  }> {
    const oneTime = await generateX25519();
    const requestId = await this.api.createRequest(toBase64Url(oneTime.publicKey), label);
    const waitForApproval = async (
      signal?: AbortSignal,
      everyMs = 3000,
    ): Promise<'unlocked' | 'expired'> => {
      for (;;) {
        if (signal?.aborted) return 'expired';
        const state = await this.api.getRequest(requestId);
        if (state === null) return 'expired';
        if (state.wrapped) {
          const server = await this.api.get();
          if (!server.accountKey) return 'expired';
          const { version, publicKey } = server.accountKey;
          const privateBytes = await unwrapWithPrivateKey(
            state.wrapped,
            oneTime.privateKey,
            oneTime.publicKey,
            bind.device(this.accountId, version, requestId),
          );
          await this.keep(version, decodeKey(publicKey), privateBytes);
          await this.api.deleteRequest(requestId);
          return 'unlocked';
        }
        await new Promise((resolve) => setTimeout(resolve, everyMs));
      }
    };
    return { requestId, waitForApproval };
  }

  /** On an unlocked device: lets a new one in, by wrapping the key to its one-time key. */
  async approve(request: { id: string; publicKey: string }): Promise<void> {
    const held = await this.current();
    if (!held) throw new CipherError('wrong_key');
    const wrapped = await wrapToPublicKey(
      held.privateBytes,
      decodeKey(request.publicKey),
      bind.device(this.accountId, held.version, request.id),
    );
    await this.api.approveRequest(request.id, wrapped);
  }

  /** On an unlocked device: refuses a request ("That was not me"). */
  async decline(requestId: string): Promise<void> {
    await this.api.deleteRequest(requestId);
  }

  /**
   * **The last resort** (DESIGN.md §5.3): a new key, with the password's wrap if one is given. What the old key opened stays sealed until a group's
   * members wrap its key to the new one (task 15.3).
   */
  async startAfresh(unwrap?: Uint8Array): Promise<UnlockedKey> {
    const server = await this.api.get();
    const { publicKey, privateBytes } = await this.newKey();
    const expected = server.accountKey?.version;
    const next = (expected ?? 0) + 1;
    const wraps: NewWrap[] = unwrap
      ? [
          {
            method: 'password',
            params: PASSWORD_PARAMS,
            wrapped: await this.passwordWrap(privateBytes, unwrap, next),
          },
        ]
      : [];
    const made =
      expected === undefined
        ? await this.api.create(toBase64Url(publicKey), wraps)
        : await this.api.replace(expected, toBase64Url(publicKey), wraps);
    if (made === 'exists') throw new CipherError('wrong_key');
    return this.keep(made.version, publicKey, privateBytes);
  }

  close(): void {
    this.vault.close();
  }
}

/** The real `KeyApi`: the app's routes, with this page's cookies and Origin. */
export const httpKeyApi: KeyApi = {
  async get() {
    const reply = await fetch('/api/keys', { cache: 'no-store' });
    if (!reply.ok) throw new Error(`keys: ${reply.status}`);
    return (await reply.json()) as ServerKeys;
  },
  async create(publicKey, wraps) {
    const reply = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey, wraps }),
    });
    if (reply.status === 409) return 'exists';
    if (!reply.ok) throw new Error(`keys: ${reply.status}`);
    return (await reply.json()) as { version: number };
  },
  async replace(expectedVersion, publicKey, wraps) {
    const reply = await fetch('/api/keys', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion, publicKey, wraps }),
    });
    if (!reply.ok) throw new Error(`keys: ${reply.status}`);
    return (await reply.json()) as { version: number };
  },
  async putWrap(version, wrap) {
    const reply = await fetch('/api/keys/wraps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version, wrap }),
    });
    if (!reply.ok) throw new Error(`keys: ${reply.status}`);
  },
  async createRequest(publicKey, label) {
    const reply = await fetch('/api/keys/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey, label }),
    });
    if (!reply.ok) throw new Error(`keys: ${reply.status}`);
    return ((await reply.json()) as { id: string }).id;
  },
  async getRequest(id) {
    const reply = await fetch(`/api/keys/requests/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (reply.status === 404) return null;
    if (!reply.ok) throw new Error(`keys: ${reply.status}`);
    return (await reply.json()) as { wrapped: string | null };
  },
  async approveRequest(id, wrapped) {
    const reply = await fetch(`/api/keys/requests/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrapped }),
    });
    if (!reply.ok) throw new Error(`keys: ${reply.status}`);
  },
  async deleteRequest(id) {
    await fetch(`/api/keys/requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
