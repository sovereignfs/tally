import { type DBSchema, type IDBPDatabase, deleteDB, openDB } from 'idb';
import type { Mutation } from '../actions/types';
import type { Refusal } from '../actions/validate';
import type {
  SyncedComment,
  SyncedExpense,
  SyncedGroup,
  SyncedMember,
  SyncedPayment,
} from '../sync/format';

/**
 * **The device's store** (DESIGN.md §11.1, §19.3): IndexedDB through `idb`, **one database per account** (`tally-<account id>`), holding only the
 * account's groups, so that a second account on the same device sees nothing of the first and signing out deletes exactly one. Screens read and write
 * only this; the server is something the sync loop talks to. Tusk's Desk store (`src/local/db.ts`), with Tally's tables.
 *
 * - `grp`, `member`, `expense`, `payment`, `comment`: the rows as the device shows them: the server's, with this device's unanswered changes laid
 *   over. Sealed text stays sealed here, as it arrived; it is opened in memory with the group's key (§5.3).
 * - `shadow`: for a row with unanswered changes, the row as the server last had it (or null, one the device made), so that a refused change can be
 *   taken back and a pull laid under the changes still waiting.
 * - `outbox`: the mutations not yet answered, in the order they were made, written in the same transaction as the rows they change.
 * - `failed`: mutations the server refused, with the reason, for Couldn't sync (§11.5). Nothing anyone typed is thrown away.
 * - `meta`: each group's cursor, and when the device last heard from the server.
 */
export type LocalExpense = SyncedExpense & { groupId: string };
export type LocalPayment = SyncedPayment & { groupId: string };
export type LocalComment = SyncedComment & { groupId: string };
export type LocalMember = SyncedMember & { groupId: string };
export type LocalGroup = SyncedGroup;

export type LocalTable = 'grp' | 'member' | 'expense' | 'payment' | 'comment';

export interface OutboxEntry {
  /** The order, assigned by the store. */
  n?: number;
  mutation: Mutation;
  queuedAt: number;
}

export interface FailedEntry {
  mutationId: string;
  mutation: Mutation;
  refusal: Refusal;
  failedAt: number;
}

export interface Shadow {
  table: LocalTable;
  id: string;
  row: LocalExpense | LocalPayment | LocalComment | null;
}

export interface LocalSchema extends DBSchema {
  grp: { key: string; value: LocalGroup };
  member: { key: string; value: LocalMember; indexes: { byGroup: string } };
  expense: { key: string; value: LocalExpense; indexes: { byGroup: string } };
  payment: { key: string; value: LocalPayment; indexes: { byGroup: string } };
  comment: { key: string; value: LocalComment; indexes: { byGroup: string; bySubject: string } };
  shadow: { key: [string, string]; value: Shadow };
  outbox: { key: number; value: OutboxEntry };
  failed: { key: string; value: FailedEntry };
  meta: { key: string; value: unknown };
}

export type LocalDatabase = IDBPDatabase<LocalSchema>;

/** The version of the stores below. A change adds a step to `upgrade` and raises this; it never edits an earlier step. */
export const LOCAL_VERSION = 1;

export const localName = (accountId: string): string => `tally-${accountId}`;

export async function openLocal(
  accountId: string,
  name = localName(accountId),
): Promise<LocalDatabase> {
  return openDB<LocalSchema>(name, LOCAL_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('grp', { keyPath: 'id' });
        for (const table of ['member', 'expense', 'payment'] as const)
          db.createObjectStore(table, { keyPath: 'id' }).createIndex('byGroup', 'groupId');
        const comment = db.createObjectStore('comment', { keyPath: 'id' });
        comment.createIndex('byGroup', 'groupId');
        comment.createIndex('bySubject', 'subjectId');
        db.createObjectStore('shadow', { keyPath: ['table', 'id'] });
        db.createObjectStore('outbox', { keyPath: 'n', autoIncrement: true });
        db.createObjectStore('failed', { keyPath: 'mutationId' });
        db.createObjectStore('meta');
      }
    },
    // Another tab is deleting this account's database (it signed out): this connection lets go, or the deletion would wait for every tab to close.
    blocking(_current, _blocked, event) {
      (event.target as IDBDatabase).close();
    },
  });
}

/** Deletes an account's database from this device: what signing out does (§11.7). */
export async function deleteLocal(accountId: string, name = localName(accountId)): Promise<void> {
  await deleteDB(name);
}
