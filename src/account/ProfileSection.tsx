'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { messageFor } from '../auth/messages';
import { authClient } from '../auth/client';
import { Alert, Avatar, Button, FormField, Input, Select } from '@sovereignfs/ui';
import { CURRENCY_OPTIONS } from '../money/currencies';
import styles from './Account.module.css';

/** The longest a display name may be: a line, as a person writes their own. */
export const MAX_NAME_LENGTH = 100;

/**
 * Settings, Profile (DESIGN.md §16): who the person is here. Their initials; the name every member of their groups sees, which they can change (kept in step
 * with their person, `src/people/persons.ts`); their address, which is shown and not changed here (changing it re-derives the password's value, a task of
 * its own); and their primary currency. Saving needs a connection, and says so when there is none. Copied from Ledger's, with the currency.
 */
export function ProfileSection({
  name,
  email,
  primaryCurrency,
}: {
  name: string;
  email: string;
  primaryCurrency: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const trimmed = value.trim();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { error: failure } = await authClient.updateUser({ name: trimmed });
      if (failure) {
        setError(messageFor(failure));
        return;
      }
      setValue(trimmed);
      setSaved(true);
      // The menu, and every page that says who is signed in, read it from the session.
      router.refresh();
    } catch {
      setError('This needs a connection. Try again when you are back online.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.group}>
        <h2>Avatar</h2>
        <div className={styles.row}>
          <Avatar name={name} size="lg" />
          <p className={styles.hint}>Your initials.</p>
        </div>
      </div>
      <div className={styles.group}>
        <h2>Display name</h2>
        <form onSubmit={onSubmit} className={styles.form} aria-label="Display name">
          {error ? <Alert variant="error">{error}</Alert> : null}
          {saved ? <Alert variant="success">Your name is saved.</Alert> : null}
          <FormField
            label="Name"
            required
            error={
              trimmed.length > MAX_NAME_LENGTH
                ? `At most ${MAX_NAME_LENGTH} characters.`
                : undefined
            }
          >
            {(field) => (
              <Input
                {...field}
                name="name"
                autoComplete="name"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setSaved(false);
                }}
                disabled={busy}
              />
            )}
          </FormField>
          <div>
            <Button
              type="submit"
              loading={busy}
              disabled={trimmed === '' || trimmed === name || trimmed.length > MAX_NAME_LENGTH}
            >
              Save name
            </Button>
          </div>
        </form>
      </div>
      <CurrencyForm initial={primaryCurrency} />
      <div className={styles.group}>
        <h2>Email address</h2>
        <p>{email}</p>
        <p className={styles.hint}>The address you sign in with.</p>
      </div>
    </>
  );
}

/** The primary currency (DESIGN.md §16): new groups start in it, and figures in several currencies list it first. Nothing is ever converted. */
function CurrencyForm({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const reply = await fetch('/api/account/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ primaryCurrency: value }),
      });
      if (!reply.ok) return setError('That could not be saved. Try again.');
      setSaved(value);
    } catch {
      setError('This needs a connection. Try again when you are back online.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.group}>
      <h2>Primary currency</h2>
      <form onSubmit={onSubmit} className={styles.form} aria-label="Primary currency">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <FormField
          label="Currency"
          hint="New groups start in it, and it is listed first. Tally never converts between currencies."
        >
          {(field) => (
            <Select
              {...field}
              name="currency"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
            >
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} · {option.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <div>
          <Button type="submit" loading={busy} disabled={value === saved}>
            Save currency
          </Button>
        </div>
      </form>
    </div>
  );
}
