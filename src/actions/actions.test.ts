import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { toMinor } from '../money/amount';
import {
  type ExpenseRow,
  type PaymentRow,
  addComment,
  addExpense,
  addPayment,
  deleteComment,
  deleteExpense,
  editExpense,
  expenseRow,
  restorePayment,
  settleUp,
} from './index';
import {
  type GroupContext,
  type RefusalCode,
  MAX_SEALED,
  checkComment,
  checkCommentText,
  checkExpense,
  checkExpenseText,
  checkPayment,
  checkPaymentText,
  isDate,
  parseMutation,
  refusalSentence,
} from './validate';

const m = (value: number) => toMinor(value);
const GROUP = 'group-0001';
const [ANA, BEN, CY, DEE] = ['member-ana', 'member-ben', 'member-cy0', 'member-dee'] as const;
const context: GroupContext = {
  order: [ANA, BEN, CY, DEE],
  // Dee has left.
  active: new Set([ANA, BEN, CY]),
  epoch: 2,
};

let sealed = '';
let laterEpoch = '';
beforeAll(async () => {
  const key = await importGroupKey(newGroupKey());
  const binding = { group: GROUP, table: 'expense', row: 'expense-0001' } as const;
  sealed = await sealRow({ description: 'Dinner', note: null }, key, 1, binding);
  laterEpoch = await sealRow({ description: 'Dinner', note: null }, key, 3, binding);
});

function row(overrides: Partial<ExpenseRow> = {}): ExpenseRow {
  const made = expenseRow(
    {
      sealed,
      amount: m(8_400),
      currency: 'EUR',
      date: '2026-11-02',
      category: 'eating_out',
      method: 'equal',
      payers: [{ memberId: ANA, amount: m(8_400) }],
      split: [ANA, BEN, CY].map((memberId) => ({ memberId, units: null })),
    },
    context.order,
  );
  if (!made.ok) throw new Error(made.refusal.code);
  return { ...made.value, ...overrides };
}

function refusedWith(code: RefusalCode, result: { ok: boolean; refusal?: { code: string } }) {
  expect(result.ok).toBe(false);
  expect(result.refusal?.code).toBe(code);
}

describe('the actions', () => {
  it('build the mutation the design’s example shows', () => {
    const mutation = addExpense({
      mutationId: 'mutation-01',
      groupId: GROUP,
      expenseId: 'expense-0001',
      row: row(),
    });
    expect(mutation).toEqual({
      mutationId: 'mutation-01',
      groupId: GROUP,
      changes: [
        {
          table: 'expense',
          op: 'put',
          id: 'expense-0001',
          baseVersion: null,
          row: {
            sealed,
            amount: 8_400,
            currency: 'EUR',
            date: '2026-11-02',
            category: 'eating_out',
            method: 'equal',
            payers: [{ memberId: ANA, amount: 8_400 }],
            shares: [
              { memberId: ANA, amount: 2_800, units: null },
              { memberId: BEN, amount: 2_800, units: null },
              { memberId: CY, amount: 2_800, units: null },
            ],
          },
        },
      ],
    });
    expect(parseMutation(JSON.parse(JSON.stringify(mutation)))).toEqual({
      ok: true,
      value: mutation,
    });
  });

  it('base an edit, a delete and a restore on the version the device held', () => {
    const current = { id: 'expense-0001', version: 3 };
    const edit = editExpense({
      mutationId: 'mutation-02',
      groupId: GROUP,
      current,
      row: row({ amount: m(8_400) }),
    });
    expect(edit.changes[0]).toMatchObject({ op: 'put', id: 'expense-0001', baseVersion: 3 });
    expect(deleteExpense({ mutationId: 'mutation-03', groupId: GROUP, current }).changes).toEqual([
      { table: 'expense', op: 'delete', id: 'expense-0001', baseVersion: 3 },
    ]);
    expect(restorePayment({ mutationId: 'mutation-04', groupId: GROUP, current }).changes).toEqual([
      { table: 'payment', op: 'restore', id: 'expense-0001', baseVersion: 3 },
    ]);
  });

  it('make comments, and settle up one payment per group', () => {
    expect(
      addComment({
        mutationId: 'mutation-05',
        groupId: GROUP,
        commentId: 'comment-0001',
        subject: 'expense',
        subjectId: 'expense-0001',
        sealed,
      }).changes,
    ).toEqual([
      {
        table: 'comment',
        op: 'put',
        id: 'comment-0001',
        row: { subject: 'expense', subjectId: 'expense-0001', sealed },
      },
    ]);
    expect(
      deleteComment({ mutationId: 'mutation-06', groupId: GROUP, commentId: 'comment-0001' })
        .changes,
    ).toEqual([{ table: 'comment', op: 'delete', id: 'comment-0001' }]);
    const payment: PaymentRow = {
      sealed: null,
      fromMemberId: BEN,
      toMemberId: ANA,
      amount: m(500),
      currency: 'EUR',
      date: '2026-11-03',
    };
    const mutations = settleUp([
      { mutationId: 'mutation-07', groupId: GROUP, paymentId: 'payment-001', row: payment },
      {
        mutationId: 'mutation-08',
        groupId: 'group-0002',
        paymentId: 'payment-002',
        row: { ...payment, currency: 'USD' },
      },
    ]);
    expect(mutations.map((x) => [x.groupId, x.changes.length])).toEqual([
      [GROUP, 1],
      ['group-0002', 1],
    ]);
  });

  it('turn a split that cannot be made into a refusal, not a throw', () => {
    const bad = expenseRow(
      {
        sealed,
        amount: m(100),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'general',
        method: 'percentages',
        payers: [{ memberId: ANA, amount: m(100) }],
        split: [{ memberId: ANA, units: 5_000 }],
      },
      context.order,
    );
    refusedWith('shares', bad);
    refusedWith(
      'payers',
      expenseRow({ ...row(), payers: [{ memberId: ANA, amount: m(1) }], split: [] }, context.order),
    );
  });
});

