import { index, pgSchema, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { APP_STORE } from '../../config';
import { counter, epochMs, id, ref } from './columns';

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
