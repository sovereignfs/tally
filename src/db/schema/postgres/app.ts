import { index, pgSchema, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { APP_STORE } from '../../config';
import { bool, counter, epochMs, id, isoDate, json, money, ref } from './columns';

/** The app's schema; better-auth's is `tally_auth` (DESIGN.md §19.1). */
export const app = pgSchema(APP_STORE);

/** See `schema/sqlite/app.ts`. */
export const rateBucket = app.table(
  'rate_bucket',
  {
    key: id('key'),
    windowStart: epochMs('window_start').notNull(),
    count: counter('count').notNull(),
  },
  (table) => [index('rate_bucket_window_idx').on(table.windowStart)],
);

/** See `schema/sqlite/app.ts`. */
export const person = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const accountKey = app.table('account_key', {
  accountId: id('account_id'),
  publicKey: text('public_key').notNull(),
  version: counter('version').notNull(),
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

/** See `schema/sqlite/app.ts`. */
export const accountKeyWrap = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const keyRequest = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const grp = app.table('grp', {
  id: id('id'),
  sealed: text('sealed').notNull(),
  color: text('color').notNull(),
  defaultCurrency: text('default_currency').notNull(),
  simplifyDebts: bool('simplify_debts').notNull(),
  closedAt: epochMs('closed_at'),
  keyEpoch: counter('key_epoch').notNull(),
  keyRotationDue: bool('key_rotation_due').notNull().default(false),
  seq: counter('seq').notNull(),
  createdBy: ref('created_by').notNull(),
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

/**
 * **A person's place in a group** (DESIGN.md §7.2): a role (`owner`, `member`, or none for a placeholder), what they hear of it (`notify`, §12.2),
 * and when they joined and left. A membership row is never deleted once something points at it; leaving sets `left_at`.
 */
export const member = app.table(
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
export const keyWrap = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const accountSettings = app.table('account_settings', {
  accountId: id('account_id'),
  primaryCurrency: text('primary_currency').notNull(),
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

/** See `schema/sqlite/app.ts`. */
export const expense = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const expensePayer = app.table(
  'expense_payer',
  {
    expenseId: ref('expense_id').notNull(),
    memberId: ref('member_id').notNull(),
    groupId: ref('group_id').notNull(),
    amount: money('amount').notNull(),
  },
  (table) => [primaryKey({ columns: [table.expenseId, table.memberId] })],
);

/** See `schema/sqlite/app.ts`. */
export const expenseShare = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const payment = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const revision = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const appliedMutation = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const comment = app.table(
  'comment',
  {
    id: id('id'),
    groupId: ref('group_id').notNull(),
    subject: text('subject').notNull(),
    subjectId: ref('subject_id').notNull(),
    authorPersonId: ref('author_person_id').notNull(),
    sealed: text('sealed').notNull(),
    deletedAt: epochMs('deleted_at'),
    seq: counter('seq').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [
    index('comment_subject_idx').on(table.subjectId),
    index('comment_group_seq_idx').on(table.groupId, table.seq),
  ],
);

/** See `schema/sqlite/app.ts`. */
export const activity = app.table(
  'activity',
  {
    id: id('id'),
    groupId: ref('group_id').notNull(),
    actorPersonId: ref('actor_person_id'),
    kind: text('kind').notNull(),
    subjectId: ref('subject_id'),
    details: json('details').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [index('activity_group_time_idx').on(table.groupId, table.createdAt)],
);
