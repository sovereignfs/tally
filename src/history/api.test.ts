import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { ensurePerson } from '../people/persons';
import { historyHandler } from './api';

/** An expense's history (DESIGN.md §8.5), read by a member and by nobody else, on each database. */
const { leg } = testTarget();

describe(`an expense's history (${leg})`, () => {
  let t: TwoAccounts;
  let read: (request: Request) => Promise<Response>;
  const groupId = crypto.randomUUID();
  const expenseId = crypto.randomUUID();

  beforeAll(async () => {
    t = await twoAccounts();
    read = accountRoute(
      historyHandler(async () => t.database),
      t.deps,
    );
    const ada = await ensurePerson(t.database, { id: t.ada.id, name: 'Ada', email: t.ada.email });
    const db = tables(t.database);
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.grp} (id, sealed, color, default_currency, simplify_debts, closed_at, key_epoch, seq, created_by, created_at, updated_at)
      VALUES (${groupId}, 's1.1.x', '#2563eb', 'EUR', ${false}, NULL, 1, 3, ${ada.id}, 1, 1)`,
    );
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
      VALUES (${crypto.randomUUID()}, ${groupId}, ${ada.id}, 'owner', 'all', NULL, 1, NULL, 1)`,
    );
    for (const [version, kind, amount] of [
      [1, 'created', 8_000],
      [2, 'edited', 8_400],
    ] as const)
      await dbRun(
        t.database,
        sql`INSERT INTO ${db.revision} (id, group_id, subject, subject_id, version, kind, snapshot, actor_person_id, created_at)
        VALUES (${crypto.randomUUID()}, ${groupId}, 'expense', ${expenseId}, ${version}, ${kind}, ${JSON.stringify({ amount })}, ${ada.id}, ${version})`,
      );
  });
  afterAll(async () => t.close());

  const url = `/api/history?group=${groupId}&subject=expense&id=${expenseId}`;

  it('is every version, oldest first, for a member', async () => {
    const reply = await read(t.request(t.ada, url));
    expect(reply.status).toBe(200);
    const { entries } = (await reply.json()) as {
      entries: { version: number; kind: string; snapshot: { amount: number } }[];
    };
    expect(entries.map((e) => [e.version, e.kind, e.snapshot.amount])).toEqual([
      [1, 'created', 8_000],
      [2, 'edited', 8_400],
    ]);
  });

  it('is nothing to someone not in the group, and refuses what is not a question', async () => {
    expect(await (await read(t.request(t.grace, url))).json()).toEqual({ entries: [] });
    expect(
      (await read(t.request(t.ada, `/api/history?group=${groupId}&subject=grp&id=${expenseId}`)))
        .status,
    ).toBe(400);
    expect((await read(t.request(null, url))).status).toBe(401);
  });
});
