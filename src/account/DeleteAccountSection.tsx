'use client';

import { useEffect, useState } from 'react';
import { messageFor } from '../auth/messages';
import { signInValue } from '../auth/derive';
import { deleteVault } from '../cipher/vault';
import { signOutDevice } from '../sync/device';
import { Alert, Button, FormField, Input } from '@sovereignfs/ui';
import styles from './Account.module.css';

interface Preview {
  /** Whether it asks for the password; an account that came in through Sovereign has none, and a session made just now stands in. */
  password: boolean;
  /** The groups that would go with the account, no other account being in them, and those that carry on for the others, by id. */
  groupsDeleted: string[];
  groupsLeft: string[];
}

/**
 * Settings, Data, Delete account (DESIGN.md §18). **It says what goes and what stays before it asks:** the account and everything personal of it goes; the
 * name stays on the groups the others share, so that their numbers still add up; a group with no one else with an account goes with it. It asks for the
 * password, sent as the value derived from it (or, for an account with none, a recent sign-in). Copied from Ledger's.
 */
export function DeleteAccountSection({ accountId, email }: { accountId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const reply = await fetch('/api/account/delete', { cache: 'no-store' });
        if (reply.ok) setPreview((await reply.json()) as Preview);
        else setProblem('This needs a connection.');
      } catch {
        setProblem('This needs a connection.');
      }
    })();
  }, [open]);

  async function remove() {
    setWorking(true);
    setProblem(null);
    try {
      const reply = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          password: password === '' ? '' : await signInValue(password, email),
        }),
      });
      if (reply.status === 403) {
        const { code } = (await reply.json().catch(() => ({}))) as { code?: string };
        return setProblem(
          code === 'SESSION_NOT_FRESH'
            ? messageFor({ code }, 'Sign in again, and then try this once more.')
            : 'That is not your password.',
        );
      }
      if (reply.status === 429)
        return setProblem('That was tried too many times. Wait a few minutes.');
      if (!reply.ok)
        return setProblem(
          'That could not be done. Nothing was deleted, or it was only partly: try again.',
        );
      // The account is gone, and with it this device's copy of its key; the page starts again from the front.
      setPassword('');
      await deleteVault(accountId).catch(() => undefined);
      await signOutDevice(accountId, 0).catch(() => undefined);
      window.location.assign('/');
    } catch {
      setProblem('That needs a connection.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={styles.group}>
      <h2>Delete account</h2>
      {!open ? (
        <>
          <p className={styles.muted}>
            Deletes your account and everything personal of it. Your name stays on the groups you
            share, so that the others’ numbers still add up. It cannot be undone.
          </p>
          <div className={styles.row}>
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Delete my account…
            </Button>
          </div>
        </>
      ) : (
        <form
          className={styles.form}
          aria-label="Delete account"
          onSubmit={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          <p>
            This deletes your account, your sign-in, your keys and your address. Your name stays on
            {preview && preview.groupsLeft.length > 0
              ? ` the ${preview.groupsLeft.length === 1 ? 'group' : `${preview.groupsLeft.length} groups`} you share, shown as left Tally`
              : ' anything you shared'}
            {preview && preview.groupsDeleted.length > 0
              ? `, and ${preview.groupsDeleted.length === 1 ? 'the group' : `${preview.groupsDeleted.length} groups`} no one else is in ${preview.groupsDeleted.length === 1 ? 'goes' : 'go'} with it`
              : ''}
            . It cannot be undone.
          </p>
          {problem ? <Alert variant="error">{problem}</Alert> : null}
          {preview && !preview.password ? (
            <p className={styles.hint}>
              You sign in through Sovereign, so there is no password to ask for. This asks that you
              signed in within the last ten minutes: if you did not, sign out, sign in again, and
              come back.
            </p>
          ) : (
            <FormField label="Your password" required>
              {(field) => (
                <Input
                  {...field}
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </FormField>
          )}
          <div className={styles.row}>
            <Button
              type="submit"
              disabled={working || preview === null || (preview.password && password === '')}
            >
              {working ? 'Deleting…' : 'Delete my account for good'}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
