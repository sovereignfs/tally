import { type SQL, sql } from 'drizzle-orm';
import { activeMemberOf } from '../access/membership';
import type { AccountContext } from '../access/route';
import { getDatabase } from '../db/boot';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { tables } from '../db/tables';
import { type ActivityLine, isActivityKind } from './kinds';

/**
 * `GET /api/activity` (DESIGN.md §12.1, §15.5, §15.8): the activity of every group the account is in, newest first, or of one (`group`), filtered by
 * person (`person`, who did it) and kind (`kind`), a page at a time (`before`, the `next` of the page before). **The permission is in the statement:**
 * only lines of groups the account is an active member of are read, so a member who left reads none of that group's, and a group the account is not
 * in answers as an empty page, as one with nothing in it. The lines carry their details as written, sealed text still sealed: the device says them in
 * words (`describe.ts`). Read online; the expense list is what shows offline.
 */
export const PAGE = 50;
const MAX_PAGE = 200;
const CURSOR = /^(\d{1,16})\.([A-Za-z0-9_-]{1,64})$/;

export function activityHandler(databaseOf: () => Promise<Database> = getDatabase) {
  return async ({ request, accountId }: AccountContext): Promise<Response> => {
    const query = new URL(request.url).searchParams;
    const group = query.get('group');
    const person = query.get('person');
    const kind = query.get('kind');
    const before = query.get('before');
    const limitText = query.get('limit');
    const limit = limitText === null ? PAGE : Number(limitText);
    const cursor = before === null ? null : CURSOR.exec(before);
    if (
      (kind !== null && !isActivityKind(kind)) ||
      (before !== null && !cursor) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_PAGE ||
      (group !== null && group.length > 64) ||
      (person !== null && person.length > 64)
    )
      return Response.json({ code: 'invalid' }, { status: 400 });

    const database = await databaseOf();
    const t = tables(database);
    const where: SQL[] = [activeMemberOf(database, sql`a.group_id`, accountId)];
    if (group !== null) where.push(sql`a.group_id = ${group}`);
    if (person !== null) where.push(sql`a.actor_person_id = ${person}`);
    if (kind !== null) where.push(sql`a.kind = ${kind}`);
    if (cursor) {
      const at = Number(cursor[1]);
      where.push(sql`(a.created_at < ${at} OR (a.created_at = ${at} AND a.id < ${cursor[2]}))`);
    }
    const rows = await dbAll<{
      id: string;
      groupId: string;
      kind: string;
      actorPersonId: string | null;
      subjectId: string | null;
      details: string;
      createdAt: number;
    }>(
      database,
      sql`SELECT a.id, a.group_id AS "groupId", a.kind, a.actor_person_id AS "actorPersonId", a.subject_id AS "subjectId", a.details,
                 a.created_at AS "createdAt"
          FROM ${t.activity} a WHERE ${sql.join(where, sql` AND `)}
          ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit + 1}`,
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const lines = page.map(
      (row) =>
        ({
          ...row,
          createdAt: Number(row.createdAt),
          details: JSON.parse(row.details) as unknown,
        }) as ActivityLine,
    );
    return Response.json(
      { lines, next: rows.length > limit && last ? `${Number(last.createdAt)}.${last.id}` : null },
      { headers: { 'cache-control': 'no-store' } },
    );
  };
}
