import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { tables } from '../db/tables';
import { NOTICE_KINDS, type NoticeKind, isNoticeKind } from './kinds';

/**
 * **What a person hears, by kind and channel** (DESIGN.md §12.3). The bell in Tally always; beyond it, each kind by each channel, with the defaults of
 * §12.3: email on for being added to a group, a reminder and an invitation taken; core's bell on for every kind (used once core is connected, 11.1);
 * push reserved for phase 2 and not offered. Only a choice that differs from the default is stored (`notice_pref`). The choice for a group (§12.2,
 * `member.notify`) decides whether a notice is raised at all; this decides which channels carry it.
 */
export const CHANNELS = ['email', 'core_bell', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];
/** The channels a person can choose today. */
export const OFFERED_CHANNELS: readonly Channel[] = ['email'];

const EMAIL_BY_DEFAULT: ReadonlySet<NoticeKind> = new Set([
  'added_to_group',
  'reminder',
  'invite_accepted',
]);

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

export function defaultOn(kind: NoticeKind, channel: Channel): boolean {
  if (channel === 'email') return EMAIL_BY_DEFAULT.has(kind);
  if (channel === 'core_bell') return true;
  return false;
}

export type Prefs = Record<NoticeKind, Record<Channel, boolean>>;

/** Every kind by every channel, for an account: its choices over the defaults. */
export async function prefsOf(database: Database, accountId: string): Promise<Prefs> {
  const rows = await dbAll<{ kind: string; channel: string; enabled: number | boolean }>(
    database,
    sql`SELECT kind, channel, enabled FROM ${tables(database).noticePref} WHERE account_id = ${accountId}`,
  );
  const prefs = Object.fromEntries(
    NOTICE_KINDS.map((kind) => [
      kind,
      Object.fromEntries(CHANNELS.map((channel) => [channel, defaultOn(kind, channel)])),
    ]),
  ) as Prefs;
  for (const row of rows)
    if (isNoticeKind(row.kind) && isChannel(row.channel))
      prefs[row.kind][row.channel] = row.enabled === true || Number(row.enabled) === 1;
  return prefs;
}

/** Sets one choice. A choice equal to the default is kept as no row, so that the default stays the person's. */
export async function setPref(
  database: Database,
  accountId: string,
  kind: unknown,
  channel: unknown,
  enabled: unknown,
  now = Date.now(),
): Promise<void> {
  if (!isNoticeKind(kind) || !isChannel(channel) || typeof enabled !== 'boolean')
    throw new Error('invalid');
  if (!OFFERED_CHANNELS.includes(channel)) throw new Error('invalid');
  const t = tables(database);
  if (enabled === defaultOn(kind, channel)) {
    await dbAll(
      database,
      sql`DELETE FROM ${t.noticePref} WHERE account_id = ${accountId} AND kind = ${kind} AND channel = ${channel} RETURNING kind`,
    );
    return;
  }
  await dbAll(
    database,
    sql`INSERT INTO ${t.noticePref} (account_id, kind, channel, enabled, updated_at) VALUES (${accountId}, ${kind}, ${channel}, ${enabled}, ${now})
        ON CONFLICT (account_id, kind, channel) DO UPDATE SET enabled = ${enabled}, updated_at = ${now}
        RETURNING kind`,
  );
}
