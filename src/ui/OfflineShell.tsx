'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';
import { AccountMenu } from '../auth/screens/AccountMenu';
import { type Identity, readIdentity } from '../identity';
import { readGroups } from '../local/store';
import { site } from '../site';
import { SyncProvider, useGroupKeys, useStoreChanges, useSync } from '../sync/react';
import { AppShell } from './AppShell';

/**
 * **The groups with no server document** (DESIGN.md §15.11). The service worker answers a signed-in address with the one page it keeps, `/shell`, which
 * holds nothing of a person; this is that page. It finds who is signed in on the device (`src/identity.ts`), draws the same frame the server's layout
 * draws, and starts the device's sync, which reads the store and sends what is recorded once the network is back. Tusk's `OfflineApp`, for Tally.
 *
 * The screens of a group arrive with Milestone E; until then it lists the groups this device holds.
 */
export function OfflineShell() {
  // Not known until the page is in the browser: the server renders nothing of a person.
  const [who, setWho] = useState<Identity | null | undefined>(undefined);
  useEffect(() => setWho(readIdentity()), []);

  if (who === undefined) return null;
  if (who === null)
    return (
      <main style={{ padding: 'var(--sv-space-6)', maxWidth: '32rem', margin: '0 auto' }}>
        <h1>Tally</h1>
        <p>Sign in to use Tally. This needs a connection.</p>
        <p>
          <Link href="/sign-in">Sign in</Link>
        </p>
      </main>
    );
  return (
    <AppShell
      name={site.name}
      account={<AccountMenu accountId={who.id} name={who.name} email={who.email} />}
    >
      <SyncProvider accountId={who.id} personId={who.personId}>
        <DeviceGroups />
      </SyncProvider>
    </AppShell>
  );
}

function DeviceGroups() {
  const client = useSync();
  const keys = useGroupKeys();
  const changes = useStoreChanges();
  const [groups, setGroups] = useState<{ id: string; name: string | undefined }[] | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void (async () => {
      const held = await readGroups(client.db);
      const named = await Promise.all(
        held.map(async (group) => ({
          id: group.id,
          name: await keys?.openName(group).catch(() => undefined),
        })),
      );
      if (live) setGroups(named);
    })();
    return () => {
      live = false;
    };
  }, [client, keys, changes]);

  return (
    <PageContainer>
      <PageHeader
        title="Your groups"
        description="You are offline. What you record is sent when you are back online."
      />
      {groups === null ? null : groups.length === 0 ? (
        <EmptyState
          icon="users"
          heading="No groups on this device yet"
          description="Groups open here once this device has been online with them."
        />
      ) : (
        <ul aria-label="Groups on this device">
          {groups.map((group) => (
            <li key={group.id}>{group.name ?? 'A group not yet unlocked on this device'}</li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
