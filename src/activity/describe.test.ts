import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '../money/text';
import { toMinor } from '../money/amount';
import { type DescribeContext, describeActivity } from './describe';
import { ACTIVITY_KINDS, type ActivityLine, type ExpenseDetails } from './kinds';

/**
 * The words of every kind of line (DESIGN.md §12.1), from the reader's point of view: "You" for the reader, names for the others, the text opened on
 * the device, and a sentence still when it cannot be opened.
 */
const PEOPLE: Record<string, string> = { kasun: 'Kasun', sam: 'Sam', lee: 'Lee', pip: 'Pip' };
const MEMBERS: Record<string, string> = { mk: 'kasun', ms: 'sam', ml: 'lee' };
const OPENED: Record<string, Record<string, string | null>> = {
  'sealed-tram': { description: 'Tram tickets', note: null },
  'sealed-dinner': { description: 'Dinner', note: 'at Mario’s' },
  'sealed-comment': { body: 'Thanks!' },
  'sealed-name': { name: 'Lisbon' },
};

const context = (reader = 'kasun', unlocked = true): DescribeContext => ({
  readerPersonId: reader,
  personOfMember: (memberId) => MEMBERS[memberId],
  nameOf: (personId) => PEOPLE[personId],
  opened: (sealed) => (unlocked ? OPENED[sealed] : undefined),
  money: (amount, currency) => formatMoney(toMinor(amount), currency, 'en'),
});

let n = 0;
function line<K extends ActivityLine['kind']>(
  kind: K,
  actorPersonId: string | null,
  details: Extract<ActivityLine, { kind: K }>['details'],
): ActivityLine {
  return {
    id: `a${++n}`,
    groupId: 'g',
    kind,
    actorPersonId,
    subjectId: null,
    details,
    createdAt: n,
  } as ActivityLine;
}

const tram: ExpenseDetails = {
  sealed: 'sealed-tram',
  amount: 960,
  currency: 'EUR',
  payers: [{ memberId: 'mk', amount: 960 }],
  shares: [
    { memberId: 'mk', amount: 480 },
    { memberId: 'ms', amount: 480 },
  ],
};
const dinner: ExpenseDetails = {
  sealed: 'sealed-dinner',
  amount: 8_400,
  currency: 'EUR',
  payers: [
    { memberId: 'ms', amount: 6_000 },
    { memberId: 'ml', amount: 2_400 },
  ],
  shares: [{ memberId: 'mk', amount: 8_400 }],
};
const paid = { fromMemberId: 'ms', toMemberId: 'mk', amount: 6_320, currency: 'EUR' };

const say = (l: ActivityLine, reader = 'kasun', unlocked = true) =>
  describeActivity(l, context(reader, unlocked));

