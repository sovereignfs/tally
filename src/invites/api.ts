import type { AccountContext } from '../access/route';
import { readCapped } from '../access/body';
import { getDatabase } from '../db/boot';
import type { Database } from '../db/client';
import { OpError } from '../groups/errors';
import { acceptInvitation } from './store';

/**
 * `POST /api/invite` (DESIGN.md §6.3): the signed-in account accepts an invitation by its token, which claims the placeholder (`acceptInvitation`). Not
 * found, with no body, for any token that is not a live invitation, whatever the reason; 409 with a sentence for a group the account is already in.
 */
export function acceptHandler(databaseOf: () => Promise<Database> = getDatabase) {
  return async ({ request, accountId, personId }: AccountContext): Promise<Response> => {
    const text = await readCapped(request, 4096);
    let token: string;
    let selfWrap: { epoch: number; wrapped: string } | undefined;
    try {
      const body = JSON.parse(text ?? '') as {
        token?: unknown;
        selfWrap?: { epoch?: unknown; wrapped?: unknown };
      };
      token = typeof body.token === 'string' ? body.token : '';
      const wrap = body.selfWrap;
      if (wrap && typeof wrap.epoch === 'number' && typeof wrap.wrapped === 'string')
        selfWrap = { epoch: wrap.epoch, wrapped: wrap.wrapped };
    } catch {
      return new Response(null, { status: 400 });
    }
    try {
      const claimed = await acceptInvitation(
        await databaseOf(),
        { accountId, personId },
        token,
        Date.now(),
        selfWrap,
      );
      return Response.json(claimed);
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      if (error.code === 'not_found') return new Response(null, { status: 404 });
      return Response.json({ code: error.code, message: error.sentence }, { status: 409 });
    }
  };
}
