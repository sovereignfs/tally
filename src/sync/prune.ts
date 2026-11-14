import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, transaction } from '../db/exec';
import { tables } from '../db/tables';
import type { JobDefinition } from '../jobs/runner';

/**
 * **Keeping the history small** (DESIGN.md §11.8). Deleted comments are removed for good after 30 days and leave a tombstone of their id and the group's
 * `seq`, so that a device learns of it at its next pull. Tombstones and the record of applied mutations go after 90 days; forgetting a group's tombstones
 * raises its `pruned_through`, and a device whose cursor is older than that is answered with a fresh snapshot of the group (`pull.ts`). Deleted expenses
 * and payments stay: they are part of a group's record.
 *
 * Shaped after Tusk's `src/sync/purge.ts`, per group rather than per account. **Safe from two processes and twice:** each group's removal is one
 * transaction that first moves the group's `seq` on, as a mutation does, so two runs take turns and the second finds nothing left; forgetting tombstones
 * and mutations is a deletion that names its rows, which a second run finds gone. A run does at most `BATCH` comments of a group; the next finishes it.
 */
export const COMMENTS_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const BATCH = 2_000;

export interface Pruned {
  comments: number;
  tombstones: number;
  mutations: number;
}

export async function prune(database: Database, now: number): Promise<Pruned> {
  const t = tables(database);
  const result: Pruned = { comments: 0, tombstones: 0, mutations: 0 };

  // 1. Comments deleted 30 days ago: removed, each leaving a tombstone, group by group.
  const commentCutoff = now - COMMENTS_AFTER_MS;
  const groups = await dbAll<{ groupId: string }>(
    database,
    sql`SELECT DISTINCT group_id AS "groupId" FROM ${t.comment} WHERE deleted_at IS NOT NULL AND deleted_at < ${commentCutoff}`,
  );
  for (const { groupId } of groups) {
    result.comments += await transaction(database, async (tx) => {
      const moved = await dbAll<{ seq: number }>(
        tx,
        sql`UPDATE ${t.grp} SET seq = seq + 1 WHERE id = ${groupId} RETURNING seq`,
      );
      const seq = moved[0]?.seq;
      if (seq === undefined) return 0;
      const gone = await dbAll<{ id: string }>(
        tx,
        sql`DELETE FROM ${t.comment} WHERE id IN (
              SELECT id FROM ${t.comment} WHERE group_id = ${groupId} AND deleted_at IS NOT NULL AND deleted_at < ${commentCutoff}
              ORDER BY id LIMIT ${BATCH})
            RETURNING id`,
      );
      for (const { id } of gone)
        await dbAll(
          tx,
          sql`INSERT INTO ${t.tombstone} (row_table, id, group_id, seq, created_at) VALUES ('comment', ${id}, ${groupId}, ${Number(seq)}, ${now})
              ON CONFLICT (row_table, id) DO NOTHING RETURNING id`,
        );
      return gone.length;
    });
  }

  // 2. Tombstones 90 days old: forgotten, each group's `pruned_through` raised to the last `seq` it forgot, in one transaction per group.
  const keepCutoff = now - KEEP_MS;
  const old = await dbAll<{ groupId: string; through: number }>(
    database,
    sql`SELECT group_id AS "groupId", MAX(seq) AS through FROM ${t.tombstone} WHERE created_at < ${keepCutoff} GROUP BY group_id`,
  );
  for (const { groupId, through } of old) {
    result.tombstones += await transaction(database, async (tx) => {
      await dbAll(
        tx,
        sql`UPDATE ${t.grp} SET pruned_through = CASE WHEN pruned_through < ${Number(through)} THEN ${Number(through)} ELSE pruned_through END
            WHERE id = ${groupId} RETURNING id`,
      );
      const gone = await dbAll<{ id: string }>(
        tx,
        sql`DELETE FROM ${t.tombstone} WHERE group_id = ${groupId} AND created_at < ${keepCutoff} RETURNING id`,
      );
      return gone.length;
    });
  }

  // 3. The record of applied mutations, 90 days old: a device that sends one again after that has long had its answer.
  result.mutations = (
    await dbAll<{ id: string }>(
      database,
      sql`DELETE FROM ${t.appliedMutation} WHERE created_at < ${keepCutoff} RETURNING id`,
    )
  ).length;
  return result;
}

/** The job: every six hours, and once at start. */
export function pruneJob(databaseOf: () => Promise<Database>): JobDefinition {
  return {
    name: 'prune-history',
    everyMs: 6 * 60 * 60 * 1000,
    runAtStart: true,
    async run({ now }) {
      await prune(await databaseOf(), now.getTime());
    },
  };
}
