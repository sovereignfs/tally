import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';

/**
 * **A person** (DESIGN.md §6.1): Tally's own record of someone who can be in a group, with a name, an email if known, and the account if they have
 * one. Every account has exactly one; a placeholder has none.
 *
 * The account is in the auth store and the person in the app store, two databases, so they cannot be made in one transaction. A person is made
 * when better-auth has made the account (`onAccountCreated`, `src/auth/auth.ts`), **and again, if it is missing, whenever the account is found
 * signed in** (`ensurePerson`, from `src/people/session.ts`): an account whose person was not made, because the app store did not answer at that
 * moment, has one at its next request. Making one is safe to run twice and from two processes: `account_id` is unique, and the second insert does
 * nothing.
 */
export interface Person {
  id: string;
  accountId: string | null;
  coreSub: string | null;
  name: string;
  email: string | null;
  addedBy: string | null;
  claimedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const COLUMNS = sql`id, account_id AS "accountId", core_sub AS "coreSub", name, email, added_by AS "addedBy",
  claimed_at AS "claimedAt", deleted_at AS "deletedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

/** The longest a name may be, as typed. */
export const NAME_MAX = 100;

/** A name as it is kept: trimmed, inner runs of space made one, and at most `NAME_MAX` characters. Empty is the caller's to refuse. */
export function cleanName(name: string): string {
  return [...name.trim().replace(/\s+/g, ' ')].slice(0, NAME_MAX).join('');
}

export async function personOfAccount(
  database: Database,
  accountId: string,
): Promise<Person | undefined> {
  return dbGet<Person>(
    database,
    sql`SELECT ${COLUMNS} FROM ${tables(database).person} WHERE account_id = ${accountId}`,
  );
}

export async function personById(database: Database, id: string): Promise<Person | undefined> {
  return dbGet<Person>(
    database,
    sql`SELECT ${COLUMNS} FROM ${tables(database).person} WHERE id = ${id}`,
  );
}

/**
 * The account's person, made if it is not there yet, with the name and email the account was made with. Never overwrites a person that exists:
 * the name and email are the person's to change, in Settings (§16).
 */
export async function ensurePerson(
  database: Database,
  account: { id: string; name: string; email: string },
  now: number = Date.now(),
): Promise<Person> {
  const existing = await personOfAccount(database, account.id);
  if (existing) return existing;
  const name = cleanName(account.name) || account.email.split('@')[0] || 'Someone';
  await dbRun(
    database,
    sql`INSERT INTO ${tables(database).person} (id, account_id, name, email, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${account.id}, ${name}, ${account.email.trim().toLowerCase()}, ${now}, ${now})
        ON CONFLICT (account_id) DO NOTHING`,
  );
  const made = await personOfAccount(database, account.id);
  if (!made) throw new Error('person: not made');
  return made;
}

/** Every person, for the tests of deletion and export that hold every table to account. */
export async function allPersons(database: Database): Promise<Person[]> {
  return dbAll<Person>(
    database,
    sql`SELECT ${COLUMNS} FROM ${tables(database).person} ORDER BY created_at, id`,
  );
}

/**
 * Keeps the account's person in step when the name is changed in Settings (DESIGN.md §6.1): the name is the person's everywhere, read from here. The
 * email follows the account's too. A person whose account is gone is not touched.
 */
export async function updatePersonFromAccount(
  database: Database,
  account: { id: string; name: string; email: string },
  now: number = Date.now(),
): Promise<void> {
  const name = cleanName(account.name);
  if (!name) return;
  await dbRun(
    database,
    sql`UPDATE ${tables(database).person} SET name = ${name}, email = ${account.email.trim().toLowerCase()}, updated_at = ${now}
        WHERE account_id = ${account.id}`,
  );
}
