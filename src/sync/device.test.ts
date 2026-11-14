import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openLocal } from '../local/db';
import { readOutbox } from '../local/store';
import type { Transport } from './client';
import { signOutDevice, startDevice, unsentChanges } from './device';
import type { LoopEnvironment } from './loop';

/**
 * The device at sign-out (DESIGN.md §11.7): one last try to send what it recorded, then its store deleted, whether or not that try reached the server;
 * and an ended session, which keeps the outbox.
 */
const quiet: LoopEnvironment = {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  locks: { request: async (_n, _o, callback) => callback({}) },
  random: () => 0.5,
};

async function seedOutbox(accountId: string, name: string) {
  const db = await openLocal(accountId, name);
  await db.add('outbox', {
    mutation: { mutationId: 'mutation-0001', groupId: 'group-0001', changes: [] },
    queuedAt: 1,
  });
  db.close();
}

const exists = async (name: string) => (await indexedDB.databases()).some((d) => d.name === name);

describe('signing a device out', () => {
  it('tries once more to send the outbox, then deletes the store', async () => {
    const accountId = `acct-${crypto.randomUUID()}`;
    const name = `tally-${accountId}`;
    await seedOutbox(accountId, name);
    const sent: number[] = [];
    const transport: Transport = async (request) => {
      sent.push(request.mutations.length);
      return { kind: 'offline' };
    };
    await startDevice({ accountId, personId: 'p', transport, environment: quiet, name });
    expect(await unsentChanges(accountId)).toBe(1);
    await signOutDevice(accountId, 1_000, name);
    // Once on load, once at sign-out; offline both times, and the store is deleted anyway.
    expect(sent).toEqual([1, 1]);
    expect(await exists(name)).toBe(false);
  });

  it('keeps the outbox when the session has ended elsewhere', async () => {
    const accountId = `acct-${crypto.randomUUID()}`;
    const name = `tally-${accountId}`;
    await seedOutbox(accountId, name);
    let signedOut = 0;
    const transport: Transport = async () => ({ kind: 'status', status: 401 });
    const device = await startDevice({
      accountId,
      personId: 'p',
      transport,
      environment: quiet,
      name,
      onSignedOut: () => signedOut++,
    });
    await device.loop.syncNow();
    expect(signedOut).toBe(1);
    expect(await readOutbox(device.db)).toHaveLength(1);
  });
});
