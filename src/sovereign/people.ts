import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { tables } from '../db/tables';
import { personOfAccount } from '../people/persons';

/**
 * **`People.deletePerson`: everything personal of an account is removed by this, and only this** (DESIGN.md §18), and **only the name stays on the
 * shared record**, so that the others' numbers still add up. One routine, in a fixed order, **safe to run again**: the app's store and the sign-in store
 * cannot share a transaction, so a run that stopped part way is finished by running it again; the person is made nameless only after their groups are
 * dealt with, and the account, by which the routine finds them, goes **last**. Its shape is Ledger's; what it does is Tally's.
 *
 *  1. **Their groups**, each in a transaction of its own. A group with no other member who has an account is deleted with every row of it, by
 *     `group_id` (`GROUP_TABLES`: its members, keys, expenses with their payers and shares, payments, comments, revisions, activity and applied mutations). Otherwise, if they were its only owner, it passes to its longest-standing member with an account (who will be told,
 *     `owner_passed`, once notices exist, 9.1); their own role becomes `member`, and **their membership stays**, shown as left Tally, so that the
 *     expenses and payments it carries still add up (ending it where the balance is zero joins with balances, 4.3). The group's order moves on.
 *  2. **Their keys** (§5.3): the account key, its wraps, its requests and every group key wrapped to them.
 *  3. **Their person**: `account_id`, `email` and `core_sub` cleared and `deleted_at` set; the name stays. Placeholders they added that are in no group go.
 *  4. What was kept for them in the app's store: their settings, the mutations they sent (`applied_mutation`), and the counters of rate limits, keyed
 *     `kind:account`.
 *  5. **The sign-in store**: sessions, sign-ins, second factors, passkeys, pending verifications, and then the account.
 *
 * `people.test.ts` seeds a row in every table for the person and for a second person, finds nothing personal of the first after (the name aside), the
 * second's groups intact, and **fails for a table in none of the lists below**: a new table is decided here, in the same change.
 */
export interface PeopleDeps {
  readonly database: Database;
  readonly authDatabase: Database;
  readonly now: () => number;
}

/** The tables whose every row belongs to one group, deleted by `group_id` with a group that goes (the group's own row, `grp`, last). */
export const GROUP_TABLES = [
  'activity',
  'applied_mutation',
  'comment',
  'expense',
  'expense_payer',
  'expense_share',
  'key_wrap',
  'member',
  'payment',
  'revision',
] as const;

/**
 * Deletes every row of a group from every table that holds one, by `group_id` (`GROUP_TABLES`), in the caller's transaction. The group's own row
 * (`grp`) is the caller's to delete, in the same transaction: deleting a person deletes it in the statement that decides the group goes, and deleting
 * a group (`src/groups/lifecycle.ts`) in the statement that holds the owner and the group's emptiness. One list for both.
 */
export async function deleteGroupRows(tx: Database, groupId: string): Promise<void> {
  for (const name of GROUP_TABLES)
    await dbAll(
      tx,
      sql`DELETE FROM ${groupTable(tx, name)} WHERE group_id = ${groupId} RETURNING group_id`,
    );
}

/** Each of `GROUP_TABLES` as the dialect has it. */
function groupTable(database: Database, name: (typeof GROUP_TABLES)[number]) {
  const t = tables(database);
  return {
    activity: t.activity,
    applied_mutation: t.appliedMutation,
    comment: t.comment,
    expense: t.expense,
    expense_payer: t.expensePayer,
    expense_share: t.expenseShare,
    key_wrap: t.keyWrap,
    member: t.member,
    payment: t.payment,
    revision: t.revision,
  }[name];
}
/** The tables that hold something of an account, cleared by step 2 or 3. */
export const ACCOUNT_TABLES = [
  'account_key',
  'account_key_wrap',
  'account_settings',
  'key_request',
  'person',
] as const;
/** The tables that hold nothing of a person, or only an id that is not theirs to take: decided, and left. */
export const SHARED_TABLES = ['grp', 'rate_bucket'] as const;

export interface Deleted {
  /** Groups that went with the person, no other account being left in them. */
  readonly groupsDeleted: number;
  /** Groups that carry on for the other people in them. */
  readonly groupsLeft: number;
}

/** The groups a person is an active member of, and whether each has another member with an account: what deletion would do. */
export async function groupsOf(database: Database, personId: string) {
  const t = tables(database);
  return dbAll<{ groupId: string; others: number }>(
    database,
    sql`SELECT m.group_id AS "groupId",
               (SELECT COUNT(*) FROM ${t.member} o JOIN ${t.person} op ON op.id = o.person_id
                 WHERE o.group_id = m.group_id AND o.left_at IS NULL AND op.account_id IS NOT NULL AND o.person_id <> ${personId}) AS others
        FROM ${t.member} m WHERE m.person_id = ${personId} AND m.left_at IS NULL ORDER BY m.joined_at, m.group_id`,
  );
}

