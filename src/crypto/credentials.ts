import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { tables } from '../db/tables';
import { open, seal } from './envelope';
import type { KeyRing } from './keys';

/**
 * **The one place a credential is written or read** (DESIGN.md §14.4): sealed by `envelope.ts` under the instance key, bound to its row and purpose.
 * Nothing here logs, and an error never carries a value. One credential per account and purpose.
 */
export interface Stored {
  id: string;
  sealed: string;
  plain: string;
}

/** The account's credential for `purpose`, opened, or nothing. A value that no longer opens (a key gone) reads as nothing. */
export async function readCredential(
  database: Database,
  ring: KeyRing,
  accountId: string,
  purpose: string,
): Promise<Stored | undefined> {
  const row = await dbGet<{ id: string; sealed: string }>(
    database,
    sql`SELECT id, sealed FROM ${tables(database).credential} WHERE account_id = ${accountId} AND purpose = ${purpose}`,
  );
  if (!row) return undefined;
  try {
    return { ...row, plain: open(row.sealed, { id: row.id, purpose }, ring) };
  } catch {
    return undefined;
  }
}

/** Keeps `plain` as the account's credential for `purpose`, in place of any before it. */
export async function putCredential(
  database: Database,
  ring: KeyRing,
  accountId: string,
  purpose: string,
  plain: string,
  now = Date.now(),
): Promise<void> {
  const t = tables(database);
  const id =
    (
      await dbGet<{ id: string }>(
        database,
        sql`SELECT id FROM ${t.credential} WHERE account_id = ${accountId} AND purpose = ${purpose}`,
      )
    )?.id ?? crypto.randomUUID();
  const sealed = seal(plain, { id, purpose }, ring.current);
  await dbAll(
    database,
    sql`INSERT INTO ${t.credential} (id, account_id, purpose, sealed, key_fingerprint, locked_until, created_at, updated_at)
        VALUES (${id}, ${accountId}, ${purpose}, ${sealed}, ${ring.current.fingerprint}, NULL, ${now}, ${now})
        ON CONFLICT (account_id, purpose) DO UPDATE SET sealed = ${sealed}, key_fingerprint = ${ring.current.fingerprint}, updated_at = ${now}
        RETURNING id`,
  );
}

/**
 * Stores `next` in place of `previous`, only while the stored value is still `previous`: a conditional update on the sealed text that was read. True
 * when it stored. `previous` undefined stores only where there is none yet.
 */
export async function swapCredential(
  database: Database,
  ring: KeyRing,
  accountId: string,
  purpose: string,
  next: string,
  previous: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  const t = tables(database);
  const current = await readCredential(database, ring, accountId, purpose);
  if (previous === undefined) {
    if (current) return false;
    const id = crypto.randomUUID();
    const sealed = seal(next, { id, purpose }, ring.current);
    const made = await dbAll<{ id: string }>(
      database,
      sql`INSERT INTO ${t.credential} (id, account_id, purpose, sealed, key_fingerprint, locked_until, created_at, updated_at)
          VALUES (${id}, ${accountId}, ${purpose}, ${sealed}, ${ring.current.fingerprint}, NULL, ${now}, ${now})
          ON CONFLICT (account_id, purpose) DO NOTHING RETURNING id`,
    );
    return made.length === 1;
  }
  if (!current || current.plain !== previous) return false;
  const sealed = seal(next, { id: current.id, purpose }, ring.current);
  const stored = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${t.credential} SET sealed = ${sealed}, key_fingerprint = ${ring.current.fingerprint}, updated_at = ${now}
        WHERE id = ${current.id} AND sealed = ${current.sealed} RETURNING id`,
  );
  return stored.length === 1;
}

/** Takes the lease on the account's credential for `ms`, while nobody else holds it. True when taken; false when held, or when there is none. */
export async function leaseCredential(
  database: Database,
  accountId: string,
  purpose: string,
  now: number,
  ms: number,
): Promise<boolean> {
  const taken = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${tables(database).credential} SET locked_until = ${now + ms}
        WHERE account_id = ${accountId} AND purpose = ${purpose} AND (locked_until IS NULL OR locked_until < ${now}) RETURNING id`,
  );
  return taken.length === 1;
}

export async function releaseCredential(database: Database, accountId: string, purpose: string) {
  await dbAll(
    database,
    sql`UPDATE ${tables(database).credential} SET locked_until = NULL WHERE account_id = ${accountId} AND purpose = ${purpose} RETURNING id`,
  );
}

export async function deleteCredential(database: Database, accountId: string, purpose: string) {
  await dbAll(
    database,
    sql`DELETE FROM ${tables(database).credential} WHERE account_id = ${accountId} AND purpose = ${purpose} RETURNING id`,
  );
}
