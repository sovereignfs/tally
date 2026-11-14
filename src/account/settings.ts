import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { tables } from '../db/tables';
import { isSupportedCurrencyCode } from '../money/currencies';

/**
 * **An account's own settings** (DESIGN.md §16): for now its primary currency, which pre-fills new groups and lists first where a person has figures in
 * several. Tally never converts between currencies, and the setting says so. Read and written by the session's account only.
 */
export const DEFAULT_CURRENCY = 'EUR';

export async function settingsOf(
  database: Database,
  accountId: string,
): Promise<{ primaryCurrency: string }> {
  const found = await dbGet<{ primaryCurrency: string }>(
    database,
    sql`SELECT primary_currency AS "primaryCurrency" FROM ${tables(database).accountSettings} WHERE account_id = ${accountId}`,
  );
  return found ?? { primaryCurrency: DEFAULT_CURRENCY };
}

export async function setPrimaryCurrency(
  database: Database,
  accountId: string,
  currency: unknown,
  now = Date.now(),
): Promise<string> {
  if (typeof currency !== 'string' || !isSupportedCurrencyCode(currency))
    throw new Error('invalid');
  await dbAll(
    database,
    sql`INSERT INTO ${tables(database).accountSettings} (account_id, primary_currency, created_at, updated_at)
        VALUES (${accountId}, ${currency}, ${now}, ${now})
        ON CONFLICT (account_id) DO UPDATE SET primary_currency = ${currency}, updated_at = ${now}
        RETURNING account_id`,
  );
  return currency;
}
