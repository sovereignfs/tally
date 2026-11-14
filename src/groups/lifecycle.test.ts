import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { addExpense, addPayment, deleteExpense, expenseRow } from '../actions';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { toMinor } from '../money/amount';
import { personOfAccount } from '../people/persons';
import { GROUP_TABLES } from '../sovereign/people';
import { type Actor, applyMutation } from '../sync/apply';
import { opsHandler } from './api';

/**
 * A group's lifecycle (DESIGN.md §7.3) over `POST /api/ops`, on each database: leaving, removing and closing guarded by the balances, with the amounts
 * said; a closed group taking nothing but reopen; deleting only a group that never had an expense or a payment, and leaving no row of it anywhere.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;
const m = (value: number) => toMinor(value);

describe(`a group's lifecycle (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let sealed = '';
  let ada: Actor;
  let grace: Actor;
  let n = 0;
  const mid = () => `mutation-${++n}-${crypto.randomUUID().slice(0, 8)}`;
  const call = (who: Person, body: Record<string, unknown>) =>
    ops(t.request(who, '/api/ops', { method: 'POST', body }));
  const db = () => tables(t.database);

  /** A group of Ada's (owner) with Grace as a member and a placeholder, Sam; their member ids. */
  async function group() {
    const groupId = crypto.randomUUID();
    const made = await call(t.ada, {
      op: 'group.create',
      groupId,
      sealed,
      color: '#2563eb',
      defaultCurrency: 'EUR',
      keyWrap: WRAP,
    });
    expect(made.status).toBe(201);
    const ids = {
      groupId,
      ada:
        (
          await dbGet<{ id: string }>(
            t.database,
            sql`SELECT id FROM ${db().member} WHERE group_id = ${groupId}`,
          )
        )?.id ?? '',
      grace: crypto.randomUUID(),
      sam: crypto.randomUUID(),
    };
    const samPerson = crypto.randomUUID();
    await dbRun(
      t.database,
      sql`INSERT INTO ${db().person} (id, name, created_at, updated_at) VALUES (${samPerson}, 'Sam', 1, 1)`,
    );
    for (const [id, personId, role, at] of [
      [ids.grace, grace.personId, 'member', 2],
      [ids.sam, samPerson, null, 3],
    ] as const)
      await dbRun(
        t.database,
        sql`INSERT INTO ${db().member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
            VALUES (${id}, ${groupId}, ${personId}, ${role}, 'all', NULL, ${Date.now() + at}, NULL, 1)`,
      );
    return ids;
  }

  /** Ada pays `amount` for herself and `forId`, equally. */
  async function expense(groupId: string, members: string[], payer: string, amount: number) {
    const row = expenseRow(
      {
        sealed,
        amount: m(amount),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'general',
        method: 'equal',
        payers: [{ memberId: payer, amount: m(amount) }],
        split: members.map((memberId) => ({ memberId, units: null })),
      },
      members,
    );
    if (!row.ok) throw new Error(row.refusal.code);
    const expenseId = crypto.randomUUID();
    const applied = await applyMutation(
      t.database,
      ada,
      addExpense({ mutationId: mid(), groupId, expenseId, row: row.value }),
    );
    expect(applied.status).toBe('applied');
    return expenseId;
  }
  async function pay(
    groupId: string,
    fromMemberId: string,
    toMemberId: string,
    amount: number,
    currency = 'EUR',
  ) {
    const applied = await applyMutation(
      t.database,
      ada,
      addPayment({
        mutationId: mid(),
        groupId,
        paymentId: crypto.randomUUID(),
        row: {
          sealed: null,
          fromMemberId,
          toMemberId,
          amount: m(amount),
          currency,
          date: '2026-11-03',
        },
      }),
    );
    expect(applied.status).toBe('applied');
  }
  const refusal = async (reply: Response) => ({
    status: reply.status,
    ...((await reply.json()) as { code: string; message: string }),
  });

  beforeAll(async () => {
    t = await twoAccounts();
    ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    for (const who of [t.ada, t.grace])
      await call(who, { op: 'group.read', groupId: crypto.randomUUID() });
    sealed = await sealRow({ name: 'Lisbon' }, await importGroupKey(newGroupKey()), 1, {
      group: 'g',
      table: 'grp',
      row: 'g',
    });
    ada = {
      accountId: t.ada.id,
      personId: (await personOfAccount(t.database, t.ada.id))?.id ?? '',
    };
    grace = {
      accountId: t.grace.id,
      personId: (await personOfAccount(t.database, t.grace.id))?.id ?? '',
    };
  });
  afterAll(async () => t.close());

  it('leaving is refused, with the amounts, until the balance is zero; the membership then stays, as left', async () => {
    const g = await group();
    // Ada pays 30.00 for the three: Grace owes 10.00. And Grace gave Ada ¥500, which she is owed: two currencies unsettled.
    await expense(g.groupId, [g.ada, g.grace, g.sam], g.ada, 3_000);
    await pay(g.groupId, g.grace, g.ada, 500, 'JPY');
    const refused = await refusal(await call(t.grace, { op: 'member.leave', groupId: g.groupId }));
    expect(refused).toEqual({
      status: 409,
      code: 'unsettled',
      message: 'You owe €10.00 and are owed ¥500 in this group. Settle up before you leave.',
    });
    await pay(g.groupId, g.grace, g.ada, 1_000);
    await pay(g.groupId, g.ada, g.grace, 500, 'JPY');
    const left = await call(t.grace, { op: 'member.leave', groupId: g.groupId });
    expect(left.status).toBe(200);
    const row = await dbGet<{ leftAt: number | null }>(
      t.database,
      sql`SELECT left_at AS "leftAt" FROM ${db().member} WHERE id = ${g.grace}`,
    );
    expect(row?.leftAt).not.toBeNull();
    // She reads it no more.
    expect((await call(t.grace, { op: 'group.read', groupId: g.groupId })).status).toBe(404);
    expect(
      await dbGet(
        t.database,
        sql`SELECT kind FROM ${db().activity} WHERE group_id = ${g.groupId} AND kind = 'member_left'`,
      ),
    ).toEqual({ kind: 'member_left' });
  });

  it('the last owner cannot leave while someone else with an account is in the group', async () => {
    const g = await group();
    expect(
      await refusal(await call(t.ada, { op: 'member.leave', groupId: g.groupId })),
    ).toMatchObject({ status: 409, code: 'last_owner' });
  });

  it('removing is an owner’s, and refused, with the amounts, until the balance is zero', async () => {
    const g = await group();
    await expense(g.groupId, [g.ada, g.sam], g.ada, 2_000);
    expect(
      (await call(t.grace, { op: 'member.remove', groupId: g.groupId, memberId: g.sam })).status,
    ).toBe(404);
    expect(
      await refusal(
        await call(t.ada, { op: 'member.remove', groupId: g.groupId, memberId: g.sam }),
      ),
    ).toEqual({
      status: 409,
      code: 'unsettled',
      message: 'Sam owes €10.00 in this group. Settle up before they are removed.',
    });
    await pay(g.groupId, g.sam, g.ada, 1_000);
    expect(
      (await call(t.ada, { op: 'member.remove', groupId: g.groupId, memberId: g.sam })).status,
    ).toBe(200);
    // Removing oneself is leaving, not this.
    expect(
      (await call(t.ada, { op: 'member.remove', groupId: g.groupId, memberId: g.ada })).status,
    ).toBe(404);
  });

  it('closing waits until everyone is settled; a closed group takes nothing but reopen, and no expense through sync', async () => {
    const g = await group();
    await expense(g.groupId, [g.ada, g.grace], g.ada, 2_000);
    expect(await refusal(await call(t.ada, { op: 'group.close', groupId: g.groupId }))).toEqual({
      status: 409,
      code: 'unsettled',
      message: '2 people are not settled up. A group is closed once everyone is.',
    });
    expect((await call(t.grace, { op: 'group.close', groupId: g.groupId })).status).toBe(404);
    await pay(g.groupId, g.grace, g.ada, 1_000);
    expect((await call(t.ada, { op: 'group.close', groupId: g.groupId })).status).toBe(200);

    expect(
      await applyMutation(
        t.database,
        ada,
        addExpense({
          mutationId: mid(),
          groupId: g.groupId,
          expenseId: crypto.randomUUID(),
          row: {
            sealed,
            amount: m(100),
            currency: 'EUR',
            date: '2026-11-02',
            category: 'general',
            method: 'equal',
            payers: [{ memberId: g.ada, amount: m(100) }],
            shares: [{ memberId: g.ada, amount: m(100), units: null }],
          },
        }),
      ),
    ).toEqual({ status: 'refused', refusal: { code: 'closed' } });
    for (const body of [
      { op: 'group.rename', groupId: g.groupId, sealed },
      { op: 'group.simplify', groupId: g.groupId, on: true },
      { op: 'member.role', groupId: g.groupId, memberId: g.grace, role: 'owner' },
      { op: 'member.notify', groupId: g.groupId, notify: 'none' },
      { op: 'member.leave', groupId: g.groupId },
      { op: 'group.close', groupId: g.groupId },
    ])
      expect((await call(t.ada, body)).status, body.op).toBe(404);
    // Still read.
    expect((await call(t.grace, { op: 'group.read', groupId: g.groupId })).status).toBe(200);
    expect((await call(t.grace, { op: 'group.reopen', groupId: g.groupId })).status).toBe(404);
    expect((await call(t.ada, { op: 'group.reopen', groupId: g.groupId })).status).toBe(200);
    expect((await call(t.ada, { op: 'group.simplify', groupId: g.groupId, on: true })).status).toBe(
      200,
    );
  });

  it('deleting is refused for a group that has had an expense, even a deleted one', async () => {
    const g = await group();
    const expenseId = await expense(g.groupId, [g.ada], g.ada, 100);
    await applyMutation(
      t.database,
      ada,
      deleteExpense({
        mutationId: mid(),
        groupId: g.groupId,
        current: { id: expenseId, version: 1 },
      }),
    );
    expect(
      await refusal(await call(t.ada, { op: 'group.delete', groupId: g.groupId })),
    ).toMatchObject({ status: 409, code: 'not_empty' });
  });

  it('deleting an empty group is an owner’s, and leaves no row of it in any table', async () => {
    const g = await group();
    expect((await call(t.grace, { op: 'group.delete', groupId: g.groupId })).status).toBe(404);
    const reply = await call(t.ada, { op: 'group.delete', groupId: g.groupId });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ deleted: true });
    const count = async (table: unknown, column = 'group_id') =>
      Number(
        (
          await dbGet<{ n: number }>(
            t.database,
            sql`SELECT COUNT(*) AS n FROM ${table} WHERE ${sql.raw(column)} = ${g.groupId}`,
          )
        )?.n,
      );
    expect(await count(db().grp, 'id')).toBe(0);
    const byName: Record<(typeof GROUP_TABLES)[number], unknown> = {
      activity: db().activity,
      applied_mutation: db().appliedMutation,
      comment: db().comment,
      expense: db().expense,
      expense_payer: db().expensePayer,
      expense_share: db().expenseShare,
      key_wrap: db().keyWrap,
      member: db().member,
      payment: db().payment,
      revision: db().revision,
      tombstone: db().tombstone,
    };
    for (const name of GROUP_TABLES) expect(await count(byName[name]), name).toBe(0);
  });
});
