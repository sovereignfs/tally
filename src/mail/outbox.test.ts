import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { type Database, openDatabase } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import type { Mailer } from './mailer';
import { MAX_ATTEMPTS, type MailDeps, enqueueMail, sendDue } from './outbox';
import { smtpMailer } from './smtp';
import { SmtpSink } from './testing/smtp-sink';

/**
 * The mail outbox (DESIGN.md §12.3) on each database, against a fake SMTP server: a message written in a transaction is sent once, even by two
 * processes at once; a failing server is retried with backoff and then the message marked failed; no address appears in any log line.
 */
const { leg, config } = testTarget();

describe(`the mail outbox (${leg})`, () => {
  let t: TwoAccounts;
  let second: Database;
  let sink: SmtpSink;
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const deps = (database: Database, mailer: Mailer): MailDeps => ({
    database,
    authDatabase: t.auth.database,
    mailer,
    app: 'Tally',
    log,
  });

  beforeAll(async () => {
    t = await twoAccounts();
    second = await openDatabase(config);
    sink = await SmtpSink.start();
  });
  afterAll(async () => {
    await sink.stop();
    await second.close();
    await t.close();
  });

  const smtp = () =>
    smtpMailer({
      host: '127.0.0.1',
      port: sink.port,
      secure: false,
      user: undefined,
      password: undefined,
      from: 'Tally <tally@example.com>',
    });
  const rowOf = (id: string) =>
    dbGet<{ attempts: number; sentAt: number | null; failureKind: string | null }>(
      t.database,
      sql`SELECT attempts, sent_at AS "sentAt", failure_kind AS "failureKind" FROM ${tables(t.database).mailOutbox} WHERE id = ${id}`,
    );
  const lastId = async () =>
    (
      await dbGet<{ id: string }>(
        t.database,
        sql`SELECT id FROM ${tables(t.database).mailOutbox} ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
    )?.id ?? '';

  it('sends a message once, to an address or to an account, even from two processes at once', async () => {
    const now = 1_000_000;
    await transaction(t.database, async (tx) => {
      await enqueueMail(
        tx,
        {
          to: { address: 'sam@example.com' },
          template: 'invitation',
          data: { inviterName: 'Ada', link: 'https://tally.test/invite/abc' },
        },
        now,
      );
      await enqueueMail(
        tx,
        {
          to: { accountId: t.grace.id },
          template: 'invitation',
          data: { inviterName: 'Ada', link: 'https://tally.test/invite/def' },
        },
        now,
      );
    });
    const results = await Promise.all([
      sendDue(deps(t.database, smtp()), now),
      sendDue(deps(second, smtp()), now),
    ]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(2);
    expect(sink.received.map((m) => m.to[0]).sort()).toEqual([
      'grace@example.com',
      'sam@example.com',
    ]);
    const sam = sink.received.find((m) => m.to[0] === 'sam@example.com');
    expect(sam?.data).toContain('Subject: Ada added you to a group on Tally');
    // Nothing more to send.
    expect(await sendDue(deps(t.database, smtp()), now + 60_000)).toEqual({ sent: 0, failed: 0 });
  });

  it('retries a failing server with backoff, then marks the message failed, logging only its id and a kind', async () => {
    const failing: Mailer = {
      send: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED to sam@example.com'), {
          code: 'ECONNREFUSED',
        });
      },
    };
    let now = 2_000_000;
    await transaction(t.database, (tx) =>
      enqueueMail(
        tx,
        {
          to: { address: 'lee@example.com' },
          template: 'invitation',
          data: { inviterName: 'Ada', link: 'https://tally.test/invite/ghi' },
        },
        now,
      ),
    );
    const id = await lastId();
    await sendDue(deps(t.database, failing), now);
    expect(await rowOf(id)).toMatchObject({ attempts: 1, sentAt: null, failureKind: null });
    // Not again before its time.
    await sendDue(deps(t.database, failing), now + 30_000);
    expect((await rowOf(id))?.attempts).toBe(1);
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      now += 6 * 60 * 60 * 1000;
      await sendDue(deps(t.database, failing), now);
    }
    expect(await rowOf(id)).toMatchObject({
      attempts: MAX_ATTEMPTS,
      sentAt: null,
      failureKind: 'Error ECONNREFUSED',
    });
    // Given up: no more attempts.
    await sendDue(deps(t.database, failing), now + 6 * 60 * 60 * 1000);
    expect((await rowOf(id))?.attempts).toBe(MAX_ATTEMPTS);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line, line).not.toMatch(/@|invite\//);
  });

  it('gives up at once on a message to an account that no longer has an address, and forgets sent mail after a week', async () => {
    const now = 3_000_000;
    await transaction(t.database, (tx) =>
      enqueueMail(
        tx,
        {
          to: { accountId: 'gone-account' },
          template: 'invitation',
          data: { inviterName: 'Ada', link: 'https://tally.test/x' },
        },
        now,
      ),
    );
    const id = await lastId();
    await sendDue(deps(t.database, smtp()), now);
    expect((await rowOf(id))?.failureKind).toBe('no_address');
    await sendDue(deps(t.database, smtp()), now + 8 * 24 * 60 * 60 * 1000);
    expect(
      await dbAll(
        t.database,
        sql`SELECT id FROM ${tables(t.database).mailOutbox} WHERE created_at <= ${now}`,
      ),
    ).toEqual([]);
  });
});
