import type { Problem } from '../config';

/**
 * How people sign in (DESIGN.md §14.1), checked once at start-up with the other settings (`src/config/index.ts`), which is why this reads through
 * a function it is given and not the environment. A wrong setting is a problem that stops the server, and no message carries a value.
 *
 *   TALLY_AUTH_LOCAL                 1 or true: email and password. Off means off: `/sign-in`, `/sign-up` and `/api/auth` answer 404.
 *   TALLY_AUTH_SECRET[_FILE]         32 characters or more, to sign sessions and tokens. Required with local sign-in.
 *   TALLY_AUTH_SIGNUP                `invite` (the default): the first account, and anyone holding a valid invitation (DESIGN.md §6.4).
 *                                      `closed`: the first account only; an invitation is accepted by signing in. `open`: anyone who can reach the
 *                                      page. A self-hoster who forgets is not an open registration.
 *   TALLY_AUTH_PASSWORD_MIN_LENGTH   the shortest password, 10 by default.
 *   TALLY_URL                        the address people use; required with either way (links, cookies, passkeys and the redirect are made from it).
 *   TALLY_CORE_URL, TALLY_CORE_CLIENT_ID, TALLY_CORE_CLIENT_SECRET[_FILE]
 *                                   Sign-in through a Sovereign core (DESIGN.md §14.1): all three or none. Either way, or both, can be on. An
 *                                   account made through core is made whatever TALLY_AUTH_SIGNUP says (§6.4): the core decides who may sign in.
 *
 * With neither way on there is no sign-in at all, and the other settings here are not read.
 */
export interface AuthSettings {
  /** The address people use, an origin with no path. */
  readonly url: string;
  readonly secret: string;
  readonly signUp: 'open' | 'closed' | 'invite';
  readonly passwordMinLength: number;
  /** Email and password, passkeys and an authenticator app are on. Off means off: their pages and routes answer 404. */
  readonly local: boolean;
  /** Sign-in through a core, or `undefined` when it is not set up. */
  readonly sovereign: SovereignSettings | undefined;
}

export interface SovereignSettings {
  /** Core's address, its OIDC issuer: no trailing slash. Its discovery document is at `/.well-known/openid-configuration` under it. */
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** The id Sovereign sign-in is known by: it is in the redirect address registered with core, and it is the `provider_id` of the account it makes. */
export const SOVEREIGN_PROVIDER_ID = 'sovereign';

/**
 * What Tally asks core for. The manifest (`sovereign.manifest.json`) says the same, which a test holds it to. `offline_access` and `directory` are for
 * finding people in core's directory as the person (DESIGN.md §14.4): without them, adding people works as alone.
 */
export const SOVEREIGN_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'directory'];

export const MIN_SECRET_LENGTH = 32;
const DEFAULT_PASSWORD_MIN_LENGTH = 10;
const LONGEST_MIN_PASSWORD = 128;

/** The code a refused sign-up carries, in the API's answer. */
export const SIGNUP_CLOSED = 'SIGNUP_CLOSED';

/** Reads a setting by name, as `loadConfig` does: a secret may be a file, and an empty value is no value. */
export type Read = (name: string) => string | undefined;

/**
 * `url` is `TALLY_URL` once checked, and absent when it was not given or was wrong (which `loadConfig` has already reported). Returns the
 * settings, or `undefined` when sign-in is off; a wrong setting is pushed to `problems`.
 */
export function resolveAuth(
  read: Read,
  url: string | undefined,
  problems: Problem[],
): AuthSettings | undefined {
  const local = readFlag(read, 'TALLY_AUTH_LOCAL', problems);
  const sovereign = resolveSovereign(read, problems);
  if (!local && !sovereign) return undefined;
  const why = local ? 'TALLY_AUTH_LOCAL is on' : 'Sovereign sign-in is set';

  if (url === undefined && read('TALLY_URL') === undefined) {
    problems.push(
      `${why}, so TALLY_URL (the address people use) is required: links, cookies and the sign-in redirect are made from it.`,
    );
  }

  const secret = read('TALLY_AUTH_SECRET');
  if (secret === undefined) {
    problems.push(`${why}, so TALLY_AUTH_SECRET (or TALLY_AUTH_SECRET_FILE) is required.`);
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `TALLY_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (openssl rand -base64 48 makes one).`,
    );
  }

  // Unset, it is by invitation (§6.4). It governs local accounts: one made through core is made whatever it says, since the core decides who may
  // sign in (contracts/app-manifest.md §4 in sovereignfs/sovereign).
  const rawSignUp = (read('TALLY_AUTH_SIGNUP') ?? '').toLowerCase() || 'invite';
  const signUpOk = rawSignUp === 'open' || rawSignUp === 'closed' || rawSignUp === 'invite';
  if (!signUpOk) problems.push('TALLY_AUTH_SIGNUP is invite, open or closed.');

  const rawLength = read('TALLY_AUTH_PASSWORD_MIN_LENGTH');
  let passwordMinLength = DEFAULT_PASSWORD_MIN_LENGTH;
  if (rawLength !== undefined) {
    const parsed = Number(rawLength);
    if (!Number.isInteger(parsed) || parsed < 8 || parsed > LONGEST_MIN_PASSWORD) {
      problems.push(
        `TALLY_AUTH_PASSWORD_MIN_LENGTH is a whole number from 8 to ${LONGEST_MIN_PASSWORD}.`,
      );
    } else passwordMinLength = parsed;
  }

  if (url === undefined || secret === undefined) return undefined;
  if (secret.length < MIN_SECRET_LENGTH || !signUpOk) return undefined;
  return {
    url,
    secret,
    signUp: rawSignUp as AuthSettings['signUp'],
    passwordMinLength,
    local,
    sovereign,
  };
}

/** A switch is 1 or true to be on, 0 or false (or nothing) to be off; anything else is a mistake and is not guessed at. */
function readFlag(read: Read, name: string, problems: Problem[]): boolean {
  const value = read(name)?.toLowerCase();
  if (value === undefined || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  problems.push(`${name} is 1 or 0.`);
  return false;
}

/**
 * Sovereign sign-in: off when none of the three is given, and a problem (from `loadConfig`'s groups) when only some are, in which case it is
 * left off here and the problem is what stops the server. The secret may be a file. Copied from Tusk's `src/auth/config.ts`.
 */
function resolveSovereign(read: Read, problems: Problem[]): SovereignSettings | undefined {
  const issuer = read('TALLY_CORE_URL');
  const clientId = read('TALLY_CORE_CLIENT_ID');
  const clientSecret = read('TALLY_CORE_CLIENT_SECRET');
  if (issuer === undefined || clientId === undefined || clientSecret === undefined) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    problems.push('TALLY_CORE_URL is not an address. Give it as https://sovereign.example.com.');
    return undefined;
  }
  // The client secret goes to this host, and the people who sign in are trusted as it says they are.
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && isLocalHost(parsed.hostname))
  ) {
    problems.push('TALLY_CORE_URL must be https, except on localhost.');
    return undefined;
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    problems.push('TALLY_CORE_URL has no user, query or fragment.');
    return undefined;
  }
  return {
    issuer: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, ''),
    clientId,
    clientSecret,
  };
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}
