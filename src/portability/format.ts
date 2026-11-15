/**
 * **The export file, version 1** (DESIGN.md §17): one JSON file of what is the person's to take, **made in the browser** from the device's store, with
 * what people wrote opened by the group's key (the server cannot open it, §5.3), so the file is plain. **Pure:** the builder is given rows and opened
 * text and makes the file, with no clock but the one it is given, no database and no account.
 *
 * What is in it: the person's profile and settings, and every group they are in, whole, since a group's record is what its members share: its members
 * by name (never an email: the device holds none, and only the person's own address is in the profile), its expenses with payers, shares and
 * comments, and its payments. **What is there, not what was deleted.** Ids are kept, so that a file can be read back (12.2). **Deterministic:** in order
 * of date, time and id, so that two exports of unchanged data differ only in `exportedAt`.
 */
export const FORMAT = 'tally';
export const VERSION = 1;

/**
 * Every table of the app's store, said once: what of it the file carries, or why it is left out. A test (`format.test.ts`) fails when a table is in
 * neither list, so a new table is decided here in the same change.
 */
export const EXPORTED_TABLES = {
  person: 'the person’s own name and address (profile), and every member by name',
  account_settings: 'the primary currency (profile)',
  notice_pref: 'what the person chose to be told, by kind and channel (profile)',
  grp: 'each group: its name, colour, currency, whether debts are simplified, whether it is closed',
  member: 'each group’s members, by name, with their role and when they joined and left',
  expense: 'each expense, its figures and what was written on it',
  expense_payer: 'who paid each expense',
  expense_share: 'each share of each expense',
  payment: 'each payment, its figures and its note',
  comment: 'each comment on an expense or payment',
} as const;

export const LEFT_OUT_TABLES = {
  account_key: 'a key: never in a file',
  account_key_wrap: 'a key: never in a file',
  key_request: 'a device asking for a key: never in a file',
  key_wrap: 'a group key wrapped to a member: never in a file',
  credential: 'a secret held for the person (core’s token): never in a file',
  revision: 'the earlier versions of a row: the file holds each as it is now',
  activity: 'what happened in a group, as lines: the file holds what is there',
  notice: 'what the person was told: it points at activity, and is not theirs to carry elsewhere',
  tombstone: 'a removed row’s marker for devices, of no use outside this server',
  applied_mutation: 'which changes this server already applied, for replays',
  mail_outbox: 'mail waiting to go',
  invitation: 'a link to take a placeholder’s place, only good here',
  reminder: 'when a reminder was last sent, for the once-a-day rule',
  rate_bucket: 'counters of rate limits',
} as const;

export interface ExportedComment {
  id: string;
  /** The member who wrote it, in this group, or null where the device does not know them. */
  authorMemberId: string | null;
  body: string | null;
  createdAt: number;
}

export interface ExportedExpense {
  id: string;
  date: string;
  category: string;
  /** In minor units of `currency`. */
  amount: number;
  currency: string;
  method: string;
  description: string | null;
  note: string | null;
  payers: { memberId: string; amount: number }[];
  shares: { memberId: string; amount: number; units: number | null }[];
  createdAt: number;
  comments: ExportedComment[];
}

export interface ExportedPayment {
  id: string;
  date: string;
  amount: number;
  currency: string;
  fromMemberId: string;
  toMemberId: string;
  note: string | null;
  createdAt: number;
  comments: ExportedComment[];
}

export interface ExportedMember {
  id: string;
  name: string;
  role: 'owner' | 'member' | null;
  /** Not on Tally yet: a name, with no account. */
  placeholder: boolean;
  /** Their account was deleted: their name stays on what they shared. */
  leftTally: boolean;
  joinedAt: number;
  leftAt: number | null;
}

export interface ExportedGroup {
  id: string;
  name: string | null;
  color: string;
  defaultCurrency: string;
  simplifyDebts: boolean;
  closedAt: number | null;
  /** The person's own member in this group. */
  yourMemberId: string | null;
  members: ExportedMember[];
  expenses: ExportedExpense[];
  payments: ExportedPayment[];
}

export interface ExportFile {
  format: typeof FORMAT;
  version: typeof VERSION;
  exportedAt: string;
  profile: {
    name: string;
    email: string;
    primaryCurrency: string;
    notifications: Record<string, Record<string, boolean>>;
  };
  groups: ExportedGroup[];
  /** How many pieces of written text this device could not open (a group not unlocked here yet): they are null in the file. */
  unopened: number;
}

