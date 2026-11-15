import { sealRow } from '../cipher/seal';
import type { ExportFile } from './format';

/**
 * **A checked file made ready to send** (DESIGN.md §17), in the browser: every group, member, expense, payment and comment given a new id, mapped
 * consistently, so that a file imported twice makes two sets of groups and touches no row already here; each group's key made by the device
 * (`keyer`), and its name and every text sealed under it, bound to the new rows. The importer is the group's member that the file says was them, or a
 * member added for them; the server makes everyone else a placeholder with their name and no email.
 */
export interface ImportKeyer {
  keyForImport(groupId: string): Promise<{ key: CryptoKey; keyWrap: string }>;
}

export interface ImportGroup {
  groupId: string;
  sealed: string;
  keyWrap: string;
  color: string;
  defaultCurrency: string;
  simplifyDebts: boolean;
  /** In member order: the server keeps it, since a split's leftover follows it. */
  members: { id: string; name: string; you: boolean; left: boolean }[];
  expenses: {
    id: string;
    sealed: string;
    amount: number;
    currency: string;
    date: string;
    category: string;
    method: string;
    payers: { memberId: string; amount: number }[];
    shares: { memberId: string; amount: number; units: number | null }[];
  }[];
  payments: {
    id: string;
    sealed: string | null;
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    currency: string;
    date: string;
  }[];
  comments: {
    id: string;
    subject: 'expense' | 'payment';
    subjectId: string;
    authorMemberId: string | null;
    sealed: string;
  }[];
}

export interface ImportRequest {
  groups: ImportGroup[];
}

export async function prepareImport(
  file: ExportFile,
  keyer: ImportKeyer,
  you: string,
): Promise<ImportRequest> {
  const groups: ImportGroup[] = [];
  for (const g of file.groups) {
    const groupId = crypto.randomUUID();
    const { key, keyWrap } = await keyer.keyForImport(groupId);
    const id = new Map<string, string>();
    const fresh = (old: string) => {
      const known = id.get(old);
      if (known) return known;
      const made = crypto.randomUUID();
      id.set(old, made);
      return made;
    };
    const seal = (
      content: Record<string, string | null>,
      table: 'grp' | 'expense' | 'payment' | 'comment',
      row: string,
    ) => sealRow(content, key, 1, { group: groupId, table, row });

    const ordered = [...g.members].sort(
      (a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1),
    );
    const members = ordered.map((m) => ({
      id: fresh(m.id),
      name: m.id === g.yourMemberId ? you : m.name,
      you: m.id === g.yourMemberId,
      left: m.leftAt !== null && m.id !== g.yourMemberId,
    }));
    // A file of someone else's: the importer joins it, last, as its owner.
    if (!members.some((m) => m.you))
      members.push({ id: crypto.randomUUID(), name: you, you: true, left: false });

    const comments: ImportGroup['comments'] = [];
    const commentsOf = async (
      subject: 'expense' | 'payment',
      subjectId: string,
      list: ExportFile['groups'][number]['expenses'][number]['comments'],
    ) => {
      for (const c of list) {
        const commentId = crypto.randomUUID();
        comments.push({
          id: commentId,
          subject,
          subjectId,
          authorMemberId: c.authorMemberId ? (id.get(c.authorMemberId) ?? null) : null,
          sealed: await seal({ body: c.body }, 'comment', commentId),
        });
      }
    };

    const expenses: ImportGroup['expenses'] = [];
    for (const e of g.expenses) {
      const expenseId = crypto.randomUUID();
      expenses.push({
        id: expenseId,
        sealed: await seal({ description: e.description, note: e.note }, 'expense', expenseId),
        amount: e.amount,
        currency: e.currency,
        date: e.date,
        category: e.category,
        method: e.method,
        payers: e.payers.map((p) => ({ memberId: fresh(p.memberId), amount: p.amount })),
        shares: e.shares.map((s) => ({
          memberId: fresh(s.memberId),
          amount: s.amount,
          units: s.units,
        })),
      });
      await commentsOf('expense', expenseId, e.comments);
    }
    const payments: ImportGroup['payments'] = [];
    for (const p of g.payments) {
      const paymentId = crypto.randomUUID();
      payments.push({
        id: paymentId,
        sealed: p.note ? await seal({ note: p.note }, 'payment', paymentId) : null,
        fromMemberId: fresh(p.fromMemberId),
        toMemberId: fresh(p.toMemberId),
        amount: p.amount,
        currency: p.currency,
        date: p.date,
      });
      await commentsOf('payment', paymentId, p.comments);
    }
    groups.push({
      groupId,
      sealed: await seal({ name: g.name ?? 'Imported group' }, 'grp', groupId),
      keyWrap,
      color: g.color,
      defaultCurrency: g.defaultCurrency,
      simplifyDebts: g.simplifyDebts,
      members,
      expenses,
      payments,
      comments,
    });
  }
  return { groups };
}
