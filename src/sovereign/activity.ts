import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbGet } from '../db/exec';
import { tables } from '../db/tables';
import { enqueueMail } from '../mail/outbox';
import { coreOn, noticeMail } from '../notices/mail';

/**
 * **A line on the person's own activity page in core** (DESIGN.md §14.5): what Tally did for them (an export, an import), sent by the outbox after
 * this, for someone linked to core where core is set. Nothing of what was in it, and nothing anywhere else.
 */
export async function noteOnCore(
  database: Database,
  personId: string,
  summary: string,
  now = Date.now(),
) {
  if (!coreOn(noticeMail())) return;
  const person = await dbGet<{ coreSub: string | null }>(
    database,
    sql`SELECT core_sub AS "coreSub" FROM ${tables(database).person} WHERE id = ${personId}`,
  );
  if (!person?.coreSub) return;
  await enqueueMail(
    database,
    { to: { core: true }, template: 'core_activity', data: { sub: person.coreSub, summary } },
    now,
  );
}
