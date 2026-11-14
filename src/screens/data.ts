import { type Balances, balances } from '../balances';
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
  return {
    group: rows.group,
    members: rows.members.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
    expenses: rows.expenses,
    payments: rows.payments,
    order,
    me,
    balances: balances(
      {
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
      },
      order,
    ),
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
