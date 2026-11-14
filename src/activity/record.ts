import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { tables } from '../db/tables';
import { type Tell, raiseNotices } from '../notices/raise';
import type { ActivityDetailsOf, ActivityKind } from './kinds';

/**
 * Writes a line of a group's activity (DESIGN.md §12.1). **Called with the transaction of the change that causes it,** so a line exists exactly when
 * its change does. The details hold figures, ids and sealed values, never plain text of what people wrote (§5.3). The notices of the line are raised
 * with it (`src/notices/raise.ts`, §12.2), and `tell` adds the personal ones only the caller knows of.
 */
export async function recordActivity<K extends ActivityKind>(
  tx: Database,
  line: {
    groupId: string;
    actorPersonId: string | null;
    kind: K;
    subjectId: string | null;
    details: ActivityDetailsOf[K];
    now: number;
  },
  tell: readonly Tell[] = [],
): Promise<void> {
  const t = tables(tx);
  const id = crypto.randomUUID();
  await dbAll(
    tx,
    sql`INSERT INTO ${t.activity} (id, group_id, actor_person_id, kind, subject_id, details, created_at)
        VALUES (${id}, ${line.groupId}, ${line.actorPersonId}, ${line.kind}, ${line.subjectId},
                ${JSON.stringify(line.details)}, ${line.now})
        RETURNING id`,
  );
  await raiseNotices(tx, { ...line, id }, tell);
}
