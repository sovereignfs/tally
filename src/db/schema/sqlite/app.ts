import { index, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { bool, counter, epochMs, id, isoDate, json, money, ref } from './columns';

/**
 * What the app holds, in the app store (DESIGN.md §19.3). An account is better-auth's, in the other store, so `account_id` is a reference by
 * value and never a foreign key; there are none, and every deletion names what it deletes (`People.deletePerson`, task 2.5). The tables of
 * later tasks are added by their own migrations.
 */

/**
 * Counts for rate limits, in the database so that a limit holds across every process: a key, when its window began, and how many have been
 * counted in it (`src/limits/rate.ts`). Swept when a window is long over.
 */
export const rateBucket = sqliteTable(
  'rate_bucket',
  {
    key: id('key'),
    windowStart: epochMs('window_start').notNull(),
    count: counter('count').notNull(),
  },
  (table) => [index('rate_bucket_window_idx').on(table.windowStart)],
);

/**
 * **Someone who can be in a group** (DESIGN.md §6.1): every account has exactly one, made with it; a placeholder is one with no account. The name is
 * what every member sees and is read from here, never from the auth store; the email is shown only to whom `src/people/visibility.ts` allows. A
 * deleted account's person keeps its name, with `account_id`, `email` and `core_sub` cleared (§18).
 */
export const person = sqliteTable(
  'person',
  {
    id: id('id'),
    accountId: ref('account_id'),
    coreSub: text('core_sub'),
    name: text('name').notNull(),
    email: text('email'),
    addedBy: ref('added_by'),
    claimedAt: epochMs('claimed_at'),
    deletedAt: epochMs('deleted_at'),
    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('person_account_idx').on(table.accountId),
    uniqueIndex('person_core_sub_idx').on(table.coreSub),
    index('person_added_by_idx').on(table.addedBy),
  ],
);

/**
 * **An account's key** (DESIGN.md §5.3): the public half of its X25519 key pair, which a group's key is wrapped to. The private half is on the account's
 * devices and here only wrapped (`account_key_wrap`). `version` goes up when the key is replaced, the last resort when no way in is left; every wrap
 * says which version it is of.
 */
export const accountKey = sqliteTable('account_key', {
  accountId: id('account_id'),
  publicKey: text('public_key').notNull(),
  version: counter('version').notNull(),
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

/**
 * **The account key's private half, wrapped by a way in** (DESIGN.md §5.3): the password's unwrapping value, a passkey's PRF output (with its
 * credential), the recovery code, or a new device's one-time key. The server holds these and can open none of them.
 */
export const accountKeyWrap = sqliteTable(
  'account_key_wrap',
  {
    id: id('id'),
    accountId: ref('account_id').notNull(),
    version: counter('version').notNull(),
    method: text('method').notNull(),
    credentialId: text('credential_id'),
    params: text('params'),
    wrapped: text('wrapped').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [index('account_key_wrap_account_idx').on(table.accountId)],
);

/**
 * **A new device asking another of the account's devices for the key** (DESIGN.md §5.3), the fallback when the way it signed in cannot unlock: its
 * one-time public key, and once a device has allowed it, the account key wrapped to that. Good for ten minutes, and deleted once taken.
 */
export const keyRequest = sqliteTable(
  'key_request',
  {
    id: id('id'),
    accountId: ref('account_id').notNull(),
    publicKey: text('public_key').notNull(),
    label: text('label').notNull(),
    wrapped: text('wrapped'),
    createdAt: epochMs('created_at').notNull(),
    expiresAt: epochMs('expires_at').notNull(),
  },
  (table) => [index('key_request_account_idx').on(table.accountId)],
);

/**
 * **A group** (DESIGN.md §7.1): its name is sealed (`sealed`, `{name}` under the group's key, §5.3); its colour, default currency and whether debts
 * are simplified are plain. `key_epoch` is the epoch of its key that new text is sealed under; `seq` orders every change of the group (§11.3).
 */
export const grp = sqliteTable('grp', {
  id: id('id'),
  sealed: text('sealed').notNull(),
  color: text('color').notNull(),
  defaultCurrency: text('default_currency').notNull(),
  simplifyDebts: bool('simplify_debts').notNull(),
  closedAt: epochMs('closed_at'),
  keyEpoch: counter('key_epoch').notNull(),
  seq: counter('seq').notNull(),
  createdBy: ref('created_by').notNull(),
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

/**
 * **A person's place in a group** (DESIGN.md §7.2): a role (`owner`, `member`, or none for a placeholder), what they hear of it (`notify`, §12.2),
 * and when they joined and left. A membership row is never deleted once something points at it; leaving sets `left_at`.
 */
export const member = sqliteTable(
  'member',
  {
    id: id('id'),
    groupId: ref('group_id').notNull(),
    personId: ref('person_id').notNull(),
    role: text('role'),
    notify: text('notify').notNull(),
    addedBy: ref('added_by'),
    joinedAt: epochMs('joined_at').notNull(),
    leftAt: epochMs('left_at'),
    seq: counter('seq').notNull(),
  },
  (table) => [
    index('member_person_idx').on(table.personId),
    index('member_group_idx').on(table.groupId),
  ],
);

/**
 * **A group's key, wrapped to a member's account key** (DESIGN.md §5.3): one row per epoch and account. The server stores it and can open none.
 */
export const keyWrap = sqliteTable(
  'key_wrap',
  {
    groupId: ref('group_id').notNull(),
    epoch: counter('epoch').notNull(),
    accountId: ref('account_id').notNull(),
    wrapped: text('wrapped').notNull(),
    wrappedBy: ref('wrapped_by').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.epoch, table.accountId] }),
    index('key_wrap_account_idx').on(table.accountId),
  ],
);

/** **An account's own settings** (DESIGN.md §16): its primary currency, which new groups take and which figures in several currencies list first. */
export const accountSettings = sqliteTable('account_settings', {
  accountId: id('account_id'),
  primaryCurrency: text('primary_currency').notNull(),
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

/**
 * **An expense** (DESIGN.md §8): its figures plain, so that the server checks them and works out balances; what was written (`{description, note}`)
 * sealed. `version` moves on with every change, and each is kept in `revision`; `deleted_at` marks a deleted one, which counts for nothing and can be
 * restored. Written only through `src/sync/apply.ts`.
 */
export const expense = sqliteTable(
  'expense',
  {
    id: id('id'),
    groupId: ref('group_id').notNull(),
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    date: isoDate('date').notNull(),
    category: text('category').notNull(),
    sealed: text('sealed').notNull(),
    method: text('method').notNull(),
    version: counter('version').notNull(),
    createdBy: ref('created_by').notNull(),
    updatedBy: ref('updated_by').notNull(),
    deletedAt: epochMs('deleted_at'),
    seq: counter('seq').notNull(),
    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
  },
  (table) => [
    index('expense_group_seq_idx').on(table.groupId, table.seq),
    index('expense_group_date_idx').on(table.groupId, table.date),
  ],
);

/** Who paid an expense, and how much (§8.2); replaced whole with the expense. */
export const expensePayer = sqliteTable(
  'expense_payer',
  {
    expenseId: ref('expense_id').notNull(),
    memberId: ref('member_id').notNull(),
    groupId: ref('group_id').notNull(),
    amount: money('amount').notNull(),
  },
  (table) => [primaryKey({ columns: [table.expenseId, table.memberId] })],
);

/** Each member's share of an expense (§8.3), with what was typed for it (`units`); replaced whole with the expense. */
export const expenseShare = sqliteTable(
  'expense_share',
  {
    expenseId: ref('expense_id').notNull(),
    memberId: ref('member_id').notNull(),
    groupId: ref('group_id').notNull(),
    amount: money('amount').notNull(),
    units: counter('units'),
  },
  (table) => [primaryKey({ columns: [table.expenseId, table.memberId] })],
);

/** **A payment** (DESIGN.md §9): one member gave another money outside Tally. The note is sealed; the rest as an expense's. */
export const payment = sqliteTable(
  'payment',
  {
    id: id('id'),
    groupId: ref('group_id').notNull(),
    fromMemberId: ref('from_member_id').notNull(),
    toMemberId: ref('to_member_id').notNull(),
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    date: isoDate('date').notNull(),
    sealed: text('sealed'),
    version: counter('version').notNull(),
    createdBy: ref('created_by').notNull(),
    updatedBy: ref('updated_by').notNull(),
    deletedAt: epochMs('deleted_at'),
    seq: counter('seq').notNull(),
    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
  },
  (table) => [
    index('payment_group_seq_idx').on(table.groupId, table.seq),
    index('payment_group_date_idx').on(table.groupId, table.date),
  ],
);

/**
 * **Every version of an expense or a payment** (DESIGN.md §8.5): how it came about (`created`, `edited`, `deleted`, `restored`, or `replaced` for a
 * version a later edit from an older base overwrote, §11.4), the row as it was (`snapshot`, its sealed text still sealed), and who.
 */
export const revision = sqliteTable(
  'revision',
  {
    id: id('id'),
    groupId: ref('group_id').notNull(),
    subject: text('subject').notNull(),
    subjectId: ref('subject_id').notNull(),
    version: counter('version').notNull(),
    kind: text('kind').notNull(),
    snapshot: json('snapshot').notNull(),
    actorPersonId: ref('actor_person_id'),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [index('revision_subject_idx').on(table.subjectId)],
);

/** **A mutation applied** (DESIGN.md §11.2): its id, per account, so that the same one sent again writes nothing and answers as before. */
export const appliedMutation = sqliteTable(
  'applied_mutation',
  {
    accountId: ref('account_id').notNull(),
    id: ref('id').notNull(),
    groupId: ref('group_id').notNull(),
    seq: counter('seq').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.id] }),
    index('applied_mutation_created_idx').on(table.createdAt),
  ],
);
