import { type LocalDatabase, deleteLocal, localName, openLocal } from '../local/db';
import { outboxSize } from '../local/store';
import { type KeyExchange, SyncClient, type Transport, fetchTransport } from './client';
import { onWake, registerBackgroundSync } from './background';
import { type Loop, type LoopEnvironment, browserEnvironment, startSyncLoop } from './loop';

/**
 * **The device's sync, for the signed-in account** (DESIGN.md §11.1, §11.3, §11.7): opens the account's store, makes the client and starts the loop,
 * asks the browser to keep the store (`navigator.storage.persist()`), and tells the account's other tabs of every change. One per account per page; the
 * screens reach it through `react.tsx`.
 *
 * **Signing out** (`signOutDevice`) tries to send the outbox first, then deletes the store, so that nothing of the account stays on a shared device;
 * it says how many changes it could not send. **An ended session** stops the loop and keeps the outbox for the same account's next sign-in.
 */
export interface Device {
  db: LocalDatabase;
  client: SyncClient;
  loop: Loop;
}

const devices = new Map<string, Promise<Device>>();

export interface DeviceOptions {
  accountId: string;
  personId: string;
  keys?: KeyExchange;
  transport?: Transport;
  environment?: LoopEnvironment;
  /** The store's name, for a test. */
  name?: string;
  onSignedOut?: () => void;
  onUpdateRequired?: () => void;
}

export function startDevice(options: DeviceOptions): Promise<Device> {
  const running = devices.get(options.accountId);
  if (running) return running;
  const started = (async () => {
    const db = await openLocal(options.accountId, options.name ?? localName(options.accountId));
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? undefined
        : new BroadcastChannel(`tally-sync-${options.accountId}`);
    const client = new SyncClient({
      db,
      transport: options.transport ?? fetchTransport,
      personId: options.personId,
      ...(options.keys ? { keys: options.keys } : {}),
      ...(channel ? { channel } : {}),
    });
    const loop = startSyncLoop({
      client,
      lockName: `tally-sync-${options.accountId}`,
      environment: options.environment ?? browserEnvironment(),
      ...(options.onSignedOut ? { onSignedOut: options.onSignedOut } : {}),
      ...(options.onUpdateRequired ? { onUpdateRequired: options.onUpdateRequired } : {}),
    });
    // Background Sync, where the browser has it: a write asks to be woken when the network is back, and a wake is a sync (§11.3).
    client.onWrite(registerBackgroundSync);
    onWake(() => void loop.syncNow());
    // Unsent changes could be lost if the browser evicts the store: asked once, and a refusal changes nothing else (§11.6).
    void globalThis.navigator?.storage?.persist?.().catch(() => false);
    return { db, client, loop };
  })();
  devices.set(options.accountId, started);
  started.catch(() => devices.delete(options.accountId));
  return started;
}

/** The running device of an account on this page, if there is one. */
export const deviceOf = (accountId: string): Promise<Device> | undefined => devices.get(accountId);

/**
 * Signs the device out of an account: one last try to send the outbox (bounded by `timeoutMs`), then the loop stopped and the store deleted. Returns how
 * many changes were still unsent when it was deleted, so that the screen can have warned first (`unsentChanges`).
 */
export async function signOutDevice(
  accountId: string,
  timeoutMs = 3_000,
  name = localName(accountId),
): Promise<void> {
  const running = devices.get(accountId);
  devices.delete(accountId);
  if (running) {
    const device = await running.catch(() => undefined);
    if (device) {
      await Promise.race([
        device.client.sync().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
      device.loop.stop();
      device.client.close();
      device.db.close();
    }
  }
  await deleteLocal(accountId, name).catch(() => undefined);
}

/** How many changes this device has not yet sent: what signing out warns of. */
export async function unsentChanges(accountId: string): Promise<number> {
  const running = devices.get(accountId);
  if (!running) return 0;
  const device = await running.catch(() => undefined);
  return device ? outboxSize(device.db) : 0;
}

/**
 * **Reset this device** (§11.5): its copy of the account's groups deleted, unsent changes and Couldn't sync with it, and the page starts again, pulling
 * every group afresh. The screen says first what would be lost.
 */
export async function resetDevice(accountId: string, name = localName(accountId)): Promise<void> {
  const running = devices.get(accountId);
  devices.delete(accountId);
  const device = await running?.catch(() => undefined);
  if (device) {
    device.loop.stop();
    device.client.close();
    device.db.close();
  }
  await deleteLocal(accountId, name).catch(() => undefined);
}

/** Told when this account's device on the page changes: what the avatar's mark listens to, outside the provider. */
export async function watchFailed(
  accountId: string,
  listener: (count: number) => void,
): Promise<() => void> {
  for (let i = 0; i < 50 && !devices.get(accountId); i++)
    await new Promise((r) => setTimeout(r, 200));
  const device = await devices.get(accountId)?.catch(() => undefined);
  if (!device) return () => undefined;
  const tell = () => void device.db.count('failed').then(listener, () => undefined);
  tell();
  return device.client.subscribe(tell);
}