export async function deletePerson(deps: PeopleDeps, accountId: string): Promise<Deleted> {
  const { database, authDatabase } = deps;
  const t = tables(database);
  const now = deps.now();
  const person = await personOfAccount(database, accountId);
  let groupsDeleted = 0;
  let groupsLeft = 0;

  if (person) {
    // 1. Their groups.
    for (const { groupId } of await groupsOf(database, person.id)) {
      const deleted = await transaction(database, async (tx) => {
        // Whether anyone with an account is left, decided in the statement that deletes the group's own row.
        const gone = await dbAll<{ id: string }>(
          tx,
          sql`DELETE FROM ${t.grp} WHERE id = ${groupId}
                AND NOT EXISTS (SELECT 1 FROM ${t.member} o JOIN ${t.person} op ON op.id = o.person_id
                                 WHERE o.group_id = ${groupId} AND o.left_at IS NULL AND op.account_id IS NOT NULL AND o.person_id <> ${person.id})
              RETURNING id`,
        );
        if (gone.length > 0) {
          await deleteGroupRows(tx, groupId);
          return true;
        }
        const seq = (
          await dbAll<{ seq: number }>(
            tx,
            sql`UPDATE ${t.grp} SET seq = seq + 1, updated_at = ${now} WHERE id = ${groupId} RETURNING seq`,
          )
        )[0]?.seq;
        // The only owner: the group passes to its longest-standing member with an account.
        await dbAll(
          tx,
          sql`UPDATE ${t.member} SET role = 'owner', seq = ${seq ?? 0}
              WHERE id = (SELECT o.id FROM ${t.member} o JOIN ${t.person} op ON op.id = o.person_id
                           WHERE o.group_id = ${groupId} AND o.left_at IS NULL AND op.account_id IS NOT NULL AND o.person_id <> ${person.id}
                           ORDER BY o.joined_at, o.id LIMIT 1)
                AND NOT EXISTS (SELECT 1 FROM ${t.member} w JOIN ${t.person} wp ON wp.id = w.person_id
                                 WHERE w.group_id = ${groupId} AND w.left_at IS NULL AND w.role = 'owner' AND w.person_id <> ${person.id}
                                   AND wp.account_id IS NOT NULL)
              RETURNING id`,
        );
        await dbAll(
          tx,
          sql`UPDATE ${t.member} SET role = 'member', seq = ${seq ?? 0}
              WHERE group_id = ${groupId} AND person_id = ${person.id} AND role = 'owner' RETURNING id`,
        );
        return false;
      });
      if (deleted) groupsDeleted++;
      else groupsLeft++;
    }
  }

  // 2. Their keys.
  await transaction(database, async (tx) => {
    await dbAll(
      tx,
      sql`DELETE FROM ${t.keyWrap} WHERE account_id = ${accountId} RETURNING group_id`,
    );
    await dbAll(tx, sql`DELETE FROM ${t.keyRequest} WHERE account_id = ${accountId} RETURNING id`);
    await dbAll(
      tx,
      sql`DELETE FROM ${t.accountKeyWrap} WHERE account_id = ${accountId} RETURNING id`,
    );
    await dbAll(
      tx,
      sql`DELETE FROM ${t.accountKey} WHERE account_id = ${accountId} RETURNING account_id`,
    );
  });

  // 3. Their person, as a name only, and their placeholders that are in no group.
  if (person) {
    await transaction(database, async (tx) => {
      await dbAll(
        tx,
        sql`DELETE FROM ${t.person} WHERE added_by = ${person.id} AND account_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM ${t.member} m WHERE m.person_id = ${t.person}.id) RETURNING id`,
      );
      await dbAll(
        tx,
        sql`UPDATE ${t.person} SET account_id = NULL, email = NULL, core_sub = NULL, deleted_at = ${now}, updated_at = ${now}
            WHERE id = ${person.id} RETURNING id`,
      );
    });
  }

  // 4. What was kept for them in the app's store: their settings, the record of the mutations they sent, and the counters of rate limits, keyed
  // `kind:account`.
  await dbAll(
    database,
    sql`DELETE FROM ${t.appliedMutation} WHERE account_id = ${accountId} RETURNING id`,
  );
  await dbAll(
    database,
    sql`DELETE FROM ${t.accountSettings} WHERE account_id = ${accountId} RETURNING account_id`,
  );
  await dbAll(
    database,
    sql`DELETE FROM ${t.rateBucket} WHERE "key" LIKE ${`%:${accountId}`} RETURNING "key"`,
  );

  // 5. The sign-in store. The address is read first, for the verifications named by it; the account goes last.
  const auth = authDatabase.dialect === 'postgres' ? postgresSchema : sqliteSchema;
  const user = await dbGet<{ email: string }>(
    authDatabase,
    sql`SELECT email FROM ${auth.user} WHERE id = ${accountId}`,
  );
  await dbAll(
    authDatabase,
    sql`DELETE FROM ${auth.session} WHERE user_id = ${accountId} RETURNING id`,
  );
  await dbAll(
    authDatabase,
    sql`DELETE FROM ${auth.account} WHERE user_id = ${accountId} RETURNING id`,
  );
  await dbAll(
    authDatabase,
    sql`DELETE FROM ${auth.twoFactor} WHERE user_id = ${accountId} RETURNING id`,
  );
  await dbAll(
    authDatabase,
    sql`DELETE FROM ${auth.passkey} WHERE user_id = ${accountId} RETURNING id`,
  );
  if (user) {
    await dbAll(
      authDatabase,
      sql`DELETE FROM ${auth.verification} WHERE LOWER(identifier) = ${user.email.toLowerCase()} RETURNING id`,
    );
  }
  await dbAll(authDatabase, sql`DELETE FROM ${auth.user} WHERE id = ${accountId} RETURNING id`);

  return { groupsDeleted, groupsLeft };
}
