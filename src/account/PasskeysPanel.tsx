'use client';

import { useCallback, useEffect, useState } from 'react';
import { authClient } from '../auth/client';
import { forgetPasskey, wrapForPasskey, wrapFromRegistration } from '../keys/passkey-unlock';
import { prfExtension } from '../cipher/prf';
import { messageFor } from '../auth/messages';
import { Alert, Button, FormField, Input } from '@sovereignfs/ui';
import styles from './Account.module.css';

interface Passkey {
  id: string;
  credentialID?: string;
  name?: string | null | undefined;
  createdAt?: Date | string | null | undefined;
}

/**
 * Settings, Security, passkeys (DESIGN.md §14.1, §5.3): added from this device (the browser asks for the fingerprint, face or key), named, renamed and removed. A
 * passkey signs in with no password. It belongs to this address (`TALLY_URL`) and works nowhere else. Where the browser has no passkeys, it says so.
 */
export function PasskeysPanel({ accountId }: { accountId: string }) {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const read = useCallback(async () => {
    const { data, error: failure } = await authClient.passkey.listUserPasskeys();
    if (failure) return setError(messageFor(failure));
    setPasskeys((data ?? []) as Passkey[]);
  }, []);
  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'PublicKeyCredential' in window);
    void read();
  }, [read]);

  async function add() {
    setBusy(true);
    setError(null);
    setNote(null);
    const before = new Set((passkeys ?? []).map((p) => p.id));
    // Made with PRF asked for: an authenticator answers PRF only for a credential made with it (DESIGN.md §5.3).
    const { error: failure, webauthn } = (await authClient.passkey.addPasskey({
      ...(name.trim() ? { name: name.trim() } : {}),
      // TypeScript's DOM types do not know the PRF extension yet, which every current browser takes (WebAuthn Level 3).
      extensions: (await prfExtension()) as AuthenticationExtensionsClientInputs,
      returnWebAuthnResponse: true,
    })) as {
      error: unknown;
      webauthn?: { response: { id: string }; clientExtensionResults: unknown };
    };
    if (failure) {
      setBusy(false);
      return setError('The passkey was not added. Try again, or use another device.');
    }
    setName('');
    const { data } = await authClient.passkey.listUserPasskeys();
    const added = ((data ?? []) as Passkey[]).find((p) => !before.has(p.id));
    // One more touch, so that the passkey unlocks a new device by itself as well as signing in (DESIGN.md §5.3).
    if (added?.credentialID) {
      // Some authenticators give the PRF output as the passkey is made; the others are asked once more.
      const made = webauthn
        ? await wrapFromRegistration(
            accountId,
            webauthn.response.id,
            webauthn.clientExtensionResults,
          ).catch(() => 'no-prf' as const)
        : 'no-prf';
      const outcome =
        made === 'no-prf'
          ? await wrapForPasskey(accountId, added.credentialID).catch(() => 'no-prf' as const)
          : made;
      setNote(
        outcome === 'unlocks'
          ? 'It signs you in, and unlocks your groups on a new device.'
          : 'It signs you in. It cannot unlock a new device by itself: your password or another device does that.',
      );
    }
    setBusy(false);
    await read();
  }
  async function remove(id: string) {
    setError(null);
    const credential = passkeys?.find((p) => p.id === id)?.credentialID;
    const { error: failure } = await authClient.passkey.deletePasskey({ id });
    if (failure) setError(messageFor(failure));
    else if (credential) await forgetPasskey(credential).catch(() => undefined);
    await read();
  }
  async function rename() {
    if (!editing) return;
    const { error: failure } = await authClient.passkey.updatePasskey({
      id: editing.id,
      name: editing.name.trim(),
    });
    if (failure) setError(messageFor(failure));
    setEditing(null);
    await read();
  }

  return (
    <div className={styles.group}>
      <h2>Passkeys</h2>
      <p className={styles.hint}>
        A passkey signs you in with your fingerprint, face or a security key, with no password. It
        works on this address only.
      </p>
      {note ? <Alert variant="success">{note}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {passkeys === null ? <p className={styles.hint}>Loading…</p> : null}
      {passkeys?.length === 0 ? <p className={styles.muted}>You have no passkeys.</p> : null}
      <ul className={styles.devices} aria-label="Your passkeys">
        {(passkeys ?? []).map((each) => (
          <li key={each.id} className={styles.device}>
            {editing?.id === each.id ? (
              <form
                className={styles.row}
                onSubmit={(event) => {
                  event.preventDefault();
                  void rename();
                }}
              >
                <FormField label="Name">
                  {(field) => (
                    <Input
                      {...field}
                      value={editing.name}
                      onChange={(e) => setEditing({ id: each.id, name: e.target.value })}
                    />
                  )}
                </FormField>
                <Button type="submit" size="sm">
                  Save
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <div>
                  <span className={styles.deviceName}>{each.name || 'A passkey'}</span>
                  <span className={styles.hint}>
                    {each.createdAt ? `Added ${new Date(each.createdAt).toLocaleDateString()}` : ''}
                  </span>
                </div>
                <div className={styles.row}>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Rename ${each.name || 'a passkey'}`}
                    onClick={() => setEditing({ id: each.id, name: each.name ?? '' })}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Remove ${each.name || 'a passkey'}`}
                    onClick={() => void remove(each.id)}
                  >
                    Remove
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {supported ? (
        <form
          className={styles.row}
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <FormField label="Name for the new passkey">
            {(field) => (
              <Input
                {...field}
                placeholder="This laptop"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </FormField>
          <Button type="submit" disabled={busy}>
            Add a passkey
          </Button>
        </form>
      ) : (
        <p className={styles.muted}>This browser cannot make passkeys.</p>
      )}
    </div>
  );
}
