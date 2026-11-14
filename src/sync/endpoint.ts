import { readCapped } from '../access/body';
import type { AccountContext } from '../access/route';
import { isId } from '../actions/validate';
import { getDatabase } from '../db/boot';
import type { Database } from '../db/client';
import { myGroupWraps, neededGrants, storeGrants, type Grant } from '../keys/grants';
import { dueRotations } from '../keys/rotation';
import { KeyError } from '../keys/store';
import { type Limiter, RateLimiter, type Rule } from '../limits/rate';
import { type Actor, applyMutation } from './apply';
import { LIMITS, type MutationResult, PROTOCOL_VERSION, type SyncResponse } from './format';
import { pull } from './pull';

/**
 * `POST /api/sync` (DESIGN.md §11.3): a device sends its outbox, in order, and how far it has pulled each group, and is answered with what became of
 * each mutation and what changed since. Tusk's endpoint (`src/sync/endpoint.ts`), with a cursor per group and the key exchange folded in.
 *
 * **The status line is for the request, and the body for each mutation.** A request is refused whole when it is not one (400), is too big (413),
 * speaks another protocol (426, so that a device too old updates and keeps its outbox), or comes too often (429). A refused mutation does not refuse
 * the request: the others are applied, the pull is answered, and the device learns which was refused and why (§11.5). Retrying is safe: a mutation
 * already applied answers as before and writes nothing.
 */
export interface SyncDeps {
  database: Database;
  limiter: Limiter;
  now(): number;
  /** Smaller pages, for a test. */
  rowsPerRequest?: number;
}

/** A device syncs after a write, on focus, on coming online and every 30 seconds: this is enough for all of it, and not for hammering the server. */
export const SYNC_RATE: Rule = { limit: 120, windowMs: 60_000 };

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

const isCursor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export async function handleSync(body: string, actor: Actor, deps: SyncDeps): Promise<Response> {
  const taken = await deps.limiter.take(`sync:${actor.accountId}`, SYNC_RATE);
  if (!taken.ok)
    return json(
      429,
      { code: 'RATE_LIMITED' },
      { 'retry-after': String(Math.max(1, Math.ceil(taken.retryAfterMs / 1000))) },
    );

  let request: unknown;
  try {
    request = JSON.parse(body);
  } catch {
    return json(400, { code: 'BAD_REQUEST' });
  }
  if (typeof request !== 'object' || request === null || Array.isArray(request))
    return json(400, { code: 'BAD_REQUEST' });
  const { protocol, mutations, cursors, grants, ...rest } = request as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return json(400, { code: 'BAD_REQUEST' });
  // Before anything else is read of it: a device that is too old may be sending a shape this one no longer knows.
  if (protocol !== PROTOCOL_VERSION)
    return json(426, { code: 'UPDATE_REQUIRED', protocol: PROTOCOL_VERSION });
  if (
    !Array.isArray(mutations) ||
    mutations.length > LIMITS.mutationsPerRequest ||
    typeof cursors !== 'object' ||
    cursors === null ||
    Array.isArray(cursors) ||
    Object.keys(cursors).length > 1_000 ||
    !Object.entries(cursors).every(([id, at]) => isId(id) && isCursor(at)) ||
    (grants !== undefined && (!Array.isArray(grants) || grants.length > LIMITS.grantsPerRequest))
  )
    return json(400, { code: 'BAD_REQUEST' });

  const parsedGrants: Grant[] = [];
  for (const value of (grants as unknown[] | undefined) ?? []) {
    const grant = (value ?? {}) as Record<string, unknown>;
    if (
      typeof grant.groupId !== 'string' ||
      typeof grant.accountId !== 'string' ||
      typeof grant.epoch !== 'number' ||
      typeof grant.wrapped !== 'string'
    )
      return json(400, { code: 'BAD_REQUEST' });
    parsedGrants.push({
      groupId: grant.groupId,
      accountId: grant.accountId,
      epoch: grant.epoch,
      wrapped: grant.wrapped,
    });
  }

  const results: MutationResult[] = [];
  for (const each of mutations as unknown[]) {
    const applied = await applyMutation(deps.database, actor, each, deps.now());
    const claimed = (each as { mutationId?: unknown } | null)?.mutationId;
    const mutationId = isId(claimed) ? claimed : null;
    if (applied.status === 'applied' && mutationId)
      results.push({ mutationId, status: 'applied', seq: applied.seq });
    else if (applied.status === 'refused')
      results.push({ mutationId, status: 'refused', refusal: applied.refusal });
  }

  let granted = { accepted: 0, refused: 0 };
  if (parsedGrants.length > 0) {
    try {
      granted = await storeGrants(deps.database, actor.accountId, parsedGrants, deps.now());
    } catch (error) {
      if (!(error instanceof KeyError)) throw error;
      granted = { accepted: 0, refused: parsedGrants.length };
    }
  }

  const pulled = await pull(
    deps.database,
    actor.accountId,
    cursors as Record<string, number>,
    deps.rowsPerRequest,
  );
  const answer: SyncResponse = {
    protocol: PROTOCOL_VERSION,
    results,
    groups: pulled.groups,
    gone: Object.keys(cursors).filter((id) => !pulled.ids.has(id)),
    keys: {
      wraps: await myGroupWraps(deps.database, actor.accountId),
      needed: await neededGrants(deps.database, actor.accountId),
      rotations: await dueRotations(deps.database, actor.accountId),
      granted,
    },
  };
  return json(200, answer);
}

/** The route: the body read to its limit, then `handleSync` for the session's account and person. */
export function syncHandler(depsOf: () => Promise<SyncDeps> = defaultDeps) {
  return async ({ request, accountId, personId }: AccountContext): Promise<Response> => {
    const body = await readCapped(request, LIMITS.bodyBytes);
    if (body === null) return json(413, { code: 'TOO_LARGE' });
    return handleSync(body, { accountId, personId }, await depsOf());
  };
}

async function defaultDeps(): Promise<SyncDeps> {
  const database = await getDatabase();
  return { database, limiter: new RateLimiter(database), now: Date.now };
}
