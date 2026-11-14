/**
 * Every page and route of the app, and who may use it (DESIGN.md §5.2). A route that is not here, or is here with a method it does not have, fails
 * `routes.test.ts`, so that a new endpoint cannot be added without saying who may call it, and a decision in this table cannot outlive the route.
 * Copied from Ledger's, its "book" made Tally's signed-in account; groups add their own kind with task 3.2.
 *
 *  - `public`: anyone, signed in or not. It shows nothing of anyone's. A public route that changes something says what stands in for a session in
 *    `because`, and the test refuses one that does not.
 *  - `account`: a signed-in account. A page asks `requirePerson()`, itself or in a layout above it; a route is wrapped in `accountRoute`
 *    (`route.ts`), which finds the session, checks `Origin` on a write and hands over the account's id and its person's. The test holds both to it.
 *
 * Whether a person may touch a row is not decided here: it is a condition of the statement that touches it.
 */
export type RouteAccess = { kind: 'public'; because?: string } | { kind: 'account' };

export interface RouteRule {
  /** The route as the app router spells it: `/api/keys/wraps/[id]`. */
  route: string;
  /** For an API route, each method it answers. A page has none. */
  methods?: Record<string, RouteAccess>;
  /** For a page. */
  page?: RouteAccess;
}

const account: RouteAccess = { kind: 'account' };

export const ROUTES: RouteRule[] = [
  // The front address (DESIGN.md §15.3): the landing page for a visitor, and Home for someone with a session cookie, which the proxy shows here by
  // rewriting to `/home`: the address stays `/`, and `/home` itself is sent back to it.
  { route: '/', page: { kind: 'public' } },
  // The places of the app (DESIGN.md §15.3), for someone signed in.
  { route: '/home', page: account },
  { route: '/groups', page: account },
  { route: '/people', page: account },
  { route: '/activity', page: account },
  { route: '/insights', page: account },
  // Signing in (DESIGN.md §14.1). The last two only with mail: without it they are 404, like the routes under /api/auth that send and use the links.
  { route: '/sign-in', page: { kind: 'public' } },
  { route: '/sign-up', page: { kind: 'public' } },
  { route: '/forgot-password', page: { kind: 'public' } },
  { route: '/reset-password', page: { kind: 'public' } },
  // The instance asks it before it sends anyone to the app, and a container's health check does: it says only whether the database answers.
  { route: '/api/health', methods: { GET: { kind: 'public' } } },
  // better-auth's own: it checks `Origin` and the session cookie itself, and rate-limits sign-in (src/auth/auth.ts). Absent, with a 404, when sign-in is off.
  {
    route: '/api/auth/[...all]',
    methods: {
      GET: { kind: 'public' },
      POST: {
        kind: 'public',
        because: 'better-auth checks Origin, the session cookie and the rate limit',
      },
    },
  },
  // The online operations of groups (DESIGN.md §11.6): each carries the account's membership, or an owner's role, in its own statements.
  { route: '/api/ops', methods: { POST: account } },
  // The account's key and its wraps, and a new device's request to be given it (DESIGN.md §5.3): each the account's own, by its session.
  { route: '/api/keys', methods: { GET: account, POST: account, PUT: account } },
  { route: '/api/keys/wraps', methods: { POST: account } },
  { route: '/api/keys/wraps/[id]', methods: { DELETE: account } },
  // A group's key wrapped to each member (DESIGN.md §5.3): taken only between active members of the same group, in the statement.
  { route: '/api/keys/groups', methods: { GET: account, POST: account } },
  { route: '/api/keys/requests', methods: { POST: account } },
  { route: '/api/keys/requests/[id]', methods: { GET: account, POST: account, DELETE: account } },
];
