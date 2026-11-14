import { index, pgSchema, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { APP_STORE } from '../../config';
import { bool, counter, epochMs, id, ref } from './columns';

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
