import { createHash } from 'node:crypto';
import { runMigrations } from '../db/migrate';
import { freshDatabase } from '../db/test-support';
import type { Mailer } from '../mail/mailer';
import { type AuthDependencies, createAuth } from './auth';
import type { AuthSettings } from './config';
import { PASSWORD_FIELDS } from './password-value';

/**
 * Everything a test of the sign-in flows needs: a better-auth instance on a freshly migrated auth store (on whichever database the leg is running),
 * and a client that talks to it the way a browser does: real requests with an Origin, and cookies kept between them. Through `auth.handler`, so
 * what is tested is the HTTP interface and not a shortcut.
 */
export interface TestAuth {
  auth: ReturnType<typeof createAuth>;
  settings: AuthSettings;
  database: Awaited<ReturnType<typeof freshDatabase>>['database'];
  client(): TestClient;
  close(): Promise<void>;
}

const SETTINGS: AuthSettings = {
  url: 'http://localhost:3000',
  secret: 'test-secret-'.padEnd(40, 'x'),
  signUp: 'closed',
  passwordMinLength: 10,
  local: true,
};

/** What a test changes about the instance it gets. */
export type AuthOverrides = Partial<AuthSettings>;

export async function makeAuth(
  overrides: AuthOverrides = {},
  mailer?: Mailer,
  onAccountCreated?: AuthDependencies['onAccountCreated'],
  onAccountUpdated?: AuthDependencies['onAccountUpdated'],
): Promise<TestAuth> {
  const { database } = await freshDatabase('auth');
  await runMigrations(database);
  const settings: AuthSettings = { ...SETTINGS, ...overrides };
  const auth = createAuth({
    settings,
    name: 'Tally',
    database,
    mailer,
    onAccountCreated,
    onAccountUpdated,
  });
  return {
    auth,
    settings,
    database,
    client: () => new TestClient(auth, settings.url),
    close: () => database.close(),
  };
}

export interface Reply {
  status: number;
  headers: Headers;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- a test reads whatever shape better-auth answers with
  setCookies: string[];
}

/**
 * What a browser sends in a password's place, for the tests: base64url of SHA-256 of the phrase, 43 characters, as the real value is (Argon2id,
 * `src/cipher/password.ts`, which a test of the browser runs). The server cannot tell them apart, and Argon2id at 64 MiB for every request of a
 * test would only make the tests slow.
 */
export function asSignInValue(phrase: string): string {
  return createHash('sha256').update(`test:${phrase}`).digest('base64url');
}

/** A request body with every password field turned into its sign-in value, as the browser's forms do (`src/auth/derive.ts`). */
function derived(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const field of PASSWORD_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && !value.startsWith(RAW)) out[field] = asSignInValue(value);
    else if (typeof value === 'string') out[field] = value.slice(RAW.length);
  }
  return out;
}

/** A password field that starts with this is sent as it is, for the tests of what the server does with one that was not derived. */
export const RAW = 'raw:';

/** A browser, in miniature: it keeps the cookies it is given and sends them back. */
export class TestClient {
  readonly jar = new Map<string, string>();

  constructor(
    private readonly auth: { handler(request: Request): Promise<Response> },
    private readonly origin: string,
    private readonly ip = '203.0.113.7',
  ) {}

  /** As another visitor, so that a rate limit on one address does not cross into another test. */
  from(ip: string): TestClient {
    const other = new TestClient(this.auth, this.origin, ip);
    for (const [k, v] of this.jar) other.jar.set(k, v);
    return other;
  }

  post(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    body = derived(body);
    return this.request('POST', path, body, headers);
  }

  get(path: string, headers: Record<string, string> = {}): Promise<Reply> {
    return this.request('GET', path, undefined, headers);
  }

  /** What a browser would send as `Cookie`, for a test that builds its own request (a route handler is called with one, not with a client). */
  cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Follow a full URL (the address a sign-in sends the browser back to) as a GET, without following redirects. */
  follow(url: string): Promise<Reply> {
    const target = new URL(url);
    return this.request('GET', target.pathname + target.search, undefined, {});
  }

  has(cookieNameFragment: string): boolean {
    return [...this.jar.keys()].some((name) => name.includes(cookieNameFragment));
  }

  async request(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Reply> {
    const cookie = this.cookieHeader();
    const request = new Request(new URL(path, this.origin), {
      method,
      redirect: 'manual',
      headers: {
        origin: this.origin,
        'x-forwarded-for': this.ip,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const response = await this.auth.handler(request);
    const setCookies = response.headers.getSetCookie();
    for (const line of setCookies) {
      const pair = line.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '' || /max-age=0/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      // not JSON (a redirect, say): leave it as text
    }
    return { status: response.status, headers: response.headers, body: parsed, setCookies };
  }
}
