import { createSovereign } from '@sovereignfs/sdk';
import { sql, type SQL } from 'drizzle-orm';
import { getConfig } from '../config/current';
import { getAuthDatabase, getDatabase } from '../db/boot';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { tables } from '../db/tables';
import { accountOfSub } from '../sovereign/identity';
import packageJson from '../../package.json';

type Value = string | number | boolean | null;
export type Record_ = Readonly<Record<string, Value>>;

/** One file of records in a person's export: its path in the archive, its kind, its lines, and whether they hold sealed text. */
export interface RecordsPart {
  readonly path: string;
  readonly kind: string;
  readonly records: readonly Record_[];
  readonly endToEnd: boolean;
}

/** What the server keeps for its own work, of no use outside it: the sync's counters and the key's bookkeeping. */
const INTERNAL = new Set(['seq', 'pruned_through', 'key_epoch', 'key_rotation_due']);

/** A time Tally keeps in milliseconds (a number, or a string on PostgreSQL), as the export format asks: ISO 8601 in UTC. */
function value(name: string, field: unknown): Value {
  if (field === null || field === undefined) return null;
  if (name.endsWith('_at') && (typeof field === 'number' || /^\d+$/.test(String(field))))
    return new Date(Number(field)).toISOString();
  if (typeof field === 'bigint') return Number(field);
  return field as Value;
}

/** Rows as records: the server's own columns left out, times in ISO 8601, everything else as stored (sealed text still sealed). */
export function toRecords(rows: readonly Record<string, unknown>[]): Record_[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row)
        .filter(([name]) => !INTERNAL.has(name))
        .map(([name, field]) => [name, value(name, field)]),
    ),
  );
}

const part = (kind: string, records: Record_[], endToEnd: boolean): RecordsPart => ({
  path: `apps/tally/records/${kind}.jsonl`,
  kind,
  records,
  endToEnd,
});

/**
 * **A person's part of core's export** (`contracts/export.md` §3), read on the server: their profile and settings, and every group they are a member of
 * with its members (by name only), expenses, payments and comments. What people wrote is sealed under each group's key, which the server cannot open
 * (DESIGN.md §5.3), so it is carried as stored and its files are marked end to end; the browser's own export (`collect.ts`) is the one that opens it.
 */
export async function personRecords(database: Database, accountId: string): Promise<RecordsPart[]> {
  const t = tables(database);
  const all = (query: SQL) => dbAll<Record<string, unknown>>(database, query);
  const [me] = await all(
    sql`SELECT id, name, email, created_at FROM ${t.person} WHERE account_id = ${accountId} AND deleted_at IS NULL`,
  );
  if (!me) return [];
  const personId = String(me.id);
  const groups = sql`(SELECT group_id FROM ${t.member} WHERE person_id = ${personId})`;
  const parts: RecordsPart[] = [
    part('person', toRecords([me]), false),
    part(
      'account_settings',
      toRecords(await all(sql`SELECT * FROM ${t.accountSettings} WHERE account_id = ${accountId}`)),
      false,
    ),
    part(
      'notice_pref',
      toRecords(
        await all(sql`SELECT kind, channel FROM ${t.noticePref} WHERE account_id = ${accountId}`),
      ),
      false,
    ),
    part(
      'grp',
      toRecords(
        await all(sql`SELECT * FROM ${t.grp} WHERE id IN ${groups} ORDER BY created_at, id`),
      ),
      true,
    ),
    part(
      'member',
      toRecords(
        await all(
          sql`SELECT m.id, m.group_id, m.person_id, p.name, m.role, m.joined_at, m.left_at
                FROM ${t.member} m JOIN ${t.person} p ON p.id = m.person_id
               WHERE m.group_id IN ${groups} ORDER BY m.group_id, m.joined_at, m.id`,
        ),
      ),
      false,
    ),
    part(
      'expense',
      toRecords(
        await all(
          sql`SELECT * FROM ${t.expense} WHERE group_id IN ${groups} ORDER BY group_id, date, id`,
        ),
      ),
      true,
    ),
    part(
      'expense_payer',
      toRecords(
        await all(
          sql`SELECT * FROM ${t.expensePayer} WHERE group_id IN ${groups} ORDER BY expense_id, member_id`,
        ),
      ),
      false,
    ),
    part(
      'expense_share',
      toRecords(
        await all(
          sql`SELECT * FROM ${t.expenseShare} WHERE group_id IN ${groups} ORDER BY expense_id, member_id`,
        ),
      ),
      false,
    ),
    part(
      'payment',
      toRecords(
        await all(
          sql`SELECT * FROM ${t.payment} WHERE group_id IN ${groups} ORDER BY group_id, date, id`,
        ),
      ),
      true,
    ),
    part(
      'comment',
      toRecords(
        await all(
          sql`SELECT * FROM ${t.comment} WHERE group_id IN ${groups} ORDER BY group_id, created_at, id`,
        ),
      ),
      true,
    ),
  ];
  return parts.filter((each) => each.records.length > 0);
}

/**
 * What the SDK remembers of a token it has seen, so that a replay is refused. Tally keeps its own sessions with better-auth, so this holds nothing else; it
 * is in memory, since an export asked for twice is the same export (sdk §9.1) and no harm comes of a second.
 */
const seen = new Map<string, { record: unknown; expiresAt: number }>();
const replays = {
  get: (id: string) => {
    const kept = seen.get(id);
    if (!kept || kept.expiresAt < Date.now()) return undefined;
    return kept.record as never;
  },
  set: (id: string, record: unknown, expiresAt: number) => void seen.set(id, { record, expiresAt }),
  delete: (id: string) => void seen.delete(id),
  deleteMatching: () => undefined,
};

/**
 * **Core's export of a person** (`signIn.export`, sdk §9.1): core asks for Tally's part with a signed token, and the SDK checks it (a replay refused),
 * answers at once with an export in the contract's format, and finishes it as the records are written. A person Tally does not know gets an empty part.
 * `undefined` where core is not set: the route is then not there.
 */
export async function answerCoreExport(request: Request): Promise<Response | undefined> {
  const config = getConfig();
  const core = config.auth?.sovereign;
  if (!core || !config.url) return undefined;
  const client = createSovereign({
    appUrl: config.url,
    coreUrl: new URL(core.issuer).origin,
    clientId: core.clientId,
    clientSecret: core.clientSecret,
    sessionStore: replays,
  });
  return client.auth.handleExportRequest(
    request,
    { prefix: 'tally', version: packageJson.version },
    async ({ sub, writer }) => {
      const accountId = await accountOfSub(await getAuthDatabase(), sub);
      if (!accountId) return;
      for (const each of await personRecords(await getDatabase(), accountId))
        await writer.addRecords(each.path, each.kind, [...each.records], {
          endToEnd: each.endToEnd,
        });
    },
  );
}
