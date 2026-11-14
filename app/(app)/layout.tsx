import type { ReactNode } from 'react';
import { AccountMenu } from '@/src/auth/screens/AccountMenu';
import { requirePerson } from '@/src/people/session';
import { site } from '@/src/site';
import { AppShell } from '@/src/ui/AppShell';
import { KeyGate } from '@/src/keys/KeyGate';
import { SyncProvider } from '@/src/sync/react';
import { settingsOf } from '@/src/account/settings';
import { getDatabase } from '@/src/db/boot';
import { RememberIdentity } from '@/src/ui/RememberIdentity';
import { AddSheet } from '@/src/screens/AddSheet';

// Every page here is for someone signed in, so it is decided per request, from the cookie.
export const dynamic = 'force-dynamic';

/** The signed-in area: the shell around every place, for a person with a session. A visitor is sent to sign in; with no sign-in on, there is no such place. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // The person, not the auth store's user: the name is the one the person keeps in Tally (DESIGN.md §6.1).
  const { person, session } = await requirePerson();
  return (
    <SyncProvider
      accountId={session.user.id}
      personId={person.id}
      primaryCurrency={(await settingsOf(await getDatabase(), session.user.id)).primaryCurrency}
    >
      <AppShell
        name={site.name}
        account={
          <AccountMenu accountId={session.user.id} name={person.name} email={person.email ?? ''} />
        }
      >
        <KeyGate accountId={session.user.id} />
        <RememberIdentity
          id={session.user.id}
          personId={person.id}
          name={person.name}
          email={person.email ?? ''}
        />
        {children}
        <AddSheet />
      </AppShell>
    </SyncProvider>
  );
}
