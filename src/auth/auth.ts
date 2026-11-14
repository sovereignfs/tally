import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { symmetricDecrypt } from 'better-auth/crypto';
import { nextCookies } from 'better-auth/next-js';
import { genericOAuth, twoFactor } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import type { Database } from '../db/client';
import type { Mailer } from '../mail/mailer';
import { resetMessage, verificationMessage } from '../mail/templates';
import { INVITE_HEADER } from './invite-header';
import * as postgresAuth from '../db/schema/postgres/auth';
import * as sqliteAuth from '../db/schema/sqlite/auth';
import {
  type AuthSettings,
  SIGNUP_CLOSED,
  SOVEREIGN_PROVIDER_ID,
  SOVEREIGN_SCOPES,
} from './config';
import { countUsers } from './users';
import { PASSWORD_FIELDS, WRONG_RESET_EMAIL, isSignInValue } from './password-value';

/**
 * Sign-in (DESIGN.md §6) on better-auth, stored in the auth store through its Drizzle adapter. Built from settings and a database and nothing
 * global, so a test can make one against any of the three databases (`test-support.ts`); the server makes the one it serves (`server.ts`).
 */
export interface AuthDependencies {
  settings: AuthSettings;
  /** What the app calls itself, for the places a person sees it. */
  name: string;
  /** The auth store's database. */
  database: Database;
  /**
   * Where mail goes, if there is any. **With a mailer an address is verified before the first sign-in (the link signs in) and a forgotten password is reset by
   * a single-use link that ends every other session; without one, neither exists** and the routes that would do them are not mounted (`app/api/auth`).
   */
  mailer?: Mailer | undefined;
  /** Whether a token is a live invitation (`src/invites/store.ts`): what lets an account be made when sign-up is by invitation. */
  invitationValid?: ((token: string) => Promise<boolean>) | undefined;
  /**
   * Called once better-auth has made an account, with what it was made with: the app makes the account's person here (`src/people/persons.ts`).
   * The account is not undone if this fails, since the person is made again at the account's next request; so a failure is not the visitor's.
   */
  onAccountCreated?:
    ((account: { id: string; name: string; email: string }) => Promise<void>) | undefined;
  /** Called once better-auth has changed an account's name or email (Settings): the app keeps the person's in step (`src/people/persons.ts`). */
  onAccountUpdated?:
    ((account: { id: string; name: string; email: string }) => Promise<void>) | undefined;
  /**
   * Called once a core identity is joined to an account (signing in through core for the first time, or linking it from Settings), with the
   * account and the identity's `sub`: the app keeps the `sub` on the person and claims the placeholder linked to it (`src/people/persons.ts`).
   */
  onCoreIdentity?:
    | ((account: { id: string; name: string; email: string }, sub: string) => Promise<void>)
    | undefined;
  /**
   * Called with core's refresh token whenever a sign-in through core hands one over (DESIGN.md §14.4), opened from better-auth's own encryption: the
   * app keeps it sealed for the directory (`src/sovereign/tokens.ts`). Never logged; a failure here never fails the sign-in.
   */
  onCoreToken?:
    ((accountId: string, sub: string, refreshToken: string) => Promise<void>) | undefined;
}

/**
 * The paths that set up an authenticator app. An account that has no password (it came in through core alone) has none to protect: core has its own
 * second factor (DESIGN.md §14.1). The pages do not show them, and these refuse, so that the page is not the only thing that says so. Passkeys stay:
 * for such an account a passkey is what unlocks a new device (§5.3).
 */
const FOR_PASSWORD_ACCOUNTS = [
  '/two-factor/enable',
  '/two-factor/get-totp-uri',
  '/two-factor/generate-backup-codes',
];

/** The prefix of better-auth's cookies, so that ours do not collide with another app's on localhost. */
export const COOKIE_PREFIX = 'tally';

/**
 * How recently a session must have been made for the things that ask for a fresh one: deleting an account that has no password to ask for (one that came in
 * through core, task 2.3). Ten minutes: long enough to do it after signing in, short enough that a session left open is not enough.
 */
export const FRESH_SESSION_SECONDS = 10 * 60;

