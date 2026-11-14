'use client';

import { useEffect, useState } from 'react';
import { Button } from '@sovereignfs/ui';
import { nextReminderAt, waitWords } from '../groups/reminder-time';
import { useMe, useSync } from '../sync/react';
import type { PersonView } from './data';
import styles from './Screens.module.css';

/**
 * **Remind** (DESIGN.md §12.4), beside someone who owes the reader: in each group named, `member.remind`, which the server decides (it derives the debt
 * again and holds once a day). Once used it is disabled with the wait until tomorrow, remembered on this device; what the server says, a refusal
 * included ("Invite Sam to remind them"), is said beside it. Online only, as every operation (§11.6); the device syncs first, so that the server has
 * the expense the button was shown for.
 */
const key = (accountId: string, groupId: string, memberId: string) =>
  `tally.reminded.${accountId}.${groupId}.${memberId}`;

function remembered(accountId: string, groupId: string, memberId: string): number {
  try {
    const value = Number(localStorage.getItem(key(accountId, groupId, memberId)));
    return Number.isSafeInteger(value) ? value : 0;
  } catch {
    return 0;
  }
}

function remember(accountId: string, groupId: string, memberId: string, until: number) {
  try {
    localStorage.setItem(key(accountId, groupId, memberId), String(until));
  } catch {
    // A convenience only: the server holds the rule.
  }
}

export function RemindButton({
  name,
  targets,
}: {
  name: string;
  targets: readonly { groupId: string; memberId: string }[];
}) {
  const me = useMe();
  const client = useSync();
  const accountId = me?.accountId ?? '';
  const [until, setUntil] = useState(0);
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const targetsKey = targets.map((t) => `${t.groupId}:${t.memberId}`).join(',');
  useEffect(() => {
    if (!accountId || !targetsKey) return;
    setUntil(
      Math.min(
        ...targetsKey.split(',').map((pair) => {
          const [groupId = '', memberId = ''] = pair.split(':');
          return remembered(accountId, groupId, memberId);
        }),
      ),
    );
  }, [accountId, targetsKey]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  if (targets.length === 0) return null;
  const used = until > now;

  async function remind() {
    setSending(true);
    setSaid(null);
    // What this device recorded goes first: the server decides from its own rows, and the debt the button showed may be in an expense not yet sent.
    let outcome = await client?.sync().catch(() => undefined);
    if (outcome?.status === 'rate-limited' && outcome.retryAfterMs <= 10_000) {
      const wait = outcome.retryAfterMs;
      await new Promise((resolve) => setTimeout(resolve, wait));
      outcome = await client?.sync().catch(() => undefined);
    }
    if (client && outcome?.status !== 'synced') {
      setSaid(
        'Your latest changes have not reached Tally yet, so nobody was reminded. Try again in a moment.',
      );
      setSending(false);
      return;
    }
    const answers: string[] = [];
    let any = false;
    for (const target of targets) {
      const reply = await fetch('/api/ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'member.remind', ...target }),
      }).catch(() => null);
      if (!reply) {
        answers.push('Reminding needs a connection.');
        break;
      }
      const body = (await reply.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
      };
      if (reply.ok || body.code === 'already_reminded') {
        remember(accountId, target.groupId, target.memberId, nextReminderAt(Date.now()));
        any = any || reply.ok;
      }
      if (!reply.ok) answers.push(body.message ?? `${name} could not be reminded.`);
    }
    if (answers.length === 0 || any)
      setUntil(Math.min(...targets.map((t) => remembered(accountId, t.groupId, t.memberId))));
    setSaid(answers.length === 0 ? `${name} is reminded.` : [...new Set(answers)].join(' '));
    setSending(false);
  }

  return (
    <span className={styles.row}>
      <Button
        variant="ghost"
        size="sm"
        disabled={used || sending}
        aria-label={used ? `Reminded ${name}: again ${waitWords(now)}` : `Remind ${name}`}
        onClick={() => void remind()}
      >
        {used ? `Reminded · again ${waitWords(now)}` : 'Remind'}
      </Button>
      {said ? (
        <span role="status" className={styles.small}>
          {said}
        </span>
      ) : null}
    </span>
  );
}

/** The open groups where, by each group's setting, this person owes the reader: where Remind can go. */
export function owingGroups(person: PersonView): { groupId: string; memberId: string }[] {
  return person.groups
    .filter(
      (g) =>
        g.view.group.closedAt === null &&
        g.view.suggestions.some((d) => d.fromId === g.them && d.toId === g.me),
    )
    .map((g) => ({ groupId: g.view.group.id, memberId: g.them }));
}
