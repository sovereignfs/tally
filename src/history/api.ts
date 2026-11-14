import { sql } from 'drizzle-orm';
import { activeMemberOf } from '../access/membership';
import type { AccountContext } from '../access/route';
import { isId } from '../actions/validate';
import { getDatabase } from '../db/boot';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { tables } from '../db/tables';

/**
 * `GET /api/history?group=&subject=expense|payment&id=` (DESIGN.md §8.5, §11.6): every version of an expense or a payment, oldest first, with how it
 * came about, who, when, and the row as it was (its text still sealed: the device opens it and says the changes in words). Read online, as §11.6 says.
 * **The permission is in the statement:** only a group the account is an active member of answers, and anything else is an empty list, as a row with no
 * history.
 */
export interface HistoryEntry {
  version: number;
  kind: 'created' | 'edited' | 'deleted' | 'restored' | 'replaced';
  actorPersonId: string | null;
  createdAt: number;
  snapshot: Record<string, unknown>;
}

export function historyHandler(databaseOf: () => Promise<Database> = getDatabase) {
  return async ({ request, accountId }: AccountContext): Promise<Response> => {
    const query = new URL(request.url).searchParams;
    const group = query.get('group');
    const subject = query.get('subject');
    const id = query.get('id');
    if (!isId(group) || !isId(id) || (subject !== 'expense' && subject !== 'payment'))
      return Response.json({ code: 'invalid' }, { status: 400 });
    const database = await databaseOf();
    const t = tables(database);
    const rows = await dbAll<{
      version: number;
      kind: HistoryEntry['kind'];
      actor: string | null;
      createdAt: number;
      snapshot: string;
    }>(
      database,
      sql`SELECT r.version, r.kind, r.actor_person_id AS actor, r.created_at AS "createdAt", r.snapshot FROM ${t.revision} r
          WHERE r.group_id = ${group} AND r.subject = ${subject} AND r.subject_id = ${id} AND ${activeMemberOf(database, group, accountId)}
          ORDER BY r.created_at, r.version, r.id`,
    );
    const entries: HistoryEntry[] = rows.map((r) => ({
      version: Number(r.version),
      kind: r.kind,
      actorPersonId: r.actor,
      createdAt: Number(r.createdAt),
      snapshot: JSON.parse(r.snapshot) as Record<string, unknown>,
    }));
    return Response.json({ entries }, { headers: { 'cache-control': 'no-store' } });
  };
}