export function createAuth({
  settings,
  name,
  database,
  mailer,
  invitationValid,
  onAccountCreated,
  onAccountUpdated,
  onCoreIdentity,
  onCoreToken,
}: AuthDependencies) {
  const schema = database.dialect === 'postgres' ? postgresAuth : sqliteAuth;
  const { local, sovereign } = settings;
  // Mail is for the password's account: an address is verified, and a password reset, only where there is a password.
  const mail = local ? mailer : undefined;

  /** Hands core's refresh token to the app, opened from better-auth's encryption of it (`encryptOAuthTokens`). */
  const keepCoreToken = async (account: {
    providerId?: string | null;
    userId?: string | null;
    accountId?: string | null;
    refreshToken?: string | null;
  }) => {
    if (!onCoreToken || account.providerId !== SOVEREIGN_PROVIDER_ID) return;
    const { userId, accountId, refreshToken } = account;
    if (!userId || !accountId || !refreshToken) return;
    try {
      const plain = /^\$ba\$|^[0-9a-f]+$/i.test(refreshToken)
        ? await symmetricDecrypt({ key: settings.secret, data: refreshToken })
        : refreshToken;
      await onCoreToken(userId, accountId, plain);
    } catch {
      // Nothing of it is said: the directory waits for the next sign-in.
    }
  };

  return betterAuth({
    appName: name,
    secret: settings.secret,
    baseURL: settings.url,
    trustedOrigins: [settings.url],
    database: drizzleAdapter(database.db, {
      provider: database.dialect === 'postgres' ? 'pg' : 'sqlite',
      schema,
    }),
    // Without email (task 2.3) there is nothing to verify an address with, so sign-up is immediate and signs the person in.
    emailAndPassword: {
      enabled: local,
      minPasswordLength: settings.passwordMinLength,
      // With mail, a new account is signed in by the link it is sent and not before; without it, at once.
      autoSignIn: mail === undefined,
      requireEmailVerification: mail !== undefined,
      ...(mail
        ? {
            // A reset link is good once and for an hour, and using it ends every session of the account.
            resetPasswordTokenExpiresIn: 60 * 60,
            revokeSessionsOnPasswordReset: true,
            sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
              // Not awaited by the request (a slow mail server would tell a visitor which addresses have accounts by how long it takes) and a failure is not told to them.
              void mail.send(resetMessage(name, user.email, url)).catch(() => undefined);
            },
          }
        : {}),
    },
    ...(mail
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => {
              void mail.send(verificationMessage(name, user.email, url)).catch(() => undefined);
            },
          },
        }
      : {}),
    account: {
      // A core login is matched to an account by its `sub`, never by an email address that happens to be a local account's (DESIGN.md §14.2). The two
      // are linked from a signed-in session, by someone who has shown they control both, and only when core's address is the account's own: a link that
      // came with another address would be a way to attach someone else's identity to this account. Until then a core login whose address is a local
      // account's is refused (`account_not_linked`). As Tusk's.
      accountLinking: {
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        // Unlinking can never leave an account with no way to sign in: its last one stays.
        allowUnlinkingAll: false,
        // Core's contract is that `email` is verified, which is what linking asks of a provider.
        ...(sovereign ? { trustedProviders: [SOVEREIGN_PROVIDER_ID] } : {}),
      },
      // What core hands over is not used after sign-in; what is kept is kept encrypted.
      encryptOAuthTokens: true,
    },
    // A session is fresh for ten minutes (`FRESH_SESSION_SECONDS`), for the few things that ask for it.
    session: { freshAge: FRESH_SESSION_SECONDS },
    // Counted in the database, not in memory, so that a limit holds across every process.
    rateLimit: { enabled: true, storage: 'database' },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: settings.url.startsWith('https:'),
      // better-auth skips its origin check when NODE_ENV is "test", which would let a test pass on behaviour production does not have. Say
      // so, so that the two are the same.
      disableOriginCheck: false,
    },
    // **The password never reaches the server** (DESIGN.md §5.3, §14.1): the browser sends a value Argon2id made from it (`password-value.ts`).
    // Every field that would hold a password must hold such a value, so that an old or a hand-made client cannot store a password as itself, which
    // would sign in and could not unwrap the account's key.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (FOR_PASSWORD_ACCOUNTS.includes(ctx.path)) {
          const session = await getSessionFromCtx(ctx);
          if (session) {
            const accounts = await ctx.context.internalAdapter.findAccounts(session.user.id);
            if (!accounts.some((account) => account.providerId === 'credential'))
              throw new APIError('FORBIDDEN', {
                message: 'This account signs in through Sovereign, which has its own.',
                code: 'NO_PASSWORD_ACCOUNT',
              });
          }
        }
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        for (const field of PASSWORD_FIELDS) {
          if (field in body && !isSignInValue(body[field])) {
            throw new APIError('BAD_REQUEST', {
              message: 'Passwords are sent as the value the sign-in page makes from them.',
              code: 'PASSWORD_NOT_DERIVED',
            });
          }
        }
        // A new password is derived with the address it signs in with, so a reset must be given the address the link was sent to: another
        // would make a password that signs in nowhere. Checked against the account the token belongs to, before the password is changed.
        if (ctx.path === '/reset-password') {
          const token = typeof body.token === 'string' ? body.token : '';
          const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
          const verification = await ctx.context.internalAdapter.findVerificationValue(
            `reset-password:${token}`,
          );
          const user = verification
            ? await ctx.context.internalAdapter.findUserById(verification.value)
            : null;
          // An unknown or used token is left to better-auth, which says so; a known one with another address is refused here.
          if (user && user.email.toLowerCase() !== email) {
            throw new APIError('BAD_REQUEST', {
              message: 'That is not the address this link was sent to.',
              code: WRONG_RESET_EMAIL,
            });
          }
        }
      }),
    },
    databaseHooks: {
      account: {
        // Each sign-in through core writes its tokens to the account row: the refresh token is handed to the app (§14.4).
        update: {
          after: async (account) => {
            await keepCoreToken(account);
          },
        },
        create: {
          // A core identity joined to an account, at its first sign-in through core or linked from Settings: its `sub` is kept on the person.
          after: async (account, context) => {
            await keepCoreToken(account);
            if (account.providerId !== SOVEREIGN_PROVIDER_ID || !onCoreIdentity) return;
            const user = await context?.context.internalAdapter
              .findUserById(account.userId)
              .catch(() => null);
            if (!user) return;
            await onCoreIdentity(
              { id: user.id, name: user.name, email: user.email },
              account.accountId,
            ).catch(() => undefined);
          },
        },
      },
      user: {
        update: {
          after: async (user) => {
            await onAccountUpdated?.({ id: user.id, name: user.name, email: user.email }).catch(
              () => undefined,
            );
          },
        },
        create: {
          // One policy for every way an account can come to be (DESIGN.md §6), here and not in a route, so that it holds for all of them.
          after: async (user) => {
            await onAccountCreated?.({ id: user.id, name: user.name, email: user.email }).catch(
              () => undefined,
            );
          },
          before: async (_user, context) => {
            if (settings.signUp === 'open') return;
            // Through core, whatever the setting (§6.4): the core decides who may sign in, and this instance trusts it to.
            if (sovereign && isCoreCallback(context)) return;
            if ((await countUsers(database)) === 0) return;
            // By invitation (§6.4): an account is made for someone who arrives with a live invitation, checked here, when it is made.
            const invite =
              context?.headers?.get(INVITE_HEADER) ??
              context?.request?.headers.get(INVITE_HEADER) ??
              null;
            if (
              settings.signUp === 'invite' &&
              invite &&
              (await invitationValid?.(invite).catch(() => false))
            )
              return;
            // With a code, so that a refusal can be told apart from any other 403.
            throw new APIError('FORBIDDEN', {
              message: 'Sign-up is closed on this instance.',
              code: SIGNUP_CLOSED,
            });
          },
        },
      },
    },
    plugins: [
      ...(local
        ? [
            // An authenticator app, with ten single-use backup codes (DESIGN.md §14.1, §20). It is on for an account only once a code from the app has been shown to work,
            // and turning it off, or making new backup codes, asks for the password again.
            twoFactor({ issuer: name }),
            // Passkeys, which can sign in with no password. The relying party is the address people use (`TALLY_URL`): a passkey made here works here and nowhere else.
            passkey({ rpID: new URL(settings.url).hostname, rpName: name, origin: settings.url }),
          ]
        : []),
      ...(sovereign
        ? [
            genericOAuth({
              config: [
                {
                  providerId: SOVEREIGN_PROVIDER_ID,
                  discoveryUrl: `${sovereign.issuer}/.well-known/openid-configuration`,
                  // The profile comes from the ID token, so this refuses to run on one that cannot be checked against the issuer's keys.
                  requireIdTokenVerification: true,
                  clientId: sovereign.clientId,
                  clientSecret: sovereign.clientSecret,
                  authentication: 'basic',
                  scopes: SOVEREIGN_SCOPES,
                  pkce: true,
                  // Signing out of Tally does not sign the person out of core, which is their account for other things as well.
                  disableProviderLogout: true,
                  // Core's contract is `sub`, `email` and `name`; a missing name is not a reason to refuse.
                  mapProfileToUser: (profile: Record<string, unknown>) => ({
                    name:
                      typeof profile.name === 'string' && profile.name.trim() !== ''
                        ? profile.name
                        : String(profile.email ?? '').split('@')[0] || 'Sovereign user',
                    emailVerified: profile.emailVerified === true,
                  }),
                },
              ],
            }),
          ]
        : []),
      // Must be last: it turns cookies set while handling a Server Action into real ones.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Whether an account is being made by core's callback (`/callback/sovereign`), the one way an account comes through core. */
function isCoreCallback(context: unknown): boolean {
  const c = context as { path?: unknown; params?: { id?: unknown } } | null | undefined;
  return c?.path === '/callback/:id' && c.params?.id === SOVEREIGN_PROVIDER_ID;
}