describe('the words of a line', () => {
  it('an expense added, by who paid it or for others', () => {
    expect(say(line('expense_added', 'kasun', tram))).toBe('You paid €9.60 for Tram tickets');
    expect(say(line('expense_added', 'kasun', tram), 'sam')).toBe(
      'Kasun paid €9.60 for Tram tickets',
    );
    expect(say(line('expense_added', 'kasun', dinner))).toBe(
      'You added Dinner, €84.00 paid by Sam and Lee',
    );
  });

  it('an expense changed, deleted, restored, or changed in place of someone’s change', () => {
    expect(say(line('expense_edited', 'sam', dinner))).toBe('Sam changed Dinner');
    expect(say(line('expense_deleted', 'kasun', dinner))).toBe('You deleted Dinner');
    expect(say(line('expense_restored', 'lee', dinner))).toBe('Lee restored Dinner');
    expect(say(line('expense_replaced', 'sam', { ...dinner, replacedPersonId: 'kasun' }))).toBe(
      'Sam changed Dinner, in place of your change',
    );
    expect(say(line('expense_replaced', 'kasun', { ...dinner, replacedPersonId: 'sam' }))).toBe(
      'You changed Dinner, in place of Sam’s change',
    );
  });

  it('a payment, recorded by who paid or by someone else', () => {
    expect(say(line('payment_added', 'sam', paid))).toBe('Sam paid you €63.20');
    expect(say(line('payment_added', 'sam', paid), 'sam')).toBe('You paid Kasun €63.20');
    expect(say(line('payment_added', 'lee', paid))).toBe('Lee recorded that Sam paid you €63.20');
    expect(
      say(line('payment_added', 'kasun', { ...paid, fromMemberId: 'mk', toMemberId: 'ms' }), 'lee'),
    ).toBe('Kasun paid Sam €63.20');
    expect(say(line('payment_edited', 'kasun', paid))).toBe(
      'You changed a payment: Sam paid you €63.20',
    );
    expect(
      say(line('payment_deleted', 'kasun', { ...paid, fromMemberId: 'mk', toMemberId: 'ms' })),
    ).toBe('You deleted a payment: you paid Sam €63.20');
    expect(say(line('payment_restored', 'sam', paid))).toBe(
      'Sam restored a payment: Sam paid you €63.20',
    );
    expect(say(line('payment_replaced', 'sam', { ...paid, replacedPersonId: 'lee' }))).toBe(
      'Sam changed a payment, in place of Lee’s change: Sam paid you €63.20',
    );
  });

  it('a comment, with what it is on', () => {
    expect(
      say(
        line('comment_added', 'sam', {
          subject: 'expense',
          sealed: 'sealed-comment',
          subjectSealed: 'sealed-dinner',
        }),
      ),
    ).toBe('Sam commented on Dinner: “Thanks!”');
    expect(
      say(
        line('comment_added', 'kasun', {
          subject: 'payment',
          sealed: 'sealed-comment',
          subjectSealed: null,
        }),
      ),
    ).toBe('You commented on a payment: “Thanks!”');
  });

  it('the group made, renamed, its currency and simplify debts changed, closed and reopened', () => {
    expect(say(line('group_created', 'kasun', { sealed: 'sealed-name' }))).toBe(
      'You made the group Lisbon',
    );
    expect(say(line('group_renamed', 'sam', { sealed: 'sealed-name' }))).toBe(
      'Sam renamed the group Lisbon',
    );
    expect(say(line('group_currency_changed', 'sam', { from: 'EUR', to: 'USD' }))).toBe(
      'Sam changed the group’s currency from EUR to USD',
    );
    expect(say(line('group_simplify_changed', 'kasun', { on: true }))).toBe(
      'You turned on simplify debts',
    );
    expect(say(line('group_simplify_changed', 'sam', { on: false }))).toBe(
      'Sam turned off simplify debts',
    );
    expect(say(line('group_closed', 'sam', {}))).toBe('Sam closed the group');
    expect(say(line('group_reopened', 'kasun', {}))).toBe('You reopened the group');
  });

  it('people added, invited, joining, leaving, removed, merged, and roles', () => {
    expect(say(line('member_added', 'kasun', { memberId: 'ml', personId: 'lee' }))).toBe(
      'You added Lee',
    );
    expect(say(line('member_invited', 'sam', { memberId: 'ml', personId: 'lee' }))).toBe(
      'Sam invited Lee',
    );
    expect(say(line('member_joined', 'lee', { memberId: 'ml', personId: 'lee' }))).toBe(
      'Lee joined by invitation',
    );
    expect(say(line('member_left', 'kasun', { memberId: 'mk', personId: 'kasun' }))).toBe(
      'You left the group',
    );
    expect(say(line('member_removed', 'sam', { memberId: 'mk', personId: 'kasun' }))).toBe(
      'Sam removed you',
    );
    expect(
      say(line('member_merged', 'kasun', { memberId: 'ml', personId: 'lee', fromPersonId: 'pip' })),
    ).toBe('You merged Pip into Lee');
    expect(
      say(line('role_changed', 'sam', { memberId: 'mk', personId: 'kasun', role: 'owner' })),
    ).toBe('Sam made you an owner');
    expect(
      say(line('role_changed', 'kasun', { memberId: 'ms', personId: 'sam', role: 'member' })),
    ).toBe('You made Sam a member');
  });

  it('is still a sentence when the device cannot open the text, or does not know someone', () => {
    expect(say(line('expense_added', 'kasun', tram), 'kasun', false)).toBe(
      'You paid €9.60 for an expense',
    );
    expect(say(line('expense_deleted', 'sam', dinner), 'kasun', false)).toBe(
      'Sam deleted an expense',
    );
    expect(
      say(
        line('comment_added', 'sam', {
          subject: 'expense',
          sealed: 'sealed-comment',
          subjectSealed: 'sealed-dinner',
        }),
        'kasun',
        false,
      ),
    ).toBe('Sam commented on an expense');
    expect(say(line('group_renamed', 'sam', { sealed: 'sealed-name' }), 'kasun', false)).toBe(
      'Sam renamed the group',
    );
    expect(say(line('member_added', 'stranger', { memberId: 'mx', personId: 'nobody' }))).toBe(
      'Someone added someone',
    );
  });

  it('has a test above for every kind there is', () => {
    const source = readFileSync(new URL(import.meta.url), 'utf8');
    const missing = ACTIVITY_KINDS.filter((kind) => !source.includes(`line('${kind}'`));
    expect(missing).toEqual([]);
  });
});
