import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ExpenseRow,
  type PaymentRow,
  addExpense,
  addPayment,
  deleteExpense,
  editExpense,
  editPayment,
  expenseRow,
  restoreExpense,
} from '../actions';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { toMinor } from '../money/amount';
import { ensurePerson } from '../people/persons';
import { type Actor, applyMutation } from './apply';

/**
 * The one write path (DESIGN.md §11.3–§11.5, §8.5) on each database: a mutation applied, refused and replayed, two edits from one base, an edit after
 * a delete, and everything of a group Grace is not in reading as not found to her, with nothing written.
 */
const { leg } = testTarget();
const m = (value: number) => toMinor(value);

describe(`applying a mutation (${leg})`, () => {
  let t: TwoAccounts;
  let ada: Actor;
  let grace: Actor;
  let sealed = '';
  const groupId = crypto.randomUUID();
  const gracesGroup = crypto.randomUUID();
  const members = { ada: crypto.randomUUID(), sam: crypto.randomUUID(), lee: crypto.randomUUID() };
  let order: string[] = [];
  let mutationCount = 0;
  const mid = () =>
    `mutation-${String(++mutationCount).padStart(4, '0')}-${crypto.randomUUID().slice(0, 8)}`;

  const seqOf = async (id: string) =>
    Number(
      (
        await dbGet<{ seq: number }>(
          t.database,
          sql`SELECT seq FROM ${tables(t.database).grp} WHERE id = ${id}`,
        )
      )?.seq,
    );
  const count = async (table: unknown, where = sql`1 = 1`) =>
    Number(
      (
        await dbGet<{ n: number }>(
          t.database,
          sql`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`,
        )
      )?.n ?? 0,
    );
  const revisions = async (id: string) =>
    dbAll<{ version: number; kind: string; actor: string }>(
      t.database,
      sql`SELECT version, kind, actor_person_id AS actor FROM ${tables(t.database).revision} WHERE subject_id = ${id} ORDER BY created_at, version, kind`,
    );

  function dinner(amount = 9_000, split = [members.ada, members.sam, members.lee]): ExpenseRow {
    const made = expenseRow(
      {
        sealed,
        amount: m(amount),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'eating_out',
        method: 'equal',
        payers: [{ memberId: members.ada, amount: m(amount) }],
        split: split.map((memberId) => ({ memberId, units: null })),
      },
      order,
    );
    if (!made.ok) throw new Error(made.refusal.code);
    return made.value;
  }

  async function group(id: string, by: string, closed = false) {
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).grp} (id, sealed, color, default_currency, simplify_debts, closed_at, key_epoch, seq, created_by, created_at, updated_at)
          VALUES (${id}, ${sealed}, '#2563eb', 'EUR', ${false}, ${closed ? 1 : null}, 1, 1, ${by}, 1, 1)`,
    );
  }
  async function member(
    id: string,
    group: string,
    personId: string,
    joinedAt: number,
    leftAt: number | null = null,
  ) {
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${id}, ${group}, ${personId}, 'member', 'all', NULL, ${joinedAt}, ${leftAt}, 1)`,
    );
  }

  beforeAll(async () => {
    t = await twoAccounts();
    const key = await importGroupKey(newGroupKey());
    sealed = await sealRow({ description: 'Dinner', note: null }, key, 1, {
      group: groupId,
      table: 'expense',
      row: 'x',
    });
    ada = {
      accountId: t.ada.id,
      personId: (await ensurePerson(t.database, { id: t.ada.id, name: 'Ada', email: t.ada.email }))
        .id,
    };
    grace = {
      accountId: t.grace.id,
      personId: (
        await ensurePerson(t.database, { id: t.grace.id, name: 'Grace', email: t.grace.email })
      ).id,
    };
    // Ada's group, with two placeholders, Sam and Lee; Grace is not in it. Grace's own group, which Ada is not in.
    await group(groupId, ada.personId);
    await member(members.ada, groupId, ada.personId, 1);
    for (const [id, joined] of [
      [members.sam, 2],
      [members.lee, 3],
    ] as const) {
      const person = crypto.randomUUID();
      await dbRun(
        t.database,
        sql`INSERT INTO ${tables(t.database).person} (id, name, created_at, updated_at) VALUES (${person}, 'Placeholder', 1, 1)`,
      );
      await member(id, groupId, person, joined);
    }
    await group(gracesGroup, grace.personId);
    await member(crypto.randomUUID(), gracesGroup, grace.personId, 1);
    order = [members.ada, members.sam, members.lee];
  });
  afterAll(async () => t.close());

  it('applies a new expense: its rows, its payers and shares, version 1, a created revision, the group’s seq on', async () => {
    const before = await seqOf(groupId);
    const expenseId = crypto.randomUUID();
    const applied = await applyMutation(
      t.database,
      ada,
      addExpense({ mutationId: mid(), groupId, expenseId, row: dinner() }),
      10,
    );
    expect(applied).toEqual({ status: 'applied', seq: before + 1, replayed: false });
    const db = tables(t.database);
    expect(
      await dbGet(
        t.database,
        sql`SELECT amount, version, seq, created_by AS "by" FROM ${db.expense} WHERE id = ${expenseId}`,
      ),
    ).toEqual({ amount: 9_000, version: 1, seq: before + 1, by: ada.personId });
    expect(await count(db.expensePayer, sql`expense_id = ${expenseId}`)).toBe(1);
    expect(await count(db.expenseShare, sql`expense_id = ${expenseId}`)).toBe(3);
    expect(await revisions(expenseId)).toEqual([
      { version: 1, kind: 'created', actor: ada.personId },
    ]);
  });

  it('a replayed mutation answers as before and writes nothing', async () => {
    const mutation = addExpense({
      mutationId: mid(),
      groupId,
      expenseId: crypto.randomUUID(),
      row: dinner(),
    });
    const first = await applyMutation(t.database, ada, mutation);
    const seq = await seqOf(groupId);
    const expenses = await count(tables(t.database).expense);
    const again = await applyMutation(t.database, ada, mutation);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await seqOf(groupId)).toBe(seq);
    expect(await count(tables(t.database).expense)).toBe(expenses);
  });

  it('two edits from one base leave the later one stored, and the earlier kept as replaced under its author', async () => {
    const expenseId = crypto.randomUUID();
    await applyMutation(
      t.database,
      ada,
      addExpense({ mutationId: mid(), groupId, expenseId, row: dinner(9_000) }),
      1,
    );
    const base = { id: expenseId, version: 1 };
    // Two devices both hold version 1. The first edit reaches the server, then the second.
    await applyMutation(
      t.database,
      ada,
      editExpense({ mutationId: mid(), groupId, current: base, row: dinner(8_400) }),
      2,
    );
    const later = await applyMutation(
      t.database,
      ada,
      editExpense({ mutationId: mid(), groupId, current: base, row: dinner(6_000) }),
      3,
    );
    expect(later.status).toBe('applied');
    const db = tables(t.database);
    expect(
      await dbGet(
        t.database,
        sql`SELECT amount, version FROM ${db.expense} WHERE id = ${expenseId}`,
      ),
    ).toEqual({
      amount: 6_000,
      version: 3,
    });
    expect((await revisions(expenseId)).map((r) => `${r.version} ${r.kind}`)).toEqual([
      '1 created',
      '2 edited',
      '2 replaced',
      '3 edited',
    ]);
    const replaced = await dbGet<{ snapshot: string }>(
      t.database,
      sql`SELECT snapshot FROM ${db.revision} WHERE subject_id = ${expenseId} AND kind = 'replaced'`,
    );
    expect(JSON.parse(replaced?.snapshot ?? '{}')).toMatchObject({ amount: 8_400 });
  });

  it('an edit of a deleted expense restores it; deleting twice changes nothing', async () => {
    const expenseId = crypto.randomUUID();
    await applyMutation(
      t.database,
      ada,
      addExpense({ mutationId: mid(), groupId, expenseId, row: dinner() }),
      1,
    );
    await applyMutation(
      t.database,
      ada,
      deleteExpense({ mutationId: mid(), groupId, current: { id: expenseId, version: 1 } }),
      2,
    );
    // A second device deletes too: applied, and nothing more is written.
    const seqBefore = await seqOf(groupId);
    expect(
      (
        await applyMutation(
          t.database,
          ada,
          deleteExpense({ mutationId: mid(), groupId, current: { id: expenseId, version: 1 } }),
        )
      ).status,
    ).toBe('applied');
    expect((await revisions(expenseId)).map((r) => r.kind)).toEqual(['created', 'deleted']);
    expect(await seqOf(groupId)).toBe(seqBefore + 1);
    // A third edits what it held: the expense is back, whole.
    await applyMutation(
      t.database,
      ada,
      editExpense({
        mutationId: mid(),
        groupId,
        current: { id: expenseId, version: 1 },
        row: dinner(4_500),
      }),
      3,
    );
    const db = tables(t.database);
    expect(
      await dbGet(
        t.database,
        sql`SELECT amount, deleted_at AS "deletedAt" FROM ${db.expense} WHERE id = ${expenseId}`,
      ),
    ).toEqual({
      amount: 4_500,
      deletedAt: null,
    });
    expect((await revisions(expenseId)).map((r) => r.kind)).toEqual([
      'created',
      'deleted',
      'replaced',
      'restored',
    ]);
    // Restore of what is not deleted: nothing.
    await applyMutation(
      t.database,
      ada,
      restoreExpense({ mutationId: mid(), groupId, current: { id: expenseId, version: 3 } }),
    );
    expect(await revisions(expenseId)).toHaveLength(4);
  });

  it('a refused mutation writes nothing, not even the group’s seq', async () => {
    const seq = await seqOf(groupId);
    const expenses = await count(tables(t.database).expense);
    const row = dinner();
    const shares = row.shares.map((s, i) => ({
      ...s,
      amount: m(s.amount + (i === 0 ? 1 : i === 1 ? -1 : 0)),
    }));
    const refused = await applyMutation(
      t.database,
      ada,
      addExpense({
        mutationId: mid(),
        groupId,
        expenseId: crypto.randomUUID(),
        row: { ...row, shares },
      }),
    );
    expect(refused).toEqual({ status: 'refused', refusal: { code: 'shares' } });
    // Two changes, the second refused: the first is not written either.
    const mutation = addExpense({
      mutationId: mid(),
      groupId,
      expenseId: crypto.randomUUID(),
      row: dinner(),
    });
    mutation.changes.push({
      table: 'expense',
      op: 'delete',
      id: crypto.randomUUID(),
      baseVersion: 1,
    });
    expect(await applyMutation(t.database, ada, mutation)).toEqual({
      status: 'refused',
      refusal: { code: 'not_found' },
    });
    expect(await seqOf(groupId)).toBe(seq);
    expect(await count(tables(t.database).expense)).toBe(expenses);
    expect(await count(tables(t.database).appliedMutation, sql`id = ${mutation.mutationId}`)).toBe(
      0,
    );
  });

  it('reads as not found to someone not in the group, whatever they name, with nothing written', async () => {
    const seq = await seqOf(groupId);
    const expenses = await count(tables(t.database).expense);
    const asGrace = await applyMutation(
      t.database,
      grace,
      addExpense({ mutationId: mid(), groupId, expenseId: crypto.randomUUID(), row: dinner() }),
    );
    expect(asGrace).toEqual({ status: 'refused', refusal: { code: 'not_found' } });
    // Ada's expense, named from Grace's own group: not there either.
    const adas = await dbGet<{ id: string }>(
      t.database,
      sql`SELECT id FROM ${tables(t.database).expense} WHERE group_id = ${groupId} LIMIT 1`,
    );
    const moved = await applyMutation(
      t.database,
      grace,
      deleteExpense({
        mutationId: mid(),
        groupId: gracesGroup,
        current: { id: adas?.id ?? '', version: 1 },
      }),
    );
    expect(moved).toEqual({ status: 'refused', refusal: { code: 'not_found' } });
    expect(await seqOf(groupId)).toBe(seq);
    expect(await count(tables(t.database).expense)).toBe(expenses);
  });

  it('refuses a closed group, and an account no longer in one, as such', async () => {
    const closed = crypto.randomUUID();
    await group(closed, ada.personId, true);
    await member(crypto.randomUUID(), closed, ada.personId, 1);
    const left = crypto.randomUUID();
    await group(left, ada.personId);
    await member(crypto.randomUUID(), left, ada.personId, 1, 5);
    for (const [id, code] of [
      [closed, 'closed'],
      [left, 'not_in_group'],
    ] as const)
      expect(
        await applyMutation(
          t.database,
          ada,
          addExpense({
            mutationId: mid(),
            groupId: id,
            expenseId: crypto.randomUUID(),
            row: dinner(),
          }),
        ),
      ).toEqual({ status: 'refused', refusal: { code } });
  });

  it('keeps someone who has left on an expense being edited, but will not name them on a new one', async () => {
    const expenseId = crypto.randomUUID();
    await applyMutation(
      t.database,
      ada,
      addExpense({ mutationId: mid(), groupId, expenseId, row: dinner() }),
    );
    const db = tables(t.database);
    await dbRun(t.database, sql`UPDATE ${db.member} SET left_at = 9 WHERE id = ${members.lee}`);
    try {
      const edited = await applyMutation(
        t.database,
        ada,
        editExpense({
          mutationId: mid(),
          groupId,
          current: { id: expenseId, version: 1 },
          row: dinner(9_300),
        }),
      );
      expect(edited.status).toBe('applied');
      expect(
        await applyMutation(
          t.database,
          ada,
          addExpense({ mutationId: mid(), groupId, expenseId: crypto.randomUUID(), row: dinner() }),
        ),
      ).toEqual({ status: 'refused', refusal: { code: 'member_gone', memberId: members.lee } });
    } finally {
      await dbRun(
        t.database,
        sql`UPDATE ${db.member} SET left_at = NULL WHERE id = ${members.lee}`,
      );
    }
  });

  it('applies payments the same way, and refuses one to oneself', async () => {
    const paymentId = crypto.randomUUID();
    const row: PaymentRow = {
      sealed: null,
      fromMemberId: members.sam,
      toMemberId: members.ada,
      amount: m(3_000),
      currency: 'EUR',
      date: '2026-11-03',
    };
    expect(
      (
        await applyMutation(
          t.database,
          ada,
          addPayment({ mutationId: mid(), groupId, paymentId, row }),
        )
      ).status,
    ).toBe('applied');
    expect(
      (
        await applyMutation(
          t.database,
          ada,
          editPayment({
            mutationId: mid(),
            groupId,
            current: { id: paymentId, version: 1 },
            row: { ...row, amount: m(2_500) },
          }),
        )
      ).status,
    ).toBe('applied');
    expect((await revisions(paymentId)).map((r) => r.kind)).toEqual(['created', 'edited']);
    expect(
      await applyMutation(
        t.database,
        ada,
        addPayment({
          mutationId: mid(),
          groupId,
          paymentId: crypto.randomUUID(),
          row: { ...row, toMemberId: members.sam },
        }),
      ),
    ).toEqual({ status: 'refused', refusal: { code: 'same_person' } });
  });
});
