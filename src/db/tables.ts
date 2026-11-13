import type { Database } from './client';
import * as postgresSchema from './schema/postgres';
import * as sqliteSchema from './schema/sqlite';

/**
 * The app's tables as the dialect of a handle has them, for raw SQL through `exec.ts` (`sql\`SELECT … FROM ${tables(db).person}\``): on PostgreSQL a
 * table is in the `tally` schema, on SQLite it is not, and this is the one place that knows.
 */
export function tables(database: Database) {
  return database.dialect === 'postgres' ? postgresSchema : sqliteSchema;
}
