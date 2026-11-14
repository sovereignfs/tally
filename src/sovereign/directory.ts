import { createSovereign } from '@sovereignfs/sdk';
import { sql } from 'drizzle-orm';
import { getConfig } from '../config/current';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { tables } from '../db/tables';
import { OpError } from '../groups/errors';
import { RateLimiter, type Rule } from '../limits/rate';
import { coreTokenStore } from './tokens';

/**
 * **Finding people in core's directory** (DESIGN.md §6.2, §14.4), behind the Add people field: `sv.as({ sub }).directory.searchUsers`, as the person,
 * with their refresh token from `tokens.ts`. Only for someone linked to core, on an instance where core is set and the instance key keeps the token;
 * anywhere else, and whenever core says no (the scope not granted, an older core, no token yet, core down), the answer is "not available" and the field
 * searches Tally alone. Each found person says whether they are already a person here, by their `sub`.
 */
export interface DirectoryPerson {
  sub: string;
  name: string;
  /** Their person here, when they have one (an account that signed in through core, or someone already added from the directory). */
  personId: string | null;
}

/** What searches the directory as a person: the SDK's, or a test's. */
export type DirectorySource = (sub: string) => {
  searchUsers(request: {
    q: string;
    limit?: number;
  }): Promise<{ users: { sub: string; name: string }[] }>;
};

/** Searches per account and minute: a field typed into, debounced, is a few. */
export const DIRECTORY_SEARCH: Rule = { limit: 60, windowMs: 60 * 1000 };
const MAX_RESULTS = 8;

let decided: { value: DirectorySource | undefined } | undefined;

/** The server's: from the settings, or nothing where core, the app's address or the instance key is missing. */
export function directorySource(database: Database): DirectorySource | undefined {
  if (decided) return decided.value;
  try {
    const config = getConfig();
    const core = config.auth?.sovereign;
    const ring = config.encryption;
    if (!core || !ring || !config.url) return undefined;
    const sovereign = createSovereign({
      appUrl: config.url,
      coreUrl: new URL(core.issuer).origin,
      clientId: core.clientId,
      clientSecret: core.clientSecret,
      tokenStore: coreTokenStore(database, ring),
    });
    return (sub) => sovereign.as({ sub }).directory;
  } catch {
    return undefined;
  }
}

/** For a test: the directory to search, or none (`undefined`); `null` goes back to the settings. */
export function setDirectoryForTests(value: DirectorySource | undefined | null): void {
  decided = value === null ? undefined : { value };
}

export async function searchDirectory(
  database: Database,
  who: { accountId: string; personId: string },
  input: Record<string, unknown>,
  source: DirectorySource | undefined = directorySource(database),
): Promise<{ available: boolean; people: DirectoryPerson[] }> {
  const q = typeof input.q === 'string' ? input.q.trim() : '';
  if (q.length < 2 || q.length > 100) throw new OpError('invalid');
  const t = tables(database);
  const me = await dbGet<{ coreSub: string | null }>(
    database,
    sql`SELECT core_sub AS "coreSub" FROM ${t.person} WHERE id = ${who.personId}`,
  );
  if (!source || !me?.coreSub) return { available: false, people: [] };
  const taken = await new RateLimiter(database).take(
    `directory:${who.accountId}`,
    DIRECTORY_SEARCH,
  );
  if (!taken.ok)
    throw new OpError('rate_limited', 'Too many searches. Wait a moment and try again.');
  let users: { sub: string; name: string }[];
  try {
    users = (await source(me.coreSub).searchUsers({ q, limit: MAX_RESULTS })).users;
  } catch {
    // The scope not granted, an older core, no token yet, or core down: the field searches Tally alone.
    return { available: false, people: [] };
  }
  const found = users.filter((u) => u.sub !== me.coreSub).slice(0, MAX_RESULTS);
  const here =
    found.length === 0
      ? []
      : await dbAll<{ id: string; coreSub: string }>(
          database,
          sql`SELECT id, core_sub AS "coreSub" FROM ${t.person} WHERE core_sub IN (${sql.join(
            found.map((u) => sql`${u.sub}`),
            sql`, `,
          )}) AND deleted_at IS NULL`,
        );
  const personOf = new Map(here.map((p) => [p.coreSub, p.id]));
  return {
    available: true,
    people: found.map((u) => ({ sub: u.sub, name: u.name, personId: personOf.get(u.sub) ?? null })),
  };
}
