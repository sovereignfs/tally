'use client';

import { type FormEvent, useState } from 'react';
import { authClient } from '../client';
import { passwordValues } from '../derive';
import { unlockAfterPassword } from '../../keys/after-sign-in';
import { OFFER_FLAG } from '../../keys/RecoveryKeyOffer';
import { messageFor } from '../messages';
import { AuthButton, AuthError, AuthField, AuthForm, Input } from '@sovereignfs/ui';

/** Name, email and password. Without email there is nothing to confirm, so the account is made and the person is signed in. */
export function SignUpForm({ minLength, mail = false }: { minLength: number; mail?: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Checked here, since the server only ever sees the 43 characters derived from it (DESIGN.md §14.1).
    if ([...password].length < minLength) {
      setError(`Use at least ${minLength} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    const values = await passwordValues(password, email);
    const { data, error: failure } = await authClient.signUp.email({
      name,
      email,
      password: values.signIn,
    });
    if (failure) {
      setBusy(false);
      setError(messageFor(failure));
      return;
    }
    // With mail the account is not signed in until the link in the message is used; without it the person is signed in at once.
    if (mail) {
      setBusy(false);
      setSent(true);
      return;
    }
    // Signed in at once: the account's key is made now, wrapped by the password (DESIGN.md §5.3). With mail, it is made at the first sign-in.
    const accountId = (data as { user?: { id?: string } } | null)?.user?.id;
    if (accountId) await unlockAfterPassword(accountId, values.unwrap);
    // The shell offers the recovery key once, now (DESIGN.md §5.3).
    try {
      window.sessionStorage.setItem(OFFER_FLAG, '1');
    } catch {
      // Not offered now; Settings offers it any time.
    }
    window.location.assign('/');
  }

  if (sent)
    return (
      <p role="status">
        Check your email: a link was sent to {email}. Open it to confirm the address and sign in.
      </p>
    );

  return (
    <AuthForm onSubmit={(event) => void onSubmit(event)}>
      <AuthField label="Name">
        {(field) => (
          <Input
            {...field}
            name="name"
            autoComplete="name"
            required
            disabled={busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </AuthField>
      <AuthField label="Email">
        {(field) => (
          <Input
            {...field}
            type="email"
            name="email"
            autoComplete="email"
            required
            disabled={busy}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </AuthField>
      <AuthField
        label="Password"
        hint={`At least ${minLength} characters. A few random words is a good one.`}
      >
        {(field) => (
          <Input
            {...field}
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={minLength}
            disabled={busy}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </AuthField>
      {error ? <AuthError>{error}</AuthError> : null}
      <AuthButton type="submit" loading={busy}>
        Create account
      </AuthButton>
    </AuthForm>
  );
}
