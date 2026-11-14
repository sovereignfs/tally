'use client';

import { useEffect, useState } from 'react';
import { UserMenu } from '@sovereignfs/ui';
import { authClient } from '../client';
import { forgetIdentity } from '../../identity';
import { deleteVault } from '../../cipher/vault';
import { signOutDevice, watchFailed } from '../../sync/device';
import styles from './AccountMenu.module.css';

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
  // Couldn't sync (DESIGN.md §11.5): a quiet mark on the avatar while any change the server refused is waiting for the person.
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let live = true;
    void watchFailed(accountId, (count) => live && setFailed(count)).then((unsubscribe) => {
      if (live) stop = unsubscribe;
      else unsubscribe();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [accountId]);

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
    forgetIdentity();
    // And its groups: one last try to send what it recorded, then the store deleted.
    await signOutDevice(accountId).catch(() => undefined);
    window.location.assign('/');
  }

  return (
    <span className={styles.wrap}>
      <UserMenu
        name={name}
        email={email}
        size="sm"
        aria-label="User menu"
        items={[
          ...(failed > 0
            ? [
                {
                  label: `Couldn’t sync (${failed})`,
                  icon: 'alert-triangle' as const,
                  onSelect: () => window.location.assign('/settings?section=device'),
                },
              ]
            : []),
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
      {failed > 0 ? (
        <span className={styles.mark} role="status" aria-label="Some changes couldn’t sync" />
      ) : null}
    </span>
  );
}
