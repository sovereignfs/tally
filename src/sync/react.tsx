'use client';

import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { AccountKeys, httpKeyApi } from '../keys/unlock';
import { GroupKeys, httpGrantsApi } from '../keys/groups';
import type { SyncClient } from './client';
import { type Device, startDevice } from './device';

/**
 * The device's sync for the screens (DESIGN.md §11.1): `SyncProvider` starts it for the signed-in account, with the key exchange folded in
 * (`GroupKeys.exchange`); `useSync` gives the client to write through and `useStoreChanges` re-renders a reader when the store changes, here or in
 * another tab. A screen reads the store and never waits for the network.
 */
const SyncContext = createContext<{ device: Device; groups: GroupKeys } | null>(null);

export function SyncProvider({
  accountId,
  personId,
  children,
}: {
  accountId: string;
  personId: string;
  children: ReactNode;
}) {
  const [device, setDevice] = useState<{ device: Device; groups: GroupKeys } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const account = await AccountKeys.open(accountId, httpKeyApi);
      const groups = new GroupKeys(account, httpGrantsApi);
      const started = await startDevice({
        accountId,
        personId,
        keys: { exchange: async (keys) => ({ grants: (await groups.exchange(keys)).grants }) },
        // The session ended elsewhere: sign-in, with the outbox kept for this account (§11.7).
        onSignedOut: () => window.location.assign('/sign-in'),
        onUpdateRequired: () => window.location.reload(),
      });
      if (live) setDevice({ device: started, groups });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accountId, personId]);
  return <SyncContext.Provider value={device}>{children}</SyncContext.Provider>;
}

/** The client to write through, once the device's store is open. */
export function useSync(): SyncClient | null {
  return useContext(SyncContext)?.device.client ?? null;
}

/** The device's group keys: to open and seal what people write. */
export function useGroupKeys(): GroupKeys | null {
  return useContext(SyncContext)?.groups ?? null;
}

/** A number that changes whenever the store does: a reader keys its effect on it to read again. */
export function useStoreChanges(): number {
  const client = useSync();
  const [subscribe, snapshot] = useCounter(client);
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}

const counters = new WeakMap<SyncClient, { value: number }>();
function useCounter(
  client: SyncClient | null,
): [(listener: () => void) => () => void, () => number] {
  const counter = client
    ? (counters.get(client) ?? counters.set(client, { value: 0 }).get(client))
    : undefined;
  return [
    (listener) => {
      if (!client || !counter) return () => undefined;
      return client.subscribe(() => {
        counter.value++;
        listener();
      });
    },
    () => counter?.value ?? 0,
  ];
}
