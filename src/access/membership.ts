import { type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { tables } from '../db/tables';

/**
 * **The permission is in the statement** (DESIGN.md §5.2): every read and write of a group's rows names the group together with this condition, that
 * the account is an active member of it, in the same query. Never checked first and then touched; a statement whose condition is false touches
 * nothing and reads nothing, and the caller says "not found". An owner's operation uses `ownerOf`, which adds the role.
 *
 *   sql`UPDATE ${t.grp} SET … WHERE id = ${groupId} AND ${activeMemberOf(db, groupId, accountId)}`
 */
export function activeMemberOf(database: Database, groupId: string | SQL, accountId: string): SQL {
  const t = tables(database);
  return sql`EXISTS (SELECT 1 FROM ${t.member} am JOIN ${t.person} ap ON ap.id = am.person_id
    WHERE am.group_id = ${groupId} AND ap.account_id = ${accountId} AND am.left_at IS NULL)`;
}

export function ownerOf(database: Database, groupId: string | SQL, accountId: string): SQL {
  const t = tables(database);
  return sql`EXISTS (SELECT 1 FROM ${t.member} om JOIN ${t.person} op ON op.id = om.person_id
    WHERE om.group_id = ${groupId} AND op.account_id = ${accountId} AND om.left_at IS NULL AND om.role = 'owner')`;
}
