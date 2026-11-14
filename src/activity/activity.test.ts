import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import {
  addComment,
  addExpense,
  addPayment,
  deleteExpense,
  editExpense,
  expenseRow,
  restoreExpense,
} from '../actions';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import { toMinor } from '../money/amount';
import { personOfAccount } from '../people/persons';
import { type Actor, applyMutation } from '../sync/apply';
import { activityHandler } from './api';
import type { ActivityLine } from './kinds';

/**
 * The activity log (DESIGN.md §12.1) on each database: every kind a change of today's makes is written by that change, in its transaction (a refused
 * change writes none), and read back only by the group's active members, newest first, a page at a time, filtered by group, person and kind.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;
const m = (value: number) => toMinor(value);

describe(`activity (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let read: (request: Request) => Promise<Response>;
  let ada: Actor;
  let sealed = '';
  const groupId = crypto.randomUUID();
  let adaMember = '';
  let n = 0;
  const mid = () => `mutation-${++n}-${crypto.randomUUID().slice(0, 8)}`;

  const op = (who: Person, body: Record<string, unknown>) =>
    ops(t.request(who, '/api/ops', { method: 'POST', body }));
  async function lines(who: Person, query = '') {
    const reply = await read(t.request(who, `/api/activity${query}`));
    expect(reply.status).toBe(200);
    return (await reply.json()) as { lines: ActivityLine[]; next: string | null };
  }
  const kinds = async (where = sql`1 = 1`) =>
    (
      await dbAll<{ kind: string }>(
        t.database,
        sql`SELECT kind FROM ${tables(t.database).activity} WHERE group_id = ${groupId} AND ${where} ORDER BY created_at, id`,
      )
    ).map((r) => r.kind);

  function row(amount: number) {
    const made = expenseRow(
      {
        sealed,
        amount: m(amount),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'general',
        method: 'equal',
        payers: [{ memberId: adaMember, amount: m(amount) }],
        split: [{ memberId: adaMember, units: null }],
      },
      [adaMember],
    );
    if (!made.ok) throw new Error(made.refusal.code);
    return made.value;
  }

  beforeAll(async () => {
    t = await twoAccounts();
    ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    read = accountRoute(
      activityHandler(async () => t.database),
      t.deps,
    );
    for (const who of [t.ada, t.grace])
      await op(who, { op: 'group.read', groupId: crypto.randomUUID() });
    const key = await importGroupKey(newGroupKey());
    sealed = await sealRow({ name: 'Lisbon' }, key, 1, {
      group: groupId,
      table: 'grp',
      row: groupId,
    });
    ada = {
      accountId: t.ada.id,
      personId: (await personOfAccount(t.database, t.ada.id))?.id ?? '',
    };
  });
  afterAll(async () => t.close());

  it('is written by each operation on the group, in its transaction', async () => {
    expect(
      (
        await op(t.ada, {
          op: 'group.create',
          groupId,
          sealed,
          color: '#2563eb',
          defaultCurrency: 'EUR',
          keyWrap: WRAP,
        })
      ).status,
    ).toBe(201);
    adaMember =
      (
        await dbGet<{ id: string }>(
          t.database,
          sql`SELECT id FROM ${tables(t.database).member} WHERE group_id = ${groupId}`,
        )
      )?.id ?? '';
    await op(t.ada, { op: 'group.rename', groupId, sealed });
    await op(t.ada, { op: 'group.currency', groupId, defaultCurrency: 'USD' });
    await op(t.ada, { op: 'group.simplify', groupId, on: true });
    await op(t.ada, { op: 'member.role', groupId, memberId: adaMember, role: 'owner' });
    // Recolouring and what one hears are not activity.
    await op(t.ada, { op: 'group.recolour', groupId, color: '#16a34a' });
    await op(t.ada, { op: 'member.notify', groupId, notify: 'none' });
    expect(await kinds()).toEqual([
      'group_created',
      'group_renamed',
      'group_currency_changed',
      'group_simplify_changed',
      'role_changed',
    ]);
    const currency = await dbGet<{ details: string }>(
      t.database,
      sql`SELECT details FROM ${tables(t.database).activity} WHERE group_id = ${groupId} AND kind = 'group_currency_changed'`,
    );
    expect(JSON.parse(currency?.details ?? '{}')).toEqual({ from: 'EUR', to: 'USD' });
    // A refused operation (Grace is not in the group) writes nothing.
    expect((await op(t.grace, { op: 'group.simplify', groupId, on: false })).status).toBe(404);
    expect(await kinds()).toHaveLength(5);
  });

  it('is written by each recorded change, with its figures and sealed text, and never by a refused one', async () => {
    // After the operations above, which were stamped with the clock.
    const T = Date.now() + 60_000;
    const expenseId = crypto.randomUUID();
    await applyMutation(
      t.database,
      ada,
      addExpense({ mutationId: mid(), groupId, expenseId, row: row(900) }),
      T + 0,
    );
    await applyMutation(
      t.database,
      ada,
      editExpense({
        mutationId: mid(),
        groupId,
        current: { id: expenseId, version: 1 },
        row: row(800),
      }),
      T + 1,
    );
    // From the base before that edit: in place of it.
    await applyMutation(
      t.database,
      ada,
      editExpense({
        mutationId: mid(),
        groupId,
        current: { id: expenseId, version: 1 },
        row: row(700),
      }),
      T + 2,
    );
    await applyMutation(
      t.database,
      ada,
      deleteExpense({ mutationId: mid(), groupId, current: { id: expenseId, version: 3 } }),
      T + 3,
    );
    // Deleted again: applied, with no line.
    await applyMutation(
      t.database,
      ada,
      deleteExpense({ mutationId: mid(), groupId, current: { id: expenseId, version: 3 } }),
      T + 4,
    );
    await applyMutation(
      t.database,
      ada,
      restoreExpense({ mutationId: mid(), groupId, current: { id: expenseId, version: 4 } }),
      T + 5,
    );
    await applyMutation(
      t.database,
      ada,
      addComment({
        mutationId: mid(),
        groupId,
        commentId: crypto.randomUUID(),
        subject: 'expense',
        subjectId: expenseId,
        sealed,
      }),
      T + 6,
    );
    // Refused: a payment to oneself.
    const refused = await applyMutation(
      t.database,
      ada,
      addPayment({
        mutationId: mid(),
        groupId,
        paymentId: crypto.randomUUID(),
        row: {
          sealed: null,
          fromMemberId: adaMember,
          toMemberId: adaMember,
          amount: m(100),
          currency: 'EUR',
          date: '2026-11-03',
        },
      }),
    );
    expect(refused.status).toBe('refused');
    expect(await kinds(sql`created_at >= ${T}`)).toEqual([
      'expense_added',
      'expense_edited',
      'expense_replaced',
      'expense_deleted',
      'expense_restored',
      'comment_added',
    ]);
    const replaced = await dbGet<{ details: string; actor: string }>(
      t.database,
      sql`SELECT details, actor_person_id AS actor FROM ${tables(t.database).activity} WHERE group_id = ${groupId} AND kind = 'expense_replaced'`,
    );
    expect(JSON.parse(replaced?.details ?? '{}')).toMatchObject({
      amount: 700,
      currency: 'EUR',
      sealed,
      replacedPersonId: ada.personId,
    });
    const comment = await dbGet<{ details: string }>(
      t.database,
      sql`SELECT details FROM ${tables(t.database).activity} WHERE group_id = ${groupId} AND kind = 'comment_added'`,
    );
    expect(JSON.parse(comment?.details ?? '{}')).toEqual({
      subject: 'expense',
      sealed,
      subjectSealed: sealed,
    });
  });

  it('is read back by a member, newest first, a page at a time, and filtered', async () => {
    const all = await lines(t.ada, `?group=${groupId}`);
    expect(all.lines[0]?.kind).toBe('comment_added');
    expect(all.lines.at(-1)?.kind).toBe('group_created');
    expect(all.next).toBeNull();
    const first = await lines(t.ada, '?limit=4');
    expect(first.lines).toHaveLength(4);
    const second = await lines(t.ada, `?limit=4&before=${first.next}`);
    expect(second.lines[0]?.id).not.toBe(first.lines[3]?.id);
    expect([...first.lines, ...second.lines].map((l) => l.id)).toEqual(
      all.lines.slice(0, 8).map((l) => l.id),
    );
    expect((await lines(t.ada, '?kind=expense_deleted')).lines.map((l) => l.kind)).toEqual([
      'expense_deleted',
    ]);
    expect((await lines(t.ada, `?person=${ada.personId}&group=${groupId}`)).lines).toHaveLength(
      all.lines.length,
    );
    expect((await read(t.request(t.ada, '/api/activity?kind=nonsense'))).status).toBe(400);
    expect((await read(t.request(t.ada, '/api/activity?before=nope'))).status).toBe(400);
  });

  it('reads as nothing to someone not in the group, and to a member who left', async () => {
    expect((await lines(t.grace)).lines).toEqual([]);
    expect((await lines(t.grace, `?group=${groupId}`)).lines).toEqual([]);
    expect((await read(t.request(null, '/api/activity'))).status).toBe(401);
    await dbRun(
      t.database,
      sql`UPDATE ${tables(t.database).member} SET left_at = 1 WHERE id = ${adaMember}`,
    );
    try {
      expect((await lines(t.ada, `?group=${groupId}`)).lines).toEqual([]);
    } finally {
      await dbRun(
        t.database,
        sql`UPDATE ${tables(t.database).member} SET left_at = NULL WHERE id = ${adaMember}`,
      );
    }
  });
});
