import { authSettings, getAuth } from '../auth/server';
import { getDatabase } from '../db/boot';
import { ensurePerson } from '../people/persons';

/**
 * The one way a route that is for a signed-in person is written (DESIGN.md §5.2): it finds the session first, checks `Origin` when it changes
 * something, finds the account's person, and only then calls the handler, with **the account id** (better-auth's user id), **the person's id** and nothing
 * a request said about who the caller is. `routes.test.ts` fails on a route that `routes.ts` says is for an account and that is not
 * wrapped by this, so that a handler cannot be added that forgets to ask.
 *
 *   export const POST = accountRoute(async ({ request, accountId, personId }) => { … });
 *
 * The answers, in the order they are decided, and none of them says more than it must:
 *
 *   404  sign-in is off: there is nobody to be, so there is nothing here (DESIGN.md §14.1)
 *   401  there is no session, or it has ended
 *   403  a request that changes something and does not come from this app's own address (`Origin` is not `TALLY_URL`'s, or is missing)
 */

/** Methods that change nothing. Anything else is a write, and a method we have not heard of is one too. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** What a handler is given. `params` is the route's dynamic segments, as Next gives them, already awaited. */
export interface AccountContext {
  request: Request;
  accountId: string;
  /** The person of the account the session belongs to (DESIGN.md §6.1): never one a request named. */
  personId: string;
  params: Readonly<Record<string, string | string[] | undefined>>;
}

/** What Next calls a route handler with: the request, and the route's dynamic segments, which it gives as a promise. */
export interface RouteContext {
  params?: Promise<Record<string, string | string[] | undefined>>;
}

export type AccountHandler = (context: AccountContext) => Response | Promise<Response>;

/** What the wrapper needs from the rest of the app, so that a test can give it a better-auth instance of its own. */
export interface AccessDeps {
  /** The address people use (`TALLY_URL`'s origin), or undefined when sign-in is off. */
  origin(): string | undefined;
  /** The account the request's cookies belong to, with what it was made with, or null. */
  accountOf(headers: Headers): Promise<{ id: string; name: string; email: string } | null>;
  /** The id of an account's person, made if there is none (`src/people/persons.ts`). */
  personOf(account: { id: string; name: string; email: string }): Promise<string>;
}

/** The server's own: the settings it started with and the better-auth it serves. */
export const serverDeps: AccessDeps = {
  origin: () => authSettings()?.url,
  accountOf: async (headers) => {
    const auth = await getAuth();
    const session = auth ? await auth.api.getSession({ headers }) : null;
    return session
      ? { id: session.user.id, name: session.user.name, email: session.user.email }
      : null;
  },
  personOf: async (account) => (await ensurePerson(await getDatabase(), account)).id,
};

const refuse = (status: 401 | 403 | 404, code: string): Response =>
  new Response(status === 404 ? null : JSON.stringify({ code }), {
    status,
    ...(status === 404 ? {} : { headers: { 'content-type': 'application/json' } }),
  });

/** Decides whether a request may go on, and as whom. Exported for the tests that try every way it can say no. */
export async function authorize(
  request: Request,
  deps: AccessDeps = serverDeps,
): Promise<{ accountId: string; personId: string } | Response> {
  const origin = deps.origin();
  if (origin === undefined) return refuse(404, 'NOT_FOUND');

  const account = await deps.accountOf(request.headers);
  if (account === null) return refuse(401, 'UNAUTHORIZED');

  if (!SAFE_METHODS.has(request.method.toUpperCase()) && request.headers.get('origin') !== origin) {
    return refuse(403, 'FORBIDDEN_ORIGIN');
  }
  return { accountId: account.id, personId: await deps.personOf(account) };
}

/**
 * Marks an answer as one that no cache may keep (DESIGN.md §15.11): what a route says is the person's, and a shared cache between the server and a browser would otherwise be
 * free to hold it. An answer that already says what it may be kept as (a download says `no-store` itself) is left as it is.
 */
export function uncached(reply: Response): Response {
  if (reply.headers.has('cache-control')) return reply;
  try {
    reply.headers.set('cache-control', 'no-store');
    return reply;
  } catch {
    // Headers that cannot be changed (an answer from a fetch, a redirect): the same answer, with its own.
    const headers = new Headers(reply.headers);
    headers.set('cache-control', 'no-store');
    return new Response(reply.body, {
      status: reply.status,
      statusText: reply.statusText,
      headers,
    });
  }
}

/** Wraps a handler so that it runs only for a signed-in account, and is told which, and its person. */
export function accountRoute(
  handler: AccountHandler,
  deps: AccessDeps = serverDeps,
): (request: Request, context?: RouteContext) => Promise<Response> {
  return async (request, context) => {
    const allowed = await authorize(request, deps);
    if (allowed instanceof Response) return uncached(allowed);
    const params = (await context?.params) ?? {};
    return uncached(
      await handler({ request, accountId: allowed.accountId, personId: allowed.personId, params }),
    );
  };
}
