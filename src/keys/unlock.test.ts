import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { toHex } from '../cipher/bytes';
import { openVault } from '../cipher/vault';
import { AccountKeys, type KeyApi, type NewWrap, type ServerKeys } from './unlock';

/**
 * Unlocking an account's key on a device, against an in-memory server that keeps the rules of `src/keys/store.ts`: one key, made once; one password
 * and recovery wrap; one wrap per passkey; requests allowed once. Each device has a vault of its own.
 */
function memoryServer() {
  let key: { publicKey: string; version: number } | null = null;
  let wraps: (NewWrap & { id: string; version: number })[] = [];
  const requests = new Map<string, { publicKey: string; label: string; wrapped: string | null }>();
  let ids = 0;
  const api: KeyApi = {
    async get(): Promise<ServerKeys> {
      return {
        accountKey: key,
        wraps: wraps.map((w) => ({
          id: w.id,
          version: w.version,
          method: w.method,
          credentialId: w.credentialId ?? null,
          params: w.params ?? null,
          wrapped: w.wrapped,
        })),
        requests: [...requests]
          .filter(([, r]) => r.wrapped === null)
          .map(([id, r]) => ({ id, publicKey: r.publicKey, label: r.label, createdAt: 0 })),
      };
    },
    async create(publicKey, newWraps) {
      if (key) return 'exists';
      key = { publicKey, version: 1 };
      wraps = newWraps.map((w) => ({ ...w, id: `w${++ids}`, version: 1 }));
      return { version: 1 };
    },
    async replace(expected, publicKey, newWraps) {
      if (!key || key.version !== expected) throw new Error('not_found');
      key = { publicKey, version: expected + 1 };
      wraps = newWraps.map((w) => ({ ...w, id: `w${++ids}`, version: expected + 1 }));
      return { version: expected + 1 };
    },
    async putWrap(version, wrap) {
      if (!key || key.version !== version) throw new Error('not_found');
      wraps = wraps.filter((w) =>
        wrap.method === 'passkey'
          ? !(w.method === 'passkey' && w.credentialId === wrap.credentialId)
          : w.method !== wrap.method,
      );
      wraps.push({ ...wrap, id: `w${++ids}`, version });
    },
    async createRequest(publicKey, label) {
      const id = `r${++ids}`;
      requests.set(id, { publicKey, label, wrapped: null });
      return id;
    },
    async getRequest(id) {
      const found = requests.get(id);
      return found ? { wrapped: found.wrapped } : null;
    },
    async approveRequest(id, wrapped) {
      const found = requests.get(id);
      if (!found || found.wrapped) throw new Error('not_found');
      found.wrapped = wrapped;
    },
    async deleteRequest(id) {
      requests.delete(id);
    },
  };
  return { api, version: () => key?.version, wraps: () => wraps };
}

let devices = 0;
async function device(api: KeyApi, accountId = 'account-1'): Promise<AccountKeys> {
  return new AccountKeys(accountId, api, await openVault(`${accountId}-device-${++devices}`));
}

const secret = (fill: number) => new Uint8Array(32).fill(fill);
const privateOf = async (keys: AccountKeys) =>
  toHex((await keys.onDevice())?.privateBytes ?? new Uint8Array());

