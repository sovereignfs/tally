import { type SQL, sql } from 'drizzle-orm';
import { activeMemberOf } from '../access/membership';
import type { AccountContext } from '../access/route';
import { DEFAULT_CURRENCY } from '../account/settings';
import { getDatabase } from '../db/boot';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { tables } from '../db/tables';
import type { NoticeKind, NoticeRow } from './kinds';

/**
 * `/api/notices` (DESIGN.md §12.2): what the signed-in account is told, and its reading of it. **Every statement names the account,** and a notice of
 * a group it is no longer an active member of is neither shown nor counted (the membership is in the statement).
 *
 *  - `GET ?before=&limit=`: a page of notices, newest first, each with the activity line it tells of (sealed text still sealed; the device says it in
 *    words) and whether it is read, and how many are unread. Dismissed ones are shown nowhere.
 *  - `POST {action: 'read' | 'dismiss', ids}`: those notices, the account's own; `{action: 'read_all'}` sets `inbox_seen_at`, so everything written
 *    up to now is read; `{action: 'clear_all'}` dismisses them all.
 *
 * Read is per notice or all at once, kept on the server, so that reading on one device reads on another.
 */
export const PAGE = 30;
const MAX_PAGE = 100;
const MAX_IDS = 100;
const CURSOR = /^(\d{1,16})\.([A-Za-z0-9_-]{1,64})$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A notice is unread while it has no `read_at` and was written after the account last marked all read. */
const unread = (seenAt: SQL) => sql`n.read_at IS NULL AND n.created_at > ${seenAt}`;

function seenAtOf(database: Database, accountId: string): SQL {
  return sql`COALESCE((SELECT s.inbox_seen_at FROM ${tables(database).accountSettings} s WHERE s.account_id = ${accountId}), 0)`;
}

export async function listNotices(
  database: Database,
  accountId: string,
  options: { before?: { at: number; id: string }; limit?: number } = {},
): Promise<{ notices: NoticeRow[]; unread: number; next: string | null }> {
  const t = tables(database);
  const limit = options.limit ?? PAGE;
  const seenAt = seenAtOf(database, accountId);
  const where: SQL[] = [
    sql`n.account_id = ${accountId}`,
    sql`n.dismissed_at IS NULL`,
    activeMemberOf(database, sql`n.group_id`, accountId),
  ];
  if (options.before)
    where.push(
      sql`(n.created_at < ${options.before.at} OR (n.created_at = ${options.before.at} AND n.id < ${options.before.id}))`,
    );
  const rows = await dbAll<{
    id: string;
    kind: NoticeKind;
    groupId: string;
    createdAt: number;
    isUnread: number | boolean;
    lineId: string;
    lineKind: NoticeRow['line']['kind'];
    actorPersonId: string | null;
    subjectId: string | null;
    details: string;
    lineAt: number;
  }>(
    database,
    sql`SELECT n.id, n.kind, n.group_id AS "groupId", n.created_at AS "createdAt",
               CASE WHEN ${unread(seenAt)} THEN 1 ELSE 0 END AS "isUnread",
               a.id AS "lineId", a.kind AS "lineKind", a.actor_person_id AS "actorPersonId", a.subject_id AS "subjectId", a.details,
               a.created_at AS "lineAt"
        FROM ${t.notice} n JOIN ${t.activity} a ON a.id = n.activity_id AND a.group_id = n.group_id
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY n.created_at DESC, n.id DESC LIMIT ${limit + 1}`,
  );
  const count = await dbGet<{ n: number }>(
    database,
    sql`SELECT COUNT(*) AS n FROM ${t.notice} n
        WHERE n.account_id = ${accountId} AND n.dismissed_at IS NULL AND ${unread(seenAt)}
          AND ${activeMemberOf(database, sql`n.group_id`, accountId)}`,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    notices: page.map((r) => ({
      id: r.id,
      kind: r.kind,
      groupId: r.groupId,
      read: Number(r.isUnread) !== 1,
      createdAt: Number(r.createdAt),
      line: {
        id: r.lineId,
        groupId: r.groupId,
        kind: r.lineKind,
        actorPersonId: r.actorPersonId,
        subjectId: r.subjectId,
        details: JSON.parse(r.details) as unknown,
        createdAt: Number(r.lineAt),
      },
    })),
    unread: Number(count?.n ?? 0),
    next: rows.length > limit && last ? `${Number(last.createdAt)}.${last.id}` : null,
  };
}

export async function readNotices(
  database: Database,
  accountId: string,
  action: 'read' | 'dismiss' | 'read_all' | 'clear_all',
  ids: readonly string[],
  now: number,
): Promise<void> {
  const t = tables(database);
  if (action === 'read_all') {
    await dbAll(
      database,
      sql`INSERT INTO ${t.accountSettings} (account_id, primary_currency, inbox_seen_at, created_at, updated_at)
          VALUES (${accountId}, ${DEFAULT_CURRENCY}, ${now}, ${now}, ${now})
          ON CONFLICT (account_id) DO UPDATE SET inbox_seen_at = ${now}, updated_at = ${now}
          RETURNING account_id`,
    );
    return;
  }
  if (action === 'clear_all') {
    await dbAll(
      database,
      sql`UPDATE ${t.notice} SET dismissed_at = ${now} WHERE account_id = ${accountId} AND dismissed_at IS NULL RETURNING id`,
    );
    return;
  }
  if (ids.length === 0) return;
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  await dbAll(
    database,
    action === 'read'
      ? sql`UPDATE ${t.notice} SET read_at = ${now} WHERE account_id = ${accountId} AND read_at IS NULL AND id IN (${list}) RETURNING id`
      : sql`UPDATE ${t.notice} SET dismissed_at = ${now} WHERE account_id = ${accountId} AND dismissed_at IS NULL AND id IN (${list}) RETURNING id`,
  );
}

export function noticesHandler(databaseOf: () => Promise<Database> = getDatabase) {
  return {
    async GET({ request, accountId }: AccountContext): Promise<Response> {
      const query = new URL(request.url).searchParams;
      const before = query.get('before');
      const limitText = query.get('limit');
      const limit = limitText === null ? PAGE : Number(limitText);
      const cursor = before === null ? null : CURSOR.exec(before);
      if (
        (before !== null && !cursor) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAX_PAGE
      )
        return Response.json({ code: 'invalid' }, { status: 400 });
      const answer = await listNotices(await databaseOf(), accountId, {
        limit,
        ...(cursor ? { before: { at: Number(cursor[1]), id: cursor[2] ?? '' } } : {}),
      });
      return Response.json(answer, { headers: { 'cache-control': 'no-store' } });
    },
    async POST({ request, accountId }: AccountContext): Promise<Response> {
      const body = (await request.json().catch(() => null)) as {
        action?: unknown;
        ids?: unknown;
      } | null;
      const action = body?.action;
      const ids = body?.ids ?? [];
      if (
        (action !== 'read' &&
          action !== 'dismiss' &&
          action !== 'read_all' &&
          action !== 'clear_all') ||
        !Array.isArray(ids) ||
        ids.length > MAX_IDS ||
        !ids.every((id) => typeof id === 'string' && ID.test(id))
      )
        return Response.json({ code: 'invalid' }, { status: 400 });
      await readNotices(await databaseOf(), accountId, action, ids as string[], Date.now());
      return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    },
  };
}
