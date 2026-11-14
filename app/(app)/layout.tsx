import type { ReactNode } from 'react';
import { AccountMenu } from '@/src/auth/screens/AccountMenu';
import { requirePerson } from '@/src/people/session';
import { site } from '@/src/site';
import { AppShell } from '@/src/ui/AppShell';
import { KeyGate } from '@/src/keys/KeyGate';
import { SyncProvider } from '@/src/sync/react';

// Every page here is for someone signed in, so it is decided per request, from the cookie.
export const dynamic = 'force-dynamic';

/** The signed-in area: the shell around every place, for a person with a session. A visitor is sent to sign in; with no sign-in on, there is no such place. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // The person, not the auth store's user: the name is the one the person keeps in Tally (DESIGN.md §6.1).
  const { person, session } = await requirePerson();
  return (
    <AppShell
      name={site.name}
      account={
        <AccountMenu accountId={session.user.id} name={person.name} email={person.email ?? ''} />
      }
    >
      <KeyGate accountId={session.user.id} />
      <SyncProvider accountId={session.user.id} personId={person.id}>
        {children}
      </SyncProvider>
    </AppShell>
  );
}
