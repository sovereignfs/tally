import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import type { Database } from '../db/client';
import type { Mailer } from '../mail/mailer';
import { resetMessage, verificationMessage } from '../mail/templates';
import * as postgresAuth from '../db/schema/postgres/auth';
import * as sqliteAuth from '../db/schema/sqlite/auth';
import { type AuthSettings, SIGNUP_CLOSED } from './config';
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
}

/** The prefix of better-auth's cookies, so that ours do not collide with another app's on localhost. */
export const COOKIE_PREFIX = 'tally';

/**
 * How recently a session must have been made for the things that ask for a fresh one: deleting an account that has no password to ask for (one that came in
 * through core, task 2.3). Ten minutes: long enough to do it after signing in, short enough that a session left open is not enough.
 */
export const FRESH_SESSION_SECONDS = 10 * 60;

export function createAuth({ settings, name, database, mailer }: AuthDependencies) {
  const schema = database.dialect === 'postgres' ? postgresAuth : sqliteAuth;
  const { local } = settings;
  // Mail is for the password's account: an address is verified, and a password reset, only where there is a password.
  const mail = local ? mailer : undefined;

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
      user: {
        create: {
          // One policy for every way an account can come to be (DESIGN.md §6), here and not in a route, so that it holds for all of them.
          before: async () => {
            if (settings.signUp === 'open') return;
            if ((await countUsers(database)) > 0) {
              // With a code, so that a refusal can be told apart from any other 403.
              throw new APIError('FORBIDDEN', {
                message: 'Sign-up is closed on this instance.',
                code: SIGNUP_CLOSED,
              });
            }
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
      // Must be last: it turns cookies set while handling a Server Action into real ones.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
