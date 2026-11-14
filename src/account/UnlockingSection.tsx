'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button } from '@sovereignfs/ui';
import { RecoveryKeyOffer } from '../keys/RecoveryKeyOffer';
import { httpKeyApi, type ServerKeys } from '../keys/unlock';
import styles from './Account.module.css';

/**
 * Settings, Unlocking (DESIGN.md §5.3, §16): which ways in unlock a new device by themselves (the password, each passkey that can), whether a recovery
 * key is kept, and making one. In plain words, with nothing about keys a person has to understand: what matters is what opens their groups on a new
 * phone.
 */
export function UnlockingSection({
  accountId,
  hasPassword,
}: {
  accountId: string;
  hasPassword: boolean;
}) {
  const [keys, setKeys] = useState<ServerKeys | null>(null);
  const [failed, setFailed] = useState(false);
  const [offer, setOffer] = useState(false);

  const read = useCallback(async () => {
    try {
      setKeys(await httpKeyApi.get());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void read();
  }, [read]);

  const version = keys?.accountKey?.version;
  const current = (keys?.wraps ?? []).filter((w) => w.version === version);
  const password = current.some((w) => w.method === 'password');
  const passkeys = current.filter((w) => w.method === 'passkey').length;
  const recovery = current.some((w) => w.method === 'recovery');

  return (
    <>
      {failed ? (
        <Alert variant="error">This needs a connection. Try again when you are back online.</Alert>
      ) : null}
      <div className={styles.group}>
        <h2>On a new device</h2>
        <p className={styles.muted}>
          Signing in on a new phone or computer opens your groups by itself with:
        </p>
        <ul aria-label="What unlocks a new device">
          {hasPassword ? (
            <li>
              {password
                ? 'Your password.'
                : 'Your password, once you have signed in with it on a device that is unlocked.'}
            </li>
          ) : null}
          <li>
            {passkeys === 0
              ? 'No passkey yet. A passkey added in Security unlocks too, where the device allows it.'
              : `${passkeys === 1 ? 'Your passkey' : `${passkeys} of your passkeys`}.`}
          </li>
          <li>Another of your devices, which asks you to allow the new one.</li>
        </ul>
      </div>
      <div className={styles.group}>
        <h2>Recovery key</h2>
        <p className={styles.muted}>
          {recovery
            ? 'You have kept a recovery key. It opens your groups on a new device when nothing else is at hand. Making a new one replaces it.'
            : 'You have not kept a recovery key. You may never need one: your other devices and the people in your groups can unlock a new device too.'}
        </p>
        <div className={styles.row}>
          <Button
            variant="secondary"
            onClick={() => setOffer(true)}
            disabled={keys === null || version === undefined}
          >
            {recovery ? 'Make a new recovery key' : 'Save a recovery key'}
          </Button>
        </div>
      </div>
      <RecoveryKeyOffer
        accountId={accountId}
        open={offer}
        onClose={() => {
          setOffer(false);
          void read();
        }}
      />
    </>
  );
}
