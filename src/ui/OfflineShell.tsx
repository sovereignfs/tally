'use client';

import { InsightsPage } from '../screens/InsightsView';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '@sovereignfs/ui';
import { AccountMenu } from '../auth/screens/AccountMenu';
import { type Identity, readIdentity } from '../identity';
import { site } from '../site';
import { SyncProvider } from '../sync/react';
import { GroupPage } from '../screens/GroupPage';
import { RecordScreen } from '../screens/RecordScreen';
import { Home } from '../screens/Home';
import { PeopleList, PersonScreen } from '../screens/People';
import { GroupsList } from '../screens/GroupsList';
import { AppShell } from './AppShell';
import { AddSheet } from '../screens/AddSheet';

/**
 * **The groups with no server document** (DESIGN.md §15.11). The service worker answers a signed-in address with the one page it keeps, `/shell`, which
 * holds nothing of a person; this is that page. It finds who is signed in on the device (`src/identity.ts`), draws the same frame the server's layout
 * draws, and starts the device's sync, which reads the store and sends what is recorded once the network is back. Tusk's `OfflineApp`, for Tally.
 *
 * It chooses the screen from the address, as Tusk's does: a group's page, or the groups.
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
    <SyncProvider accountId={who.id} personId={who.personId}>
      <AppShell
        name={site.name}
        account={<AccountMenu accountId={who.id} name={who.name} email={who.email} />}
      >
        <OfflineScreen />
        <AddSheet />
      </AppShell>
    </SyncProvider>
  );
}

/** The screen for the address (DESIGN.md §15.11): the page the worker answered with is not the page of the address, so it is chosen here. */
function OfflineScreen() {
  const pathname = usePathname();
  const record = /^\/g\/([A-Za-z0-9_-]{1,64})\/(e|p)\/([A-Za-z0-9_-]{1,64})$/.exec(pathname);
  if (record?.[1] && record[3])
    return (
      <RecordScreen
        groupId={record[1]}
        kind={record[2] === 'e' ? 'expense' : 'payment'}
        id={record[3]}
      />
    );
  const group = /^\/g\/([A-Za-z0-9_-]{1,64})/.exec(pathname)?.[1];
  if (group) return <GroupPage groupId={group} />;
  const person = /^\/people\/([A-Za-z0-9_-]{1,64})$/.exec(pathname)?.[1];
  if (person) return <PersonScreen personId={person} />;
  if (pathname === '/people') return <PeopleList />;
  if (pathname === '/insights') return <InsightsPage />;
  if (pathname === '/' || pathname === '/home') return <Home />;
  return (
    <PageContainer>
      <PageHeader
        title="Your groups"
        description="You are offline. What you record is sent when you are back online."
      />
      <GroupsList />
    </PageContainer>
  );
}
