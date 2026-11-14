import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { tables } from '../db/tables';
import { claim } from '../jobs/claim';
import { kindOf } from '../jobs/runner';
import type { JobDefinition } from '../jobs/runner';
import type { Mailer, Message } from './mailer';
import { formatMoney } from '../money/text';
import { toMinor } from '../money/amount';
import { type NoticeMailData, invitationMessage, noticeMessage, noticeSentence } from './templates';

/**
 * **The mail outbox** (DESIGN.md §12.3): mail is written in the transaction of the change that causes it (`enqueueMail`), and sent in the background by
 * the mail job (`sendDue`), which claims each due row with a conditional update, renders it, sends it through Tally's SMTP and retries with backoff up to
 * a limit, recording only a kind of failure. **With no SMTP set, nothing is written:** the caller is told mail is off (`mailOn`) and says so on the screen
 * rather than pretending an email went. **Nothing about a message is logged but its id and a kind of failure;** no address and no content.
 *
 * Templates take ids, names and links, never sealed text: no group's name, description or comment ever reaches a mail (§5.3).
 */
export type MailTemplate = 'invitation' | 'notice';

export interface TemplateData {
  invitation: { inviterName: string; link: string; reminder?: string };
  notice: NoticeMailData;
}

/** Attempts before a message is marked failed, and the backoff between them: a minute, then four, sixteen, about an hour, about four. */
export const MAX_ATTEMPTS = 5;
const backoffMs = (attempts: number) => 60_000 * 4 ** Math.max(0, attempts - 1);
/** While one process sends a row, no other may claim it for this long. */
const LEASE_MS = 5 * 60_000;
/** Sent and failed rows, with their addresses, go after this. */
export const KEEP_SENT_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 20;

/** Whether this server sends mail at all. */
export const mailOn = (mailer: Mailer | undefined): mailer is Mailer => mailer !== undefined;

/** Writes a message to the outbox, in the caller's transaction. Only called when mail is on. */
export async function enqueueMail<T extends MailTemplate>(
  tx: Database,
  message: { to: { accountId: string } | { address: string }; template: T; data: TemplateData[T] },
  now: number,
): Promise<void> {
  const t = tables(tx);
  const accountId = 'accountId' in message.to ? message.to.accountId : null;
  const toAddress = 'address' in message.to ? message.to.address : null;
  await dbAll(
    tx,
    sql`INSERT INTO ${t.mailOutbox} (id, account_id, to_address, template, data, attempts, next_attempt_at, sent_at, failure_kind, created_at)
        VALUES (${crypto.randomUUID()}, ${accountId}, ${toAddress}, ${message.template}, ${JSON.stringify(message.data)}, 0, ${now}, NULL, NULL, ${now})
        RETURNING id`,
  );
}

export interface MailDeps {
  database: Database;
  /** The sign-in store, where an account's address is read at sending. */
  authDatabase: Database;
  mailer: Mailer;
  app: string;
  log: (line: string) => void;
}

function render(app: string, to: string, template: string, data: unknown): Message | undefined {
  if (template === 'invitation') {
    const d = data as TemplateData['invitation'];
    if (typeof d?.inviterName !== 'string' || typeof d.link !== 'string') return undefined;
    return invitationMessage(
      app,
      to,
      d.inviterName,
      d.link,
      typeof d.reminder === 'string' ? d.reminder : undefined,
    );
  }
  if (template === 'notice') {
    const d = data as NoticeMailData;
    if (
      typeof d?.kind !== 'string' ||
      typeof d.link !== 'string' ||
      typeof d.settingsLink !== 'string'
    )
      return undefined;
    const money =
      typeof d.amount === 'number' && typeof d.currency === 'string'
        ? formatMoney(toMinor(d.amount), d.currency, 'en')
        : null;
    const sentence = noticeSentence(app, d, money);
    return sentence ? noticeMessage(app, to, sentence, d) : undefined;
  }
  return undefined;
}

