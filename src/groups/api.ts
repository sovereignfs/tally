import { getDatabase } from '../db/boot';
import type { Database } from '../db/client';
import type { AccountContext } from '../access/route';
import { readCapped } from '../access/body';
import { OPERATIONS, OpError, type OperationName } from './ops';

/**
 * `POST /api/ops` (DESIGN.md §11.6): the online operations of groups, one handler each, chosen by `op`, answered at once with the group's new state.
 * A refusal for a group that is not the account's is a 404 with no body, as a group that is not there; a rule that holds is a 409 with a sentence.
 */
const MAX_BODY = 16 * 1024;

const STATUS: Record<Exclude<OpError['code'], 'not_found'>, number> = {
  invalid: 400,
  id_taken: 409,
  last_owner: 409,
  too_many_groups: 409,
};

export function opsHandler(databaseOf: () => Promise<Database> = getDatabase) {
  return async ({ request, accountId, personId }: AccountContext): Promise<Response> => {
    try {
      const text = await readCapped(request, MAX_BODY);
      if (text === null) throw new OpError('invalid');
      let input: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(text || '{}');
        if (typeof value !== 'object' || value === null || Array.isArray(value))
          throw new OpError('invalid');
        input = value as Record<string, unknown>;
      } catch {
        throw new OpError('invalid');
      }
      const name = input.op;
      if (typeof name !== 'string' || !Object.hasOwn(OPERATIONS, name))
        throw new OpError('invalid');
      const operation = OPERATIONS[name as OperationName];
      const state = await operation(await databaseOf(), { accountId, personId }, input);
      return Response.json(state, { status: name === 'group.create' ? 201 : 200 });
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      if (error.code === 'not_found') return new Response(null, { status: 404 });
      return Response.json(
        { code: error.code, ...(error.sentence ? { message: error.sentence } : {}) },
        { status: STATUS[error.code] },
      );
    }
  };
}