describe('an account’s key on a device', () => {
  it('is made by the first device a password signs in on, and unlocked by the same password on the next, with nobody else there', async () => {
    const server = memoryServer();
    const laptop = await device(server.api);
    expect(await laptop.afterPassword(secret(1))).toBe('unlocked');
    expect(server.version()).toBe(1);
    const phone = await device(server.api);
    expect(await phone.onDevice()).toBeUndefined();
    expect(await phone.afterPassword(secret(1))).toBe('unlocked');
    expect(await privateOf(phone)).toBe(await privateOf(laptop));
  });

  it('stays locked with a password that does not open it', async () => {
    const server = memoryServer();
    await (await device(server.api)).afterPassword(secret(1));
    const stranger = await device(server.api);
    expect(await stranger.afterPassword(secret(9))).toBe('locked');
    expect(await stranger.onDevice()).toBeUndefined();
  });

  it('after a reset, is wrapped by the new password from a device that still holds it, and the new password then opens it anywhere', async () => {
    const server = memoryServer();
    const laptop = await device(server.api);
    await laptop.afterPassword(secret(1));
    // The password was reset by email: the old wrap does not open with the new password, but the laptop holds the key and wraps it anew.
    expect(await laptop.afterPassword(secret(2))).toBe('unlocked');
    const phone = await device(server.api);
    expect(await phone.afterPassword(secret(2))).toBe('unlocked');
    expect(await privateOf(phone)).toBe(await privateOf(laptop));
    expect(server.wraps().filter((w) => w.method === 'password')).toHaveLength(1);
  });

  it('is made once when two devices sign in at the same moment, and both end with the same key', async () => {
    const server = memoryServer();
    const [one, two] = [await device(server.api), await device(server.api)];
    await Promise.all([one.afterPassword(secret(1)), two.afterPassword(secret(1))]);
    expect(await privateOf(one)).toBe(await privateOf(two));
  });

  it('is wrapped to a passkey by a device that holds it, and that passkey alone then unlocks another', async () => {
    const server = memoryServer();
    const laptop = await device(server.api);
    await laptop.afterPassword(secret(1));
    expect(await laptop.afterPasskey('credential-a', secret(5))).toBe('unlocked');
    const phone = await device(server.api);
    expect(await phone.afterPasskey('credential-a', secret(5))).toBe('unlocked');
    expect(await privateOf(phone)).toBe(await privateOf(laptop));
    const tablet = await device(server.api);
    expect(await tablet.afterPasskey('credential-b', secret(6))).toBe('locked');
    // The same credential with another secret is not that passkey.
    expect(await tablet.afterPasskey('credential-a', secret(7))).toBe('locked');
  });

  it('is let into a new device by another of the account’s devices, once it is allowed there', async () => {
    const server = memoryServer();
    const laptop = await device(server.api);
    await laptop.afterPassword(secret(1));
    const phone = await device(server.api);
    expect(await phone.afterPassword(secret(9))).toBe('locked');
    const { requestId, waitForApproval } = await phone.askAnotherDevice('Safari on iPhone');
    const pending = (await server.api.get()).requests;
    expect(pending.map((r) => r.id)).toEqual([requestId]);
    await laptop.approve(pending[0] ?? { id: '', publicKey: '' });
    expect(await waitForApproval(undefined, 1)).toBe('unlocked');
    expect(await privateOf(phone)).toBe(await privateOf(laptop));
    expect((await server.api.get()).requests).toEqual([]);
  });

  it('is not let in by a request that was declined', async () => {
    const server = memoryServer();
    const laptop = await device(server.api);
    await laptop.afterPassword(secret(1));
    const phone = await device(server.api);
    const { requestId, waitForApproval } = await phone.askAnotherDevice('Unknown');
    await laptop.decline(requestId);
    expect(await waitForApproval(undefined, 1)).toBe('expired');
    expect(await phone.onDevice()).toBeUndefined();
  });

  it('is opened by the recovery code’s wrap, and not by another code', async () => {
    const server = memoryServer();
    const laptop = await device(server.api);
    await laptop.afterPassword(secret(1));
    await laptop.putSecretWrap('recovery', secret(3));
    const phone = await device(server.api);
    await expect(phone.unlockWithSecret('recovery', secret(4))).rejects.toThrow('wrong_key');
    await phone.unlockWithSecret('recovery', secret(3));
    expect(await privateOf(phone)).toBe(await privateOf(laptop));
  });

  it('is replaced as a last resort, and a device holding the old key is then locked, not left with a stale one', async () => {
    const server = memoryServer();
    const laptop = await device(server.api);
    await laptop.afterPassword(secret(1));
    const phone = await device(server.api);
    const fresh = await phone.startAfresh(secret(2));
    expect(fresh.version).toBe(2);
    expect(await laptop.current()).toBeUndefined();
    expect(await laptop.onDevice()).toBeUndefined();
    expect(await laptop.afterPassword(secret(2))).toBe('unlocked');
    expect(await privateOf(laptop)).toBe(await privateOf(phone));
  });

  it('is never sent: nothing the server is given holds the private half', async () => {
    const server = memoryServer();
    const laptop = await device(server.api);
    await laptop.afterPassword(secret(1));
    await laptop.putSecretWrap('recovery', secret(3));
    const sent = JSON.stringify(await server.api.get());
    const privateHex = await privateOf(laptop);
    const held = await laptop.onDevice();
    expect(sent).not.toContain(privateHex);
    expect(sent).not.toContain(Buffer.from(held?.privateBytes ?? []).toString('base64url'));
  });
});
