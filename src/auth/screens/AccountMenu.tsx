'use client';

import { useState } from 'react';
import { UserMenu } from '@sovereignfs/ui';
import { authClient } from '../client';
import { deleteVault } from '../../cipher/vault';

/**
 * The avatar menu at the right of the header: who the person is (name and address) and *Sign out*. Signing
 * out needs the server, so that no one else can use the session: a failure to reach it is said, and the person stays signed in.
 */
export function AccountMenu({
  accountId,
  name,
  email,
}: {
  accountId: string;
  name: string;
  email: string;
}) {
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setLeaving(true);
    const { error } = await authClient.signOut();
    // A session that is already gone is as signed out as one that was just ended; only a failure to reach the server is a failure.
    if (error && error.status !== 401) {
      setLeaving(false);
      return;
    }
    // Signing out takes the account's key off this device (DESIGN.md §5.3, §11.7): the next sign-in here unlocks it again as a new device does.
    await deleteVault(accountId).catch(() => undefined);
    window.location.assign('/');
  }

  return (
    <UserMenu
      name={name}
      email={email}
      size="sm"
      aria-label="User menu"
      items={[
        {
          label: 'Settings',
          icon: 'settings',
          onSelect: () => window.location.assign('/settings'),
        },
        {
          label: leaving ? 'Signing out…' : 'Sign out',
          icon: 'log-out',
          destructive: true,
          onSelect: () => void signOut(),
        },
      ]}
    />
  );
}
