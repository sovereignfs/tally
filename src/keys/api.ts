import { getDatabase } from '../db/boot';
import type { Database } from '../db/client';
import type { AccountContext } from '../access/route';
import { readCapped } from '../access/body';
import {
  KeyError,
  accountKeyOf,
  approveRequest,
  checkNewWrap,
  createAccountKey,
  createRequest,
  deleteRequest,
  deleteWrap,
  pendingRequests,
  putWrap,
  replaceAccountKey,
  requestOf,
  wrapsOf,
} from './store';

/**
 * The routes of an account's key (DESIGN.md §5.3), each the account's own by its session (`accountRoute`): what the browser needs to unlock, and to
 * let another of its devices in. Every answer about another account's row is 404, as a row that is not there.
 */
const MAX_BODY = 16 * 1024;

const STATUS: Record<KeyError['code'], number> = {
  invalid: 400,
  not_found: 404,
  exists: 409,
  too_many: 429,
};

function failure(error: unknown): Response {
  if (error instanceof KeyError) {
    return error.code === 'not_found'
      ? new Response(null, { status: 404 })
      : Response.json({ code: error.code }, { status: STATUS[error.code] });
  }
  throw error;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await readCapped(request, MAX_BODY);
  if (text === null) throw new KeyError('too_many');
  try {
    const value: unknown = JSON.parse(text || '{}');
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new KeyError('invalid');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof KeyError) throw error;
    throw new KeyError('invalid');
  }
}

const param = (context: AccountContext, name: string): string => {
  const value = context.params[name];
  if (typeof value !== 'string') throw new KeyError('not_found');
  return value;
};

export type DatabaseOf = () => Promise<Database>;

/** The handlers, with the database given, so that a test can call them against its own (`api.test.ts`). */
export function keyHandlers(databaseOf: DatabaseOf = getDatabase) {
  const run = async (work: (db: Database) => Promise<Response>): Promise<Response> => {
    try {
      return await work(await databaseOf());
    } catch (error) {
      return failure(error);
    }
  };
  return {
    /** The key, its wraps, and the requests of new devices waiting for one of this account's devices to let them in. */
    get: (context: AccountContext) =>
      run(async (db) =>
        Response.json({
          accountKey: (await accountKeyOf(db, context.accountId)) ?? null,
          wraps: await wrapsOf(db, context.accountId),
          requests: (await pendingRequests(db, context.accountId)).map(
            ({ id, publicKey, label, createdAt }) => ({
              id,
              publicKey,
              label,
              createdAt,
            }),
          ),
        }),
      ),
    /** Makes the account's key, once. */
    create: (context: AccountContext) =>
      run(async (db) => {
        const input = await body(context.request);
        const wraps = Array.isArray(input.wraps) ? input.wraps.map(checkNewWrap) : [];
        const made = await createAccountKey(
          db,
          context.accountId,
          String(input.publicKey ?? ''),
          wraps,
        );
        return Response.json(made, { status: 201 });
      }),
    /** Replaces the account's key: the last resort. */
    replace: (context: AccountContext) =>
      run(async (db) => {
        const input = await body(context.request);
        const wraps = Array.isArray(input.wraps) ? input.wraps.map(checkNewWrap) : [];
        const made = await replaceAccountKey(
          db,
          context.accountId,
          Number(input.expectedVersion),
          String(input.publicKey ?? ''),
          wraps,
        );
        return Response.json(made);
      }),
    putWrap: (context: AccountContext) =>
      run(async (db) => {
        const input = await body(context.request);
        const id = await putWrap(
          db,
          context.accountId,
          Number(input.version),
          checkNewWrap(input.wrap),
        );
        return Response.json({ id }, { status: 201 });
      }),
    deleteWrap: (context: AccountContext) =>
      run(async (db) => {
        await deleteWrap(db, context.accountId, param(context, 'id'));
        return new Response(null, { status: 204 });
      }),
    createRequest: (context: AccountContext) =>
      run(async (db) => {
        const input = await body(context.request);
        const id = await createRequest(
          db,
          context.accountId,
          String(input.publicKey ?? ''),
          String(input.label ?? ''),
        );
        return Response.json({ id }, { status: 201 });
      }),
    /** The new device asks after its request: waiting, or the key wrapped to it. */
    getRequest: (context: AccountContext) =>
      run(async (db) => {
        const found = await requestOf(db, context.accountId, param(context, 'id'));
        return Response.json({ wrapped: found.wrapped, expiresAt: found.expiresAt });
      }),
    /** Another device allows it. */
    approveRequest: (context: AccountContext) =>
      run(async (db) => {
        const input = await body(context.request);
        await approveRequest(
          db,
          context.accountId,
          param(context, 'id'),
          String(input.wrapped ?? ''),
        );
        return new Response(null, { status: 204 });
      }),
    deleteRequest: (context: AccountContext) =>
      run(async (db) => {
        await deleteRequest(db, context.accountId, param(context, 'id'));
        return new Response(null, { status: 204 });
      }),
  };
}