/** What the builder is given: the device's rows, as the store has them. */
export interface GroupInput {
  group: {
    id: string;
    sealed: string;
    color: string;
    defaultCurrency: string;
    simplifyDebts: boolean;
    closedAt: number | null;
  };
  members: {
    id: string;
    personId: string;
    name: string;
    role: 'owner' | 'member' | null;
    placeholder: boolean;
    leftTally: boolean;
    joinedAt: number;
    leftAt: number | null;
  }[];
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
    deletedAt: number | null;
    createdAt: number;
  }[];
  payments: {
    id: string;
    sealed: string | null;
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    currency: string;
    date: string;
    deletedAt: number | null;
    createdAt: number;
  }[];
  comments: {
    id: string;
    subject: 'expense' | 'payment';
    subjectId: string;
    authorPersonId: string;
    sealed: string;
    deletedAt: number | null;
    createdAt: number;
  }[];
}

/** Opened text by its sealed form: `undefined` where it could not be opened. */
export type Opened = (sealed: string) => Readonly<Record<string, string | null>> | undefined;

const byTime = <T extends { date?: string; createdAt: number; id: string }>(a: T, b: T) =>
  (a.date ?? '') < (b.date ?? '')
    ? -1
    : (a.date ?? '') > (b.date ?? '')
      ? 1
      : a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildExport(input: {
  profile: ExportFile['profile'];
  personId: string;
  groups: readonly GroupInput[];
  opened: Opened;
  now: number;
}): ExportFile {
  let unopened = 0;
  const text = (sealed: string | null, field: string): string | null => {
    if (!sealed) return null;
    const content = input.opened(sealed);
    if (!content) {
      unopened++;
      return null;
    }
    return content[field] ?? null;
  };
  const groups = [...input.groups]
    .map((g): ExportedGroup => {
      const memberOfPerson = new Map(g.members.map((m) => [m.personId, m.id]));
      // Payers and shares in the group's member order, as the server keeps them.
      const place = new Map(
        [...g.members]
          .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
          .map((m, i) => [m.id, i]),
      );
      const inOrder = <T extends { memberId: string }>(list: readonly T[]) =>
        [...list].sort((a, b) => (place.get(a.memberId) ?? 0) - (place.get(b.memberId) ?? 0));
      const commentsOf = (subject: 'expense' | 'payment', id: string): ExportedComment[] =>
        g.comments
          .filter((c) => c.subject === subject && c.subjectId === id && c.deletedAt === null)
          .sort(byTime)
          .map((c) => ({
            id: c.id,
            authorMemberId: memberOfPerson.get(c.authorPersonId) ?? null,
            body: text(c.sealed, 'body'),
            createdAt: c.createdAt,
          }));
      return {
        id: g.group.id,
        name: text(g.group.sealed, 'name'),
        color: g.group.color,
        defaultCurrency: g.group.defaultCurrency,
        simplifyDebts: g.group.simplifyDebts,
        closedAt: g.group.closedAt,
        yourMemberId: memberOfPerson.get(input.personId) ?? null,
        members: [...g.members]
          .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
          .map((m) => ({
            id: m.id,
            name: m.name,
            role: m.role,
            placeholder: m.placeholder,
            leftTally: m.leftTally,
            joinedAt: m.joinedAt,
            leftAt: m.leftAt,
          })),
        expenses: g.expenses
          .filter((e) => e.deletedAt === null)
          .sort(byTime)
          .map((e) => ({
            id: e.id,
            date: e.date,
            category: e.category,
            amount: e.amount,
            currency: e.currency,
            method: e.method,
            description: text(e.sealed, 'description'),
            note: text(e.sealed, 'note'),
            payers: inOrder(e.payers).map((p) => ({ memberId: p.memberId, amount: p.amount })),
            shares: inOrder(e.shares).map((s) => ({
              memberId: s.memberId,
              amount: s.amount,
              units: s.units,
            })),
            createdAt: e.createdAt,
            comments: commentsOf('expense', e.id),
          })),
        payments: g.payments
          .filter((p) => p.deletedAt === null)
          .sort(byTime)
          .map((p) => ({
            id: p.id,
            date: p.date,
            amount: p.amount,
            currency: p.currency,
            fromMemberId: p.fromMemberId,
            toMemberId: p.toMemberId,
            note: text(p.sealed, 'note'),
            createdAt: p.createdAt,
            comments: commentsOf('payment', p.id),
          })),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date(input.now).toISOString(),
    profile: input.profile,
    groups,
    unopened,
  };
}
