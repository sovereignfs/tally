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
