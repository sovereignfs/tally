import { sql } from 'drizzle-orm';
import {
  deleteCredential,
  leaseCredential,
  readCredential,
  releaseCredential,
  swapCredential,
} from '../crypto/credentials';
import type { KeyRing } from '../crypto/keys';
import type { Database } from '../db/client';
import { dbGet } from '../db/exec';
import { tables } from '../db/tables';

/**
 * **Core's refresh token, as the SDK keeps it** (DESIGN.md §14.4): `@sovereignfs/sdk`'s `TokenStore`, by `sub`, over the account's sealed credential
 * (`src/crypto/credentials.ts`). The `sub` is the person's (`person.core_sub`), whose account holds the token. A write stores only in place of the token
 * it replaces, and a lease in the database lets one process at a time refresh it, since two sending the same token look to core like theft. The
 * token is never in a log, an error or the browser.
 */
export const CORE_TOKEN = 'core-refresh-token';
const LEASE_MS = 30_000;
const WAIT_MS = 100;

export interface CoreTokenStore {
  read(sub: string): Promise<string | undefined>;
  write(sub: string, next: string, previous: string | undefined): Promise<boolean>;
  lock<T>(sub: string, work: () => Promise<T>): Promise<T>;
  delete(sub: string): Promise<void>;
}

async function accountOf(database: Database, sub: string): Promise<string | undefined> {
  const row = await dbGet<{ accountId: string | null }>(
    database,
    sql`SELECT account_id AS "accountId" FROM ${tables(database).person} WHERE core_sub = ${sub}`,
  );
  return row?.accountId ?? undefined;
}

export function coreTokenStore(
  database: Database,
  ring: KeyRing,
  now: () => number = Date.now,
): CoreTokenStore {
  return {
    async read(sub) {
      const account = await accountOf(database, sub);
      return account
        ? (await readCredential(database, ring, account, CORE_TOKEN))?.plain
        : undefined;
    },
    async write(sub, next, previous) {
      const account = await accountOf(database, sub);
      if (!account) return false;
      return swapCredential(database, ring, account, CORE_TOKEN, next, previous, now());
    },
    async lock(sub, work) {
      const account = await accountOf(database, sub);
      if (!account) return work();
      // Waits for the lease, at most as long as one lasts; a token nobody holds yet needs none.
      const until = now() + LEASE_MS;
      let held = await leaseCredential(database, account, CORE_TOKEN, now(), LEASE_MS);
      while (
        !held &&
        (await readCredential(database, ring, account, CORE_TOKEN)) &&
        now() <= until
      ) {
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        held = await leaseCredential(database, account, CORE_TOKEN, now(), LEASE_MS);
      }
      try {
        return await work();
      } finally {
        if (held) await releaseCredential(database, account, CORE_TOKEN);
      }
    },
    async delete(sub) {
      const account = await accountOf(database, sub);
      if (account) await deleteCredential(database, account, CORE_TOKEN);
    },
  };
}
