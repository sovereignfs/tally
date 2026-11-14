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
export type MailTemplate = 'invitation' | 'notice' | 'core_notice' | 'core_activity';

export interface TemplateData {
  invitation: { inviterName: string; link: string; reminder?: string };
  notice: NoticeMailData;
  /** Core's bell (§14.5): the same as a notice's email, said as a notification. */
  core_notice: NoticeMailData;
  /** A line on the person's own activity page in core (§14.5): for whom, what, and where it points. */
  core_activity: { sub: string; summary: string; link?: string };
}

/** What of core the outbox sends through: `@sovereignfs/sdk`'s client as the app itself (`sv.app`), which holds no person's token. */
export interface CoreSender {
  notifications: {
    send(message: {
      to: string;
      title: string;
      body?: string;
      url?: string;
      category?: 'info';
      key?: string;
    }): Promise<unknown>;
  };
  email: {
    sendToUser(message: {
      to: string;
      subject: string;
      body: string;
      key?: string;
    }): Promise<unknown>;
  };
  activity: {
    log(entry: { to: string; summary: string; link?: string; key?: string }): Promise<unknown>;
  };
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
  message: {
    /** An account (its address, or its `sub` at core, read at sending), an address (a placeholder's), or core alone (whom the data names). */
    to: { accountId: string } | { address: string } | { core: true };
    template: T;
    data: TemplateData[T];
  },
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
  /** Tally's own mail, when it is set up. */
  mailer?: Mailer | undefined;
  /** Core, when this server signs people in through one (§14.5). */
  core?: CoreSender | undefined;
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
    const outcome = await deliver(deps, id, row);
    if (outcome.kind === 'sent') {
      await dbAll(
        deps.database,
        sql`UPDATE ${t.mailOutbox} SET sent_at = ${now} WHERE id = ${id} RETURNING id`,
      );
      sent++;
      continue;
    }
    const attempts = Number(row.attempts);
    if (outcome.kind === 'give_up' || attempts >= MAX_ATTEMPTS) {
      await dbAll(
        deps.database,
        sql`UPDATE ${t.mailOutbox} SET failure_kind = ${outcome.why.slice(0, 100)} WHERE id = ${id} RETURNING id`,
      );
      deps.log(`[tally] mail: ${id} not sent (${outcome.why})`);
      failed++;
      continue;
    }
    await dbAll(
      deps.database,
      sql`UPDATE ${t.mailOutbox} SET next_attempt_at = ${now + backoffMs(attempts)} WHERE id = ${id} RETURNING id`,
    );
    deps.log(`[tally] mail: ${id} attempt ${attempts} failed (${outcome.why})`);
  }
  // What was sent or given up a week ago goes, with its address.
  await dbAll(
    deps.database,
    sql`DELETE FROM ${t.mailOutbox} WHERE (sent_at IS NOT NULL OR failure_kind IS NOT NULL) AND created_at < ${now - KEEP_SENT_MS} RETURNING id`,
  );
  return { sent, failed };
}

type Outcome = { kind: 'sent' } | { kind: 'retry'; why: string } | { kind: 'give_up'; why: string };

/** A failure of a call to core: `NotSupportedError` (a core too old, or without mail) and a 403 (the scope not granted) are refusals; the rest pass. */
function coreRefused(error: unknown): boolean {
  const e = error as { name?: unknown; status?: unknown } | null;
  return e?.name === 'NotSupportedError' || (e?.name === 'CoreApiError' && e.status === 403);
}

/**
 * Sends one row, by its template, through the channel it is for (§12.3, §14.5). Never throws. A refusal by core (not supported, not granted) is not
 * retried; core's email falls back to Tally's own mail then, as it does for an account not linked to core. A placeholder is reached by Tally's mail only.
 * The row's id is the `key` of a send to core, so that a send repeated after a lost answer is one send.
 */
