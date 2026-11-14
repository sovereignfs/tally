import { notFound, redirect } from 'next/navigation';
import { AuthShell } from '@/src/auth/screens/AuthShell';
import { SignInForm } from '@/src/auth/screens/SignInForm';
import { oauthErrorMessage } from '@/src/auth/messages';
import { authSettings, mailAvailable, signUpAvailable } from '@/src/auth/server';
import { getSession } from '@/src/auth/session';

// Decided per request from the settings and the visitor's cookies. Left to Next it would be prerendered at build time, with no settings, as the
// "off" 404 it would then keep.
export const dynamic = 'force-dynamic';

/** Where sign-in may send someone after: an invitation's page of this app, or Home. Never another site, nor any other path a link could name. */
function safeNext(next: string | undefined): string {
  return next && /^\/invite\/[A-Za-z0-9_-]{43}$/.test(next) ? next : '/';
}
export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const settings = authSettings();
  if (!settings) notFound();
  const { error, next } = await searchParams;
  const after = safeNext(typeof next === 'string' ? next : undefined);
  if (await getSession()) redirect(after);
  return (
    <AuthShell title="Sign in to Tally">
      <SignInForm
        local={
          settings.local
            ? { canSignUp: await signUpAvailable(), canReset: mailAvailable() }
            : undefined
        }
        sovereign={settings.sovereign !== undefined}
        failure={oauthErrorMessage(typeof error === 'string' ? error : undefined)}
        next={after}
      />
    </AuthShell>
  );
}
