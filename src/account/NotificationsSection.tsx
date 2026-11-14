'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Toggle } from '@sovereignfs/ui';
import { NOTICE_KINDS, type NoticeKind } from '../notices/kinds';
import { useGroupNames } from '../screens/hooks';
import { useGroupViews } from '../screens/useGroups';
import styles from './Account.module.css';

/**
 * Settings, Notifications (DESIGN.md §12.3, §16): the bell always; email by kind, and Sovereign's bell by kind for an account linked to a core
 * (§14.5), as the person chooses, with what is not available said plainly (no mail set up here, no Sovereign instance connected, not linked); and
 * each group's own choice of what is heard of it, linked. Each switch is saved at once.
 */
const WORDS: Record<NoticeKind, string> = {
  added_to_group: 'Someone adds you to a group',
  expense_added: 'An expense is added',
  expense_changed: 'An expense is changed, deleted or restored',
  payment_recorded: 'A payment is recorded',
  comment: 'Someone comments',
  group_closed: 'A group is closed or reopened',
  reminder: 'Someone reminds you of what you owe',
  invite_accepted: 'Someone takes your invitation',
  edit_replaced: 'Someone’s change takes the place of yours',
  owner_passed: 'A group is passed to you',
};

export function NotificationsSection({
  email: initial,
  bell: initialBell,
  mailOn,
  core,
}: {
  email: Record<NoticeKind, boolean>;
  bell: Record<NoticeKind, boolean>;
  mailOn: boolean;
  /** Where a core is set up: whether this account is linked to it. Null where there is none. */
  core: { linked: boolean } | null;
}) {
  const [email, setEmail] = useState(initial);
  const [bell, setBell] = useState(initialBell);
  const [problem, setProblem] = useState<string | null>(null);
  const views = useGroupViews();
  const names = useGroupNames(views?.map((v) => v.group) ?? []);

  async function choose(kind: NoticeKind, channel: 'email' | 'core_bell', enabled: boolean) {
    const set = channel === 'email' ? setEmail : setBell;
    const before = (channel === 'email' ? email : bell)[kind];
    set((now) => ({ ...now, [kind]: enabled }));
    setProblem(null);
    const reply = await fetch('/api/account/notifications', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, channel, enabled }),
    }).catch(() => null);
    if (!reply?.ok) {
      set((now) => ({ ...now, [kind]: before }));
      setProblem('That was not saved. It needs a connection.');
    }
  }
  const coreBell = core?.linked === true;

  return (
    <div className={styles.group}>
      <h2>Notifications</h2>
      <p>
        Everything you are told shows in the bell. Email carries who and how much, and a link: what
        was written in a group stays private to it, so it is never in an email.
      </p>
      {mailOn ? null : (
        <p className={styles.hint}>
          Mail is not set up on this server, so the bell is the only way you are told.
        </p>
      )}
      {core === null ? (
        <p className={styles.hint}>
          This Tally is not connected to a Sovereign instance, so nothing goes to its bell.
        </p>
      ) : core.linked ? (
        <p className={styles.hint}>
          Your Sovereign account is linked: what you choose below also reaches Sovereign’s bell, and
          email goes through Sovereign.
        </p>
      ) : (
        <p className={styles.hint}>
          Link Sovereign in Security to be told in Sovereign’s bell as well.
        </p>
      )}
      {problem ? <Alert variant="error">{problem}</Alert> : null}
      <ul className={styles.list} aria-label="Email me when">
        {NOTICE_KINDS.map((kind) => (
          <li key={kind} className={styles.row}>
            <Toggle
              aria-label={`Email: ${WORDS[kind]}`}
              checked={email[kind]}
              disabled={!mailOn}
              onChange={(on) => void choose(kind, 'email', on)}
            />
            {coreBell ? (
              <Toggle
                aria-label={`Sovereign’s bell: ${WORDS[kind]}`}
                checked={bell[kind]}
                onChange={(on) => void choose(kind, 'core_bell', on)}
              />
            ) : null}
            <span>{WORDS[kind]}</span>
          </li>
        ))}
      </ul>
      <h2>Each group</h2>
      <p className={styles.hint}>
        In each group you choose to hear of everything, only what involves you, or nothing.
      </p>
      {views && views.length > 0 ? (
        <ul className={styles.list} aria-label="Each group’s notifications">
          {views.map((v) => (
            <li key={v.group.id}>
              <Link href={`/g/${v.group.id}/settings`}>{names[v.group.id] ?? 'A group'}</Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
