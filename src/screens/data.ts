import { type Balances, type Debt, type GroupRows, balances, suggestedPayments } from '../balances';
import type { SharedGroup } from '../balances/across';
import type {
  LocalDatabase,
  LocalExpense,
  LocalGroup,
  LocalMember,
  LocalPayment,
} from '../local/db';
import { readGroupRows } from '../local/store';
import { toMinor } from '../money/amount';
import { memberOrder } from '../money/split';

/**
 * What the screens read of the device's store (DESIGN.md §11.1, §15): pure functions of the store, shared by the screens, so that a figure on one is
 * the figure on another. Balances come from `src/balances/`, never computed here.
 */
export interface GroupView {
  group: LocalGroup;
  members: LocalMember[];
  expenses: LocalExpense[];
  payments: LocalPayment[];
  /** Every member the group has had, in member order. */
  order: string[];
  /** The reader's membership, if they are in it. */
  me: LocalMember | undefined;
  balances: Balances;
  /** Who owes whom, by the group's setting (§10.2, §10.3): what Settle up offers. */
  suggestions: Debt[];
  /** The rows as the balances read them, for the figures across groups (§10.4). */
  rows: GroupRows;
}

export async function readGroupView(
  db: LocalDatabase,
  groupId: string,
  personId: string,
): Promise<GroupView | null> {
  const rows = await readGroupRows(db, groupId);
  if (!rows.group) return null;
  const order = memberOrder(rows.members.map((m) => ({ id: m.id, joinedAt: m.joinedAt })));
  const me =
    rows.members.find((m) => m.personId === personId && m.leftAt === null) ??
    rows.members.find((m) => m.personId === personId);
  const groupRows: GroupRows = {
    expenses: rows.expenses.map((e) => ({
      currency: e.currency,
      deleted: e.deletedAt !== null,
      payers: e.payers.map((p) => ({ memberId: p.memberId, amount: toMinor(p.amount) })),
      shares: e.shares.map((s) => ({ memberId: s.memberId, amount: toMinor(s.amount) })),
    })),
    payments: rows.payments.map((p) => ({
      currency: p.currency,
      deleted: p.deletedAt !== null,
      fromId: p.fromMemberId,
      toId: p.toMemberId,
      amount: toMinor(p.amount),
    })),
  };
  return {
    group: rows.group,
    members: rows.members.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
    expenses: rows.expenses,
    payments: rows.payments,
    order,
    me,
    balances: balances(groupRows, order),
    suggestions: suggestedPayments(groupRows, order, rows.group.simplifyDebts),
    rows: groupRows,
  };
}

/** A member's balance in each currency where it is not zero, in currency order. */
export function myBalances(
  view: GroupView,
  memberId: string | undefined,
): { currency: string; amount: number }[] {
  if (!memberId) return [];
  const out: { currency: string; amount: number }[] = [];
  for (const [currency, members] of view.balances) {
    const amount = members.get(memberId) ?? 0;
    if (amount !== 0) out.push({ currency, amount });
  }
  return out;
}

/** Every group on the device, as the groups list and the sidebar show them: open ones by latest activity, closed ones after. */
export async function readGroupViews(db: LocalDatabase, personId: string): Promise<GroupView[]> {
  const views = (
    await Promise.all((await db.getAll('grp')).map((g) => readGroupView(db, g.id, personId)))
  ).filter((v): v is GroupView => v !== undefined);
  return views.sort(
    (a, b) =>
      Number(a.group.closedAt !== null) - Number(b.group.closedAt !== null) ||
      b.group.seq - a.group.seq ||
      (a.group.id < b.group.id ? -1 : 1),
  );
}

/** Someone the reader shares a group with, across every group they share (§15.7): matched by person, since a member is one group's. */
export interface PersonView {
  personId: string;
  name: string;
  placeholder: boolean;
  leftTally: boolean;
  /** Each group they share with the reader, with the two members there. */
  groups: { view: GroupView; me: string; them: string }[];
}

export function peopleOf(views: readonly GroupView[], myPersonId: string): PersonView[] {
  const people = new Map<string, PersonView>();
  for (const view of views) {
    if (!view.me) continue;
    for (const member of view.members) {
      if (member.personId === myPersonId) continue;
      const person =
        people.get(member.personId) ??
        ({
          personId: member.personId,
          name: member.name,
          placeholder: member.placeholder,
          leftTally: member.leftTally,
          groups: [],
        } as PersonView);
      person.groups.push({ view, me: view.me.id, them: member.id });
      people.set(member.personId, person);
    }
  }
  return [...people.values()];
}

/** The groups shared with one person, as the figures across groups read them. */
export function sharedGroups(person: PersonView): SharedGroup[] {
  return person.groups.map((g) => ({
    groupId: g.view.group.id,
    rows: g.view.rows,
    order: g.view.order,
    simplify: g.view.group.simplifyDebts,
    me: g.me,
    them: g.them,
  }));
}
