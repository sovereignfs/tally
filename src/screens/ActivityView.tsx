'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, PageContainer, PageHeader, Select } from '@sovereignfs/ui';
import { describeActivity } from '../activity/describe';
import { useMemberNames, useOpenedLines } from '../activity/opened';
import { ACTIVITY_KINDS, type ActivityKind, type ActivityLine } from '../activity/kinds';
import { toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import { useMe, useStoreChanges } from '../sync/react';
import { goLocally, sheetHref } from './AddSheet';
import { GroupDot } from './Balance';
import { useGroupNames } from './hooks';
import { useGroupViews } from './useGroups';
import styles from './Screens.module.css';

/**
 * **Activity** (DESIGN.md §12.1, §15.8): what happened in the reader's groups, newest first, grouped by day, each line in words from the reader's point
 * of view (`describeActivity`), with the text it carries opened on the device; filters for group, person and kind in the address; a page at a time.
 * Read online (`GET /api/activity`); offline it says so. A group's Activity view is this with its group fixed.
 */
const KIND_WORDS: Partial<Record<ActivityKind, string>> = {
  expense_added: 'Expenses added',
  expense_edited: 'Expenses changed',
  expense_deleted: 'Expenses deleted',
  payment_added: 'Payments',
  comment_added: 'Comments',
  member_added: 'People added',
  member_left: 'People who left',
  group_renamed: 'Groups renamed',
};

export function ActivityList({ groupId }: { groupId?: string }) {
  const me = useMe();
  const views = useGroupViews();
  const params = useSearchParams();
  const pathname = usePathname();
  const names = useGroupNames(views?.map((v) => v.group) ?? []);
  const group = groupId ?? params.get('group') ?? '';
  const person = params.get('person') ?? '';
  const kind = params.get('kind') ?? '';
  // After the device syncs (what it recorded is now on the server too), the activity is read again.
  const changes = useStoreChanges();
  const [lines, setLines] = useState<ActivityLine[] | 'offline' | null>(null);
  const [next, setNext] = useState<string | null>(null);

  const query = (before?: string) => {
    const q = new URLSearchParams();
    if (group) q.set('group', group);
    if (person) q.set('person', person);
    if (kind) q.set('kind', kind);
    if (before) q.set('before', before);
    return `/api/activity?${q.toString()}`;
  };

  useEffect(() => {
    let live = true;
    void fetch(query(), { cache: 'no-store' })
      .then(async (reply) =>
        reply.ok
          ? ((await reply.json()) as { lines: ActivityLine[]; next: string | null })
          : 'offline',
      )
      .catch(() => 'offline' as const)
      .then((answer) => {
        if (!live) return;
        if (answer === 'offline') return setLines('offline');
        setLines(answer.lines);
        setNext(answer.next);
      });
    return () => {
      live = false;
    };
    // The query is the filters; a store change is a sync that may have sent something.
  }, [group, person, kind, changes]);

  // The text the lines carry, opened on the device with each group's key, and the members they name.
  const opened = useOpenedLines(Array.isArray(lines) ? lines : null);
  const members = useMemberNames();

  const set = (changes: Record<string, string | null>) =>
    goLocally(sheetHref(pathname, new URLSearchParams(window.location.search), changes), 'replace');

  async function more() {
    if (!next || !Array.isArray(lines)) return;
    const reply = await fetch(query(next), { cache: 'no-store' }).catch(() => null);
    if (!reply?.ok) return;
    const answer = (await reply.json()) as { lines: ActivityLine[]; next: string | null };
    setLines([...lines, ...answer.lines]);
    setNext(answer.next);
  }

  const days = useMemo(() => {
    const out: { day: string; lines: ActivityLine[] }[] = [];
    for (const line of Array.isArray(lines) ? lines : []) {
      const day = new Date(line.createdAt).toDateString();
      const last = out[out.length - 1];
      if (last?.day === day) last.lines.push(line);
      else out.push({ day, lines: [line] });
    }
    return out;
  }, [lines]);

  const words = (line: ActivityLine) =>
    describeActivity(line, {
      readerPersonId: me?.personId ?? '',
      personOfMember: (memberId) => members.byMember.get(memberId),
      nameOf: (personId) => members.byPerson.get(personId),
      opened: (sealed) => opened.get(sealed),
      money: (amount, currency) => formatMoney(toMinor(amount), currency),
    });

  const people = [...members.byPerson].sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <section className={styles.stack} aria-label="Activity">
      <div className={styles.row}>
        {groupId ? null : (
          <Select
            aria-label="Group"
            value={group}
            onChange={(event) => set({ group: event.target.value || null })}
          >
            <option value="">Every group</option>
            {(views ?? []).map((v) => (
              <option key={v.group.id} value={v.group.id}>
                {names[v.group.id] ?? '…'}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label="Person"
          value={person}
          onChange={(event) => set({ person: event.target.value || null })}
        >
          <option value="">Everyone</option>
          {people.map(([id, name]) => (
            <option key={id} value={id}>
              {id === me?.personId ? 'You' : name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Kind"
          value={kind}
          onChange={(event) => set({ kind: event.target.value || null })}
        >
          <option value="">Everything</option>
          {ACTIVITY_KINDS.filter((k) => KIND_WORDS[k]).map((k) => (
            <option key={k} value={k}>
              {KIND_WORDS[k]}
            </option>
          ))}
        </Select>
      </div>
      {lines === 'offline' ? (
        <p className={styles.muted}>
          Activity needs a connection. Your groups and their expenses are here offline.
        </p>
      ) : lines === null ? null : lines.length === 0 ? (
        <EmptyState
          icon="activity"
          heading="Nothing yet"
          description="What happens in your groups shows here."
        />
      ) : (
        days.map(({ day, lines: inDay }) => (
          <section key={day} aria-label={day}>
            <h2 className={styles.small}>{day}</h2>
            <ul className={styles.list} aria-label={`Activity on ${day}`}>
              {inDay.map((line) => {
                const view = views?.find((v) => v.group.id === line.groupId);
                return (
                  <li key={line.id} className={styles.line}>
                    {view && !groupId ? <GroupDot color={view.group.color} /> : null}
                    <span className={styles.lineMain}>
                      <span>{words(line)}</span>
                      {groupId ? null : (
                        <span className={styles.small}>{names[line.groupId] ?? '…'}</span>
                      )}
                    </span>
                    <span className={`${styles.lineEnd} ${styles.small}`}>
                      {new Date(line.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {next && Array.isArray(lines) ? (
        <div>
          <Button variant="secondary" onClick={() => void more()}>
            Show earlier
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function ActivityPage() {
  return (
    <PageContainer>
      <PageHeader title="Activity" description="What happened in your groups." />
      <ActivityList />
    </PageContainer>
  );
}
