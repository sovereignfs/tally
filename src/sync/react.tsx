'use client';

import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { AccountKeys, httpKeyApi } from '../keys/unlock';
import { GroupKeys, httpGrantsApi } from '../keys/groups';
import type { LocalDatabase } from '../local/db';
import type { SyncClient } from './client';
import { type Device, startDevice } from './device';

/**
 * The device's sync for the screens (DESIGN.md §11.1): `SyncProvider` starts it for the signed-in account, with the key exchange folded in
 * (`GroupKeys.exchange`); `useSync` gives the client to write through and `useStoreChanges` re-renders a reader when the store changes, here or in
 * another tab. A screen reads the store and never waits for the network.
 */
const SyncContext = createContext<{ device: Device; groups: GroupKeys } | null>(null);
const MeContext = createContext<{
  accountId: string;
  personId: string;
  primaryCurrency: string;
} | null>(null);

export function SyncProvider({
  accountId,
  personId,
  primaryCurrency = 'EUR',
  children,
}: {
  accountId: string;
  personId: string;
  /** The account's primary currency (§16), which new groups take. */
  primaryCurrency?: string;
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
        keys: {
          exchange: async (keys) => {
            const done = await groups.exchange(keys);
            return { grants: done.grants, opened: done.opened };
          },
        },
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
  const me = useMemo(
    () => ({ accountId, personId, primaryCurrency }),
    [accountId, personId, primaryCurrency],
  );
  return (
    <MeContext.Provider value={me}>
      <SyncContext.Provider value={device}>{children}</SyncContext.Provider>
    </MeContext.Provider>
  );
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

/** Who the device is: the account and its person, for "You" and for which member of a group is the reader. */
export function useMe(): { accountId: string; personId: string; primaryCurrency: string } | null {
  return useContext(MeContext);
}

/**
 * Reads the device's store, again whenever it changes: `undefined` until the store is open and first read. `read` is given the store and returns what a
 * screen shows; `deps` are what else it depends on (an id from the address).
 */
export function useLocal<T>(
  read: (db: LocalDatabase) => Promise<T>,
  deps: readonly unknown[],
): T | undefined {
  const client = useSync();
  const changes = useStoreChanges();
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void read(client.db).then(
      (next) => live && setValue(next),
      () => undefined,
    );
    return () => {
      live = false;
    };
    // `read` is a new function each render; what it reads is named by `deps` and the store's changes.
  }, [client, changes, ...deps]);
  return value;
}