async function deliver(
  deps: MailDeps,
  id: string,
  row: { accountId: string | null; toAddress: string | null; template: string; data: string },
): Promise<Outcome> {
  let data: unknown;
  try {
    data = JSON.parse(row.data) as unknown;
  } catch {
    return { kind: 'give_up', why: 'unknown_template' };
  }
  const key = `tally:${id}`;
  const viaCore = async (call: () => Promise<unknown>): Promise<Outcome | 'refused'> => {
    try {
      await call();
      return { kind: 'sent' };
    } catch (error) {
      if (coreRefused(error)) return 'refused';
      return { kind: 'retry', why: kindOf(error) };
    }
  };
  const bySmtp = async (message: (to: string) => Message | undefined): Promise<Outcome> => {
    if (!deps.mailer) return { kind: 'give_up', why: 'no_channel' };
    const address =
      row.toAddress ??
      (row.accountId ? await addressOf(deps.authDatabase, row.accountId) : undefined);
    if (!address) return { kind: 'give_up', why: 'no_address' };
    const made = message(address);
    if (!made) return { kind: 'give_up', why: 'unknown_template' };
    try {
      await deps.mailer.send(made);
      return { kind: 'sent' };
    } catch (error) {
      return { kind: 'retry', why: kindOf(error) };
    }
  };
  const subOf = async () =>
    deps.core && row.accountId ? await coreSubOf(deps.database, row.accountId) : undefined;

  if (row.template === 'invitation')
    return bySmtp((to) => render(deps.app, to, row.template, data));
  if (row.template === 'notice') {
    const sub = await subOf();
    const core = deps.core;
    if (sub && core) {
      const message = render(deps.app, '', row.template, data);
      if (!message) return { kind: 'give_up', why: 'unknown_template' };
      const sent = await viaCore(() =>
        core.email.sendToUser({ to: sub, subject: message.subject, body: message.text, key }),
      );
      if (sent !== 'refused') return sent;
    }
    return bySmtp((to) => render(deps.app, to, row.template, data));
  }
  if (row.template === 'core_notice') {
    const named = (data as NoticeMailData | null)?.sub;
    const sub = typeof named === 'string' ? named : await subOf();
    const core = deps.core;
    if (!sub || !core) return { kind: 'give_up', why: 'no_channel' };
    const message = render(deps.app, '', 'notice', data);
    const d = data as NoticeMailData;
    if (!message) return { kind: 'give_up', why: 'unknown_template' };
    const sent = await viaCore(() =>
      core.notifications.send({
        to: sub,
        title: cut(message.subject, 120),
        url: d.link,
        category: 'info',
        key,
      }),
    );
    return sent === 'refused' ? { kind: 'give_up', why: 'not_permitted' } : sent;
  }
  if (row.template === 'core_activity') {
    const d = data as TemplateData['core_activity'];
    const core = deps.core;
    if (!core) return { kind: 'give_up', why: 'no_channel' };
    if (typeof d?.sub !== 'string' || typeof d.summary !== 'string')
      return { kind: 'give_up', why: 'unknown_template' };
    const sent = await viaCore(() =>
      core.activity.log({
        to: d.sub,
        summary: cut(d.summary, 200),
        ...(typeof d.link === 'string' ? { link: d.link } : {}),
        key,
      }),
    );
    return sent === 'refused' ? { kind: 'give_up', why: 'not_permitted' } : sent;
  }
  return { kind: 'give_up', why: 'unknown_template' };
}

const cut = (text: string, most: number): string =>
  text.length <= most ? text : `${text.slice(0, most - 1).trimEnd()}…`;

/** The `sub` at core of an account linked to it, from its person. */
async function coreSubOf(database: Database, accountId: string): Promise<string | undefined> {
  const row = await dbGet<{ coreSub: string | null }>(
    database,
    sql`SELECT core_sub AS "coreSub" FROM ${tables(database).person} WHERE account_id = ${accountId}`,
  );
  return row?.coreSub ?? undefined;
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
