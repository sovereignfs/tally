'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  ButtonLink,
  EmptyState,
  FormField,
  Icon,
  PageContainer,
  Textarea,
} from '@sovereignfs/ui';
import {
  type Category,
  addComment,
  deleteComment,
  deleteExpense,
  deletePayment,
  editExpense,
  editPayment,
  restoreExpense,
  restorePayment,
} from '../actions';
import { checkCommentText, refusalSentence } from '../actions/validate';
import type { LocalComment } from '../local/db';
import { LocalRefusal } from '../local/store';
import { toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import { useGroupKeys, useLocal, useMe, useSync } from '../sync/react';
import { LocalLink, sheetHref } from './AddSheet';
import { CATEGORY_VIEW } from './categories';
import { readGroupView } from './data';
import { useGroupNames, useOpened } from './hooks';
import styles from './Screens.module.css';

/**
 * **An expense's page, or a payment's** (DESIGN.md §15.6): the figures, who paid and each member's share; Comments from the device, with a field to add
 * one (offline too); History read from the server (online, §11.6) in words, with a replaced version's **Restore this version**; Edit (the add sheet
 * filled in), Delete and Restore. Every write goes through the device.
 */
type Kind = 'expense' | 'payment';
interface HistoryEntry {
  version: number;
  kind: 'created' | 'edited' | 'deleted' | 'restored' | 'replaced';
  actorPersonId: string | null;
  createdAt: number;
  snapshot: Record<string, unknown>;
}

const METHOD_WORDS: Record<string, string> = {
  equal: 'equally',
  amounts: 'by amounts',
  percentages: 'by percentages',
  shares: 'by shares',
};

export function RecordScreen({ groupId, kind, id }: { groupId: string; kind: Kind; id: string }) {
  const me = useMe();
  const client = useSync();
  const keys = useGroupKeys();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = useLocal(
    (db) => readGroupView(db, groupId, me?.personId ?? ''),
    [groupId, me?.personId],
  );
  const comments = useLocal((db) => db.getAllFromIndex('comment', 'bySubject', id), [id]);
  const names = useGroupNames(view ? [view.group] : []);
  const expense = kind === 'expense' ? view?.expenses.find((e) => e.id === id) : undefined;
  const payment = kind === 'payment' ? view?.payments.find((p) => p.id === id) : undefined;
  const record = expense ?? payment;
  const [opened] = useOpened(
    record?.sealed
      ? [{ sealed: record.sealed, binding: { group: groupId, table: kind, row: id } }]
      : [],
  );
  const visible = (comments ?? [])
    .filter((c) => c.deletedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt);
  const bodies = useOpened(
    visible.map((c) => ({
      sealed: c.sealed,
      binding: { group: groupId, table: 'comment' as const, row: c.id },
    })),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [history, setHistory] = useState<HistoryEntry[] | 'offline' | null>(null);

  // History is read from the server, and again after each change of the row.
  useEffect(() => {
    let live = true;
    void fetch(`/api/history?group=${groupId}&subject=${kind}&id=${id}`, { cache: 'no-store' })
      .then(async (reply) =>
        reply.ok ? ((await reply.json()) as { entries: HistoryEntry[] }).entries : 'offline',
      )
      .catch(() => 'offline' as const)
      .then((entries) => live && setHistory(entries));
    return () => {
      live = false;
    };
  }, [groupId, kind, id, record?.version, record?.seq]);

  if (view === undefined) return null;
  if (!view || !view.me || !record)
    return (
      <PageContainer>
        <EmptyState
          icon="file-text"
          heading="This is not here"
          description="It may be in a group you are not in, or not on this device yet."
        />
      </PageContainer>
    );

  const closed = view.group.closedAt !== null;
  const nameOf = (memberId: string) =>
    memberId === view.me?.id
      ? 'You'
      : (view.members.find((m) => m.id === memberId)?.name ?? 'Someone');
  const personName = (personId: string | null) =>
    personId === me?.personId
      ? 'You'
      : (view.members.find((m) => m.personId === personId)?.name ?? 'Someone');
  const description = typeof opened?.description === 'string' ? opened.description : undefined;
  const note = typeof opened?.note === 'string' ? opened.note : undefined;
  const title = expense
    ? (description ?? '…')
    : `${nameOf(payment?.fromMemberId ?? '')} paid ${nameOf(payment?.toMemberId ?? '').replace(/^You$/, 'you')}`;

  async function write(mutation: unknown) {
    setProblem(null);
    try {
      await client?.commit(mutation);
    } catch (error) {
      if (error instanceof LocalRefusal)
        return setProblem(
          refusalSentence(error.refusal, {
            ...(names[groupId] ? { group: names[groupId] as string } : {}),
            member: nameOf,
          }),
        );
      throw error;
    }
  }
  const ids = () => ({ mutationId: crypto.randomUUID(), groupId });
  const current = { id, version: record.version };

  async function comment() {
    const text = checkCommentText({ body });
    if (!text.ok) return setProblem(refusalSentence(text.refusal));
    const commentId = crypto.randomUUID();
    const sealed = await keys?.sealText(
      { body: text.value.body },
      { group: groupId, table: 'comment', row: commentId },
      view?.group.keyEpoch ?? 1,
    );
    if (!sealed) return setProblem('This group is not unlocked on this device yet.');
    await write(addComment({ ...ids(), commentId, subject: kind, subjectId: id, sealed }));
    setBody('');
  }

  /** A replaced version made current again: an edit with that version's row (§8.5). */
  async function restoreVersion(entry: HistoryEntry) {
    const snap = entry.snapshot;
    if (kind === 'expense')
      await write(
        editExpense({
          ...ids(),
          current,
          row: {
            sealed: String(snap.sealed),
            amount: toMinor(Number(snap.amount)),
            currency: String(snap.currency),
            date: String(snap.date),
            category: String(snap.category) as Category,
            method: String(snap.method) as 'equal',
            payers: (snap.payers as { memberId: string; amount: number }[]).map((p) => ({
              memberId: p.memberId,
              amount: toMinor(p.amount),
            })),
            shares: (
              snap.shares as { memberId: string; amount: number; units: number | null }[]
            ).map((s) => ({
              memberId: s.memberId,
              amount: toMinor(s.amount),
              units: s.units,
            })),
          },
        }),
      );
    else
      await write(
        editPayment({
          ...ids(),
          current,
          row: {
            sealed: snap.sealed === null || snap.sealed === undefined ? null : String(snap.sealed),
            fromMemberId: String(snap.fromMemberId),
            toMemberId: String(snap.toMemberId),
            amount: toMinor(Number(snap.amount)),
            currency: String(snap.currency),
            date: String(snap.date),
          },
        }),
      );
  }

  const editHref = sheetHref(
    pathname,
    new URLSearchParams(params.toString()),
    kind === 'expense'
      ? { add: 'expense', g: groupId, e: id }
      : { add: 'payment', g: groupId, p: id },
  );

  return (
    <PageContainer>
      <article className={styles.stack} aria-label={kind === 'expense' ? 'Expense' : 'Payment'}>
        <Link href={`/g/${groupId}`} className={styles.small}>
          ← {names[groupId] ?? 'Back to the group'}
        </Link>
        <h1 style={{ margin: 0 }}>{title}</h1>
        <p style={{ fontSize: 'var(--sv-font-size-2xl, 1.75rem)', margin: 0 }}>
          {formatMoney(toMinor(record.amount), record.currency)}
        </p>
        <p className={styles.small}>
          {record.date}
          {expense ? (
            <>
              {' · '}
              <Icon name={CATEGORY_VIEW[expense.category]?.icon ?? 'file-text'} aria-hidden />{' '}
              {CATEGORY_VIEW[expense.category]?.label}
            </>
          ) : null}
          {record.deletedAt !== null ? ' · deleted' : ''}
        </p>
        {problem ? <Alert variant="error">{problem}</Alert> : null}
        {closed ? null : (
          <div className={styles.row}>
            {record.deletedAt === null ? (
              <>
                <ButtonLink
                  variant="secondary"
                  href={editHref}
                  renderLink={(props) => <LocalLink {...props} href={props.href} />}
                >
                  Edit
                </ButtonLink>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void write(
                      kind === 'expense'
                        ? deleteExpense({ ...ids(), current })
                        : deletePayment({ ...ids(), current }),
                    )
                  }
                >
                  Delete
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={() =>
                  void write(
                    kind === 'expense'
                      ? restoreExpense({ ...ids(), current })
                      : restorePayment({ ...ids(), current }),
                  )
                }
              >
                Restore
              </Button>
            )}
          </div>
        )}

        {expense ? (
          <section className={styles.stack} aria-label="Who paid and who shared">
            <p>
              Paid by{' '}
              {expense.payers.map((p, i) => (
                <span key={p.memberId}>
                  {i > 0 ? ', ' : ''}
                  {nameOf(p.memberId)} {formatMoney(toMinor(p.amount), expense.currency)}
                </span>
              ))}
            </p>
            <p className={styles.small}>Split {METHOD_WORDS[expense.method] ?? ''}:</p>
            <ul className={styles.list} aria-label="Shares">
              {expense.shares.map((s) => (
                <li key={s.memberId} className={styles.line}>
                  <span className={styles.lineMain}>{nameOf(s.memberId)}</span>
                  <span className={styles.lineEnd}>
                    {formatMoney(toMinor(s.amount), expense.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {note ? <p className={styles.muted}>{note}</p> : null}

        <section className={styles.stack} aria-label="Comments">
          <h2 className={styles.small}>Comments</h2>
          {visible.length === 0 ? <p className={styles.muted}>No comments yet.</p> : null}
          <ul className={styles.list}>
            {visible.map((c: LocalComment, i) => (
              <li key={c.id} className={styles.line}>
                <span className={styles.lineMain}>
                  <span className={styles.small}>{personName(c.authorPersonId)}</span>
                  <span>{typeof bodies[i]?.body === 'string' ? bodies[i]?.body : '…'}</span>
                </span>
                {c.authorPersonId === me?.personId && !closed ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Delete your comment"
                    onClick={() => void write(deleteComment({ ...ids(), commentId: c.id }))}
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {closed ? null : (
            <form
              className={styles.stack}
              aria-label="Add a comment"
              onSubmit={(event) => {
                event.preventDefault();
                void comment();
              }}
            >
              <FormField label="Comment">
                {(field) => (
                  <Textarea
                    {...field}
                    value={body}
                    maxLength={2000}
                    onChange={(event) => setBody(event.target.value)}
                  />
                )}
              </FormField>
              <div>
                <Button type="submit" disabled={body.trim() === ''}>
                  Comment
                </Button>
              </div>
            </form>
          )}
        </section>

        <section className={styles.stack} aria-label="History">
          <h2 className={styles.small}>History</h2>
          {history === 'offline' ? (
            <p className={styles.muted}>History needs a connection.</p>
          ) : history === null ? null : (
            <ul className={styles.list}>
              {history.map((entry, i) => (
                <li key={`${entry.version}:${entry.kind}:${i}`} className={styles.line}>
                  <span className={styles.lineMain}>
                    {historyWords(entry, history[i - 1], personName, kind)}
                    <span className={styles.small}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </span>
                  {entry.kind === 'replaced' && !closed ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void restoreVersion(entry)}
                    >
                      Restore this version
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </article>
    </PageContainer>
  );
}

/** A version in words, from the reader's point of view, by what changed from the one before (§8.5): "Kasun changed the amount from €80.00 to €84.00". */
function historyWords(
  entry: HistoryEntry,
  before: HistoryEntry | undefined,
  personName: (personId: string | null) => string,
  kind: Kind,
): string {
  const who = personName(entry.actorPersonId);
  const money = (snap: Record<string, unknown>) =>
    formatMoney(toMinor(Number(snap.amount)), String(snap.currency));
  const it = kind === 'expense' ? 'it' : 'the payment';
  switch (entry.kind) {
    case 'created':
      return `${who} added ${it}, ${money(entry.snapshot)}`;
    case 'deleted':
      return `${who} deleted ${it}`;
    case 'restored':
      return `${who} restored ${it}`;
    case 'replaced':
      return `${who === 'You' ? 'Your' : `${who}’s`} version was replaced by a later change`;
    case 'edited': {
      const prev = before?.snapshot;
      if (!prev) return `${who} changed ${it}`;
      const changes: string[] = [];
      if (prev.amount !== entry.snapshot.amount || prev.currency !== entry.snapshot.currency)
        changes.push(`the amount from ${money(prev)} to ${money(entry.snapshot)}`);
      if (prev.date !== entry.snapshot.date)
        changes.push(`the date to ${String(entry.snapshot.date)}`);
      if (prev.category !== entry.snapshot.category) changes.push('the category');
      if (prev.sealed !== entry.snapshot.sealed)
        changes.push(kind === 'expense' ? 'the description or note' : 'the note');
      if (
        JSON.stringify(prev.shares) !== JSON.stringify(entry.snapshot.shares) ||
        prev.method !== entry.snapshot.method
      )
        changes.push('the split');
      if (JSON.stringify(prev.payers) !== JSON.stringify(entry.snapshot.payers))
        changes.push('who paid');
      return changes.length === 0 ? `${who} changed ${it}` : `${who} changed ${changes.join(', ')}`;
    }
  }
}