/** Sends what is due, each row claimed first so that two processes never send one twice. Returns how many were sent. */
export async function sendDue(
  deps: MailDeps,
  now: number,
): Promise<{ sent: number; failed: number }> {
  const t = tables(deps.database);
  const due = await dbAll<{ id: string }>(
    deps.database,
    sql`SELECT id FROM ${t.mailOutbox} WHERE sent_at IS NULL AND failure_kind IS NULL AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at, id LIMIT ${BATCH}`,
  );
  let sent = 0;
  let failed = 0;
  for (const { id } of due) {
    // The claim: an attempt counted and the row leased, only while it is still due and unsent.
    const won = await claim(
      deps.database,
      sql`UPDATE ${t.mailOutbox} SET attempts = attempts + 1, next_attempt_at = ${now + LEASE_MS}
          WHERE id = ${id} AND sent_at IS NULL AND failure_kind IS NULL AND next_attempt_at <= ${now} RETURNING id`,
    );
    if (!won) continue;
    const row = await dbGet<{
      accountId: string | null;
      toAddress: string | null;
      template: string;
      data: string;
      attempts: number;
    }>(
      deps.database,
      sql`SELECT account_id AS "accountId", to_address AS "toAddress", template, data, attempts FROM ${t.mailOutbox} WHERE id = ${id}`,
    );
    if (!row) continue;
    const address =
      row.toAddress ??
      (row.accountId ? await addressOf(deps.authDatabase, row.accountId) : undefined);
    let message: Message | undefined;
    try {
      message = address
        ? render(deps.app, address, row.template, JSON.parse(row.data) as unknown)
        : undefined;
    } catch {
      message = undefined;
    }
    if (!message) {
      // Nobody to send it to (an account deleted since), or not a message this version knows: given up at once.
      await dbAll(
        deps.database,
        sql`UPDATE ${t.mailOutbox} SET failure_kind = ${address ? 'unknown_template' : 'no_address'} WHERE id = ${id} RETURNING id`,
      );
      deps.log(`[tally] mail: ${id} not sent (${address ? 'unknown_template' : 'no_address'})`);
      failed++;
      continue;
    }
    try {
      await deps.mailer.send(message);
      await dbAll(
        deps.database,
        sql`UPDATE ${t.mailOutbox} SET sent_at = ${now} WHERE id = ${id} RETURNING id`,
      );
      sent++;
    } catch (error) {
      const attempts = Number(row.attempts);
      const kind = kindOf(error);
      if (attempts >= MAX_ATTEMPTS) {
        await dbAll(
          deps.database,
          sql`UPDATE ${t.mailOutbox} SET failure_kind = ${kind.slice(0, 100)} WHERE id = ${id} RETURNING id`,
        );
        failed++;
      } else {
        await dbAll(
          deps.database,
          sql`UPDATE ${t.mailOutbox} SET next_attempt_at = ${now + backoffMs(attempts)} WHERE id = ${id} RETURNING id`,
        );
      }
      deps.log(`[tally] mail: ${id} attempt ${attempts} failed (${kind})`);
    }
  }
  // What was sent or given up a week ago goes, with its address.
  await dbAll(
    deps.database,
    sql`DELETE FROM ${t.mailOutbox} WHERE (sent_at IS NOT NULL OR failure_kind IS NOT NULL) AND created_at < ${now - KEEP_SENT_MS} RETURNING id`,
  );
  return { sent, failed };
}

async function addressOf(authDatabase: Database, accountId: string): Promise<string | undefined> {
  const auth = authDatabase.dialect === 'postgres' ? postgresSchema : sqliteSchema;
  const row = await dbGet<{ email: string }>(
    authDatabase,
    sql`SELECT email FROM ${auth.user} WHERE id = ${accountId}`,
  );
  return row?.email;
}

/** The job: every minute, and once at start. */
export function mailJob(depsOf: () => Promise<MailDeps | undefined>): JobDefinition {
  return {
    name: 'send-mail',
    everyMs: 60_000,
    runAtStart: true,
    async run({ now }) {
      const deps = await depsOf();
      if (deps) await sendDue(deps, now.getTime());
    },
  };
}
