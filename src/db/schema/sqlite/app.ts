import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { counter, epochMs, id, ref } from './columns';

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