describe('what the server refuses (§11.5)', () => {
  it('accepts a good expense, and gives its payers and shares in member order', () => {
    const checked = checkExpense({ ...row(), shares: [...row().shares].reverse() }, context);
    expect(checked.ok).toBe(true);
  });

  it('someone named who is no longer in the group, unless they were on the version being edited', () => {
    const withDee = expenseRow(
      {
        ...row(),
        payers: [{ memberId: DEE, amount: m(8_400) }],
        split: [ANA, DEE].map((memberId) => ({ memberId, units: null })),
      },
      context.order,
    );
    if (!withDee.ok) throw new Error('fixture');
    const refused = checkExpense(withDee.value, context);
    expect(refused).toEqual({ ok: false, refusal: { code: 'member_gone', memberId: DEE } });
    expect(checkExpense(withDee.value, context, new Set([DEE])).ok).toBe(true);
    // Someone who was never the group's reads as not found.
    refusedWith(
      'not_found',
      checkExpense(row({ payers: [{ memberId: 'member-eve', amount: m(8_400) }] }), context),
    );
  });

  it('payers and shares that do not add up, or shares that are not the method’s', () => {
    refusedWith(
      'payers',
      checkExpense(row({ payers: [{ memberId: ANA, amount: m(8_000) }] }), context),
    );
    const shares = row().shares.map((s, i) => ({
      ...s,
      amount: m(i === 0 ? 2_801 : i === 1 ? 2_799 : 2_800),
    }));
    refusedWith('shares', checkExpense(row({ shares }), context));
    refusedWith('method', checkExpense(row({ method: 'thirds' as ExpenseRow['method'] }), context));
  });

  it('an unknown currency or category, a date that is not a day, an amount not above zero', () => {
    refusedWith('currency', checkExpense(row({ currency: 'XXQ' }), context));
    refusedWith(
      'category',
      checkExpense(row({ category: 'yachts' as ExpenseRow['category'] }), context),
    );
    refusedWith('date', checkExpense(row({ date: '2026-02-30' }), context));
    refusedWith('amount', checkExpense(row({ amount: m(0) }), context));
    expect(isDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-2-01', '1969-12-31', '2026-13-01', '20261101', 20261101])
      expect(isDate(bad)).toBe(false);
  });

  it('sealed text not in the sealed form, under an epoch the group has not had, or too long', () => {
    refusedWith('sealed', checkExpense(row({ sealed: 'Dinner at Mario’s' }), context));
    refusedWith('sealed', checkExpense(row({ sealed: laterEpoch }), context));
    refusedWith('sealed', checkExpense(row({ sealed: `s1.1.${'A'.repeat(MAX_SEALED)}` }), context));
    refusedWith(
      'sealed',
      checkComment({ subject: 'expense', subjectId: 'expense-0001', sealed: 'plain' }, context),
    );
  });

  it('a payment to oneself, or with someone who has left', () => {
    const payment: PaymentRow = {
      sealed: null,
      fromMemberId: BEN,
      toMemberId: ANA,
      amount: m(500),
      currency: 'EUR',
      date: '2026-11-03',
    };
    expect(checkPayment(payment, context).ok).toBe(true);
    refusedWith('same_person', checkPayment({ ...payment, toMemberId: BEN }, context));
    refusedWith('member_gone', checkPayment({ ...payment, toMemberId: DEE }, context));
    refusedWith('sealed', checkPayment({ ...payment, sealed: 'a note in the clear' }, context));
  });

  it('anything not a mutation', () => {
    const good = addPayment({
      mutationId: 'mutation-09',
      groupId: GROUP,
      paymentId: 'payment-003',
      row: {
        sealed: null,
        fromMemberId: BEN,
        toMemberId: ANA,
        amount: m(500),
        currency: 'EUR',
        date: '2026-11-03',
      },
    });
    expect(parseMutation(good).ok).toBe(true);
    const change = good.changes[0];
    for (const bad of [
      null,
      { ...good, mutationId: 'short' },
      { ...good, changes: [] },
      { ...good, changes: [change, change] },
      {
        ...good,
        changes: Array.from({ length: 21 }, (_, i) => ({
          ...change,
          id: `payment-${String(i).padStart(3, '0')}`,
        })),
      },
      { ...good, changes: [{ ...change, table: 'grp' }] },
      { ...good, changes: [{ ...change, op: 'merge' }] },
      { ...good, changes: [{ ...change, baseVersion: 0 }] },
      { ...good, changes: [{ table: 'expense', op: 'delete', id: 'expense-0001' }] },
      {
        ...good,
        changes: [{ ...change, row: { ...(change as { row: object }).row, amount: 5.5 } }],
      },
    ])
      refusedWith('malformed', parseMutation(bad));
  });
});

describe('what people typed, on the device', () => {
  it('needs a description of at most 200 characters, and a note of at most 2,000', () => {
    expect(checkExpenseText({ description: '  Dinner ', note: '   ' })).toEqual({
      ok: true,
      value: { description: 'Dinner', note: null },
    });
    refusedWith('text', checkExpenseText({ description: '   ', note: null }));
    // Counted as people see them: 200 emoji is 200 characters, though 400 UTF-16 units.
    expect(checkExpenseText({ description: '🍕'.repeat(200), note: null }).ok).toBe(true);
    refusedWith('text', checkExpenseText({ description: 'a'.repeat(201), note: null }));
    refusedWith('text', checkPaymentText({ note: 'a'.repeat(2_001) }));
    refusedWith('text', checkCommentText({ body: ' ' }));
    expect(checkCommentText({ body: 'Thanks!' }).ok).toBe(true);
  });

  it('says each refusal in a sentence, with the names the device opened', () => {
    expect(refusalSentence({ code: 'closed' }, { group: 'Lisbon' })).toBe('Lisbon was closed.');
    expect(refusalSentence({ code: 'not_in_group' }, { group: 'Roomies' })).toBe(
      'You’re no longer in Roomies.',
    );
    expect(
      refusalSentence(
        { code: 'member_gone', memberId: DEE },
        { member: (id) => (id === DEE ? 'Sam' : undefined) },
      ),
    ).toBe('Sam is no longer in this group.');
  });
});

describe('the module', () => {
  it('imports nothing from the browser or the server', () => {
    const dir = 'src/actions';
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    )) {
      const imports = [...readFileSync(join(dir, file), 'utf8').matchAll(/from '([^']+)'/g)].map(
        (x) => x[1],
      );
      for (const from of imports)
        expect(from, `${file} imports ${from}`).toMatch(/^\.\/|^\.\.\/(money|cipher)\//);
    }
  });
});
