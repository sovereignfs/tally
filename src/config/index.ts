import { type KeyRing, parseKey, ringOf } from '../crypto/keys';
import { DatabaseConfigError, resolveDatabaseSettings, type DatabaseSettings } from '../db/config';
import { readEnvironment, type Env, type ReadFile } from './env';

/** What the app was told, once it has been checked. It grows as the tasks that read a setting are built. */
export interface Config {
  /** The address people use, with no path. Absent when the app is run with no sign-in, which only a development machine does. */
  readonly url: string | undefined;
  /** Whether this process runs the background jobs (DESIGN.md §5): off for all but one process when several share a database. */
  readonly worker: boolean;
  /** Which database, and how to wait for it and migrate it (DESIGN.md §19.1). */
  readonly database: DatabaseSettings;
  /** The instance key, and the one it replaces while a move to a new key is under way; absent when there is none (DESIGN.md §14.4). */
  readonly encryption: KeyRing | undefined;
}

/** One thing that is wrong, in words that name the setting and never its value. */
export type Problem = string;

export type LoadResult =
  | { readonly ok: true; readonly config: Config }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/**
 * Settings that only make sense together: all of them or none. A partial set stops the server at start-up, because the part that is missing
 * would otherwise be found at the moment a person needs it.
 */
const GROUPS: readonly { readonly what: string; readonly names: readonly string[] }[] = [
  {
    what: 'Sovereign sign-in',
    names: ['TALLY_CORE_URL', 'TALLY_CORE_CLIENT_ID', 'TALLY_CORE_CLIENT_SECRET'],
  },
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** localhost, an address on this machine, or a name under `.localhost`: the only places plain http is allowed. */
function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

const KEY_HELP =
  'It is 32 random bytes, in base64, URL-safe base64 or hex (openssl rand -base64 32).';

/** The instance key and the previous one, as a ring, or what is wrong with them. */
function checkKeys(
  current: string | undefined,
  previous: string | undefined,
  problems: Problem[],
): KeyRing | undefined {
  const key = current === undefined ? undefined : parseKey(current);
  const old = previous === undefined ? undefined : parseKey(previous);
  if (current !== undefined && key === undefined)
    problems.push(`TALLY_ENCRYPTION_KEY is not a key. ${KEY_HELP}`);
  if (previous !== undefined && old === undefined)
    problems.push(`TALLY_ENCRYPTION_KEY_PREVIOUS is not a key. ${KEY_HELP}`);
  if (previous !== undefined && current === undefined)
    problems.push(
      'TALLY_ENCRYPTION_KEY_PREVIOUS is given, and there is no TALLY_ENCRYPTION_KEY to move to.',
    );
  if (key && old && key.equals(old))
    problems.push('TALLY_ENCRYPTION_KEY_PREVIOUS is the same key as TALLY_ENCRYPTION_KEY.');
  return ringOf(key, old);
}

/** An http or https address with no user, path, query or fragment, plain http only on this machine. `what` names the setting. */
function checkOrigin(
  value: string,
  what: string,
  example: string,
): { url: string } | { problem: Problem } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { problem: `${what} is not an address. Give it as ${example}.` };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { problem: `${what} must be an http or https address.` };
  }
  if (parsed.protocol === 'http:' && !isLocalHost(parsed.hostname)) {
    return {
      problem: `${what} must be https, except on localhost: passkeys, emailed links and the sign-in redirect are made from it.`,
    };
  }
  if (parsed.username || parsed.password) {
    return { problem: `${what} must not carry a user name or password.` };
  }
  if ((parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    return { problem: `${what} is the address with no path, query or fragment.` };
  }
  return { url: parsed.origin };
}

/**
 * Reads and checks every setting the app has been told. It never throws and never reads the process: the environment and the way to read a
 * file are given, so a test can try every mistake. A message names a setting, and a value appears in none.
 */
export function loadConfig(env: Env, readFile?: ReadFile): LoadResult {
  const problems: Problem[] = [];

  // Every setting is read once, through @sovereignfs/config; a file that cannot be read, or a secret given both ways, is reported alone,
  // since the settings that depend on it would only add problems of their own.
  const reading = readEnvironment(env, readFile);
  if (!reading.ok) return { ok: false, problems: reading.problems };
  const read = reading.read;

  let url: string | undefined;
  const rawUrl = read('TALLY_URL');
  if (rawUrl !== undefined) {
    const checked = checkOrigin(rawUrl, 'TALLY_URL', 'https://tally.example.com');
    if ('problem' in checked) problems.push(checked.problem);
    else url = checked.url;
  }

  const rawWorker = read('TALLY_WORKER');
  if (rawWorker !== undefined && rawWorker !== 'on' && rawWorker !== 'off') {
    problems.push('TALLY_WORKER is on or off.');
  }

  for (const group of GROUPS) {
    const given = group.names.filter((name) => read(name) !== undefined);
    if (given.length > 0 && given.length < group.names.length) {
      const missing = group.names.filter((name) => !given.includes(name));
      problems.push(
        `${group.what} needs all of its settings or none, and ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`,
      );
    }
  }

  // The instance key (DESIGN.md §14.4). Optional until something is stored; a key that is given must be a key, and a message names the setting and
  // never what was given.
  const encryption = checkKeys(
    read('TALLY_ENCRYPTION_KEY'),
    read('TALLY_ENCRYPTION_KEY_PREVIOUS'),
    problems,
  );

  // The database: which of the three forms, and the address it needs. A secret address may arrive as a file.
  let database: DatabaseSettings | undefined;
  try {
    database = resolveDatabaseSettings({
      ...env,
      TALLY_POSTGRES_URL: read('TALLY_POSTGRES_URL'),
      TALLY_POSTGRES_URL_FILE: undefined,
    });
  } catch (error) {
    if (error instanceof DatabaseConfigError) problems.push(error.message);
    else throw error;
  }

  if (problems.length > 0 || database === undefined) return { ok: false, problems };
  return {
    ok: true,
    config: {
      url,
      worker: rawWorker !== 'off',
      database,
      encryption,
    },
  };
}
