'use client';

import { useState } from 'react';
import { Alert, Button, FormField, Input, Select, Textarea } from '@sovereignfs/ui';
import { addPayment, editPayment } from '../actions';
import { checkPaymentText, refusalSentence } from '../actions/validate';
import { LocalRefusal } from '../local/store';
import { type Minor, toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import { useGroupKeys, useSync } from '../sync/react';
import { CurrencyPicker } from '../ui/CurrencyPicker';
import { MoneyInput } from '../ui/MoneyInput';
import type { GroupView } from './data';
import styles from './Screens.module.css';

/**
 * **Recording a payment** (DESIGN.md §9, §15.9): who paid whom, how much, in which group, when, and a note. Filled in from a suggestion (Settle up), it
 * says what it will record in a sentence and records it in one press; empty, it is a payment by hand (a part, an earlier date, a pair the suggestions
 * did not name). Nothing moves money: it records what already happened. Written to the device, like an expense.
 */
export interface PaymentEditing {
  id: string;
  version: number;
  note: string | null;
}

export function AddPaymentForm({
  views,
  names,
  initialGroupId,
  prefill,
  editing,
  onDone,
}: {
  views: GroupView[];
  names: Record<string, string | undefined>;
  initialGroupId: string | undefined;
  prefill: { from?: string; to?: string; amount?: number; currency?: string };
  editing?: PaymentEditing;
  onDone: () => void;
}) {
  const client = useSync();
  const keys = useGroupKeys();
  const open = views.filter((v) => v.group.closedAt === null && v.me && v.me.leftAt === null);
  const [groupId, setGroupId] = useState(
    initialGroupId && open.some((v) => v.group.id === initialGroupId)
      ? initialGroupId
      : (open[0]?.group.id ?? ''),
  );
  const view = open.find((v) => v.group.id === groupId);
  const stored = editing ? view?.payments.find((p) => p.id === editing.id) : undefined;
  const members = (view?.members ?? []).filter(
    (m) => m.leftAt === null || m.id === stored?.fromMemberId || m.id === stored?.toMemberId,
  );
  const nameOf = (id: string) =>
    id === view?.me?.id ? 'You' : (members.find((m) => m.id === id)?.name ?? 'Someone');
  const objectOf = (id: string) => (id === view?.me?.id ? 'you' : nameOf(id));

  const [from, setFrom] = useState(stored?.fromMemberId ?? prefill.from ?? view?.me?.id ?? '');
  const [to, setTo] = useState(
    stored?.toMemberId ??
      prefill.to ??
      members.find((m) => m.id !== (prefill.from ?? view?.me?.id))?.id ??
      '',
  );
  const [amount, setAmount] = useState<Minor | null>(
    stored ? toMinor(stored.amount) : prefill.amount !== undefined ? toMinor(prefill.amount) : null,
  );
  const [currency, setCurrency] = useState(
    stored?.currency ?? prefill.currency ?? view?.group.defaultCurrency ?? 'EUR',
  );
  const [date, setDate] = useState(stored?.date ?? new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(editing?.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const suggested = Boolean(prefill.from && prefill.to && prefill.amount !== undefined) && !editing;

  // Settle up with nothing chosen yet: the suggestions that involve the reader, one press each to fill the form in.
  const mine = (view?.suggestions ?? []).filter(
    (d) => d.fromId === view?.me?.id || d.toId === view?.me?.id,
  );

  async function save() {
    setProblem(null);
    if (!view || !client || !keys || amount === null || amount <= 0) return;
    if (from === to) return setProblem('A payment is between two different people.');
    const text = checkPaymentText({ note });
    if (!text.ok) return setProblem(refusalSentence(text.refusal));
    const paymentId = editing?.id ?? crypto.randomUUID();
    let sealed: string | null = null;
    if (text.value.note) {
      sealed =
        (await keys.sealText(
          { note: text.value.note },
          { group: view.group.id, table: 'payment', row: paymentId },
          view.group.keyEpoch,
        )) ?? null;
      if (!sealed)
        return setProblem(
          'This group is not unlocked on this device yet. It unlocks by itself when another member’s device is online.',
        );
    }
    const row = { sealed, fromMemberId: from, toMemberId: to, amount, currency, date };
    try {
      await client.commit(
        editing
          ? editPayment({
              mutationId: crypto.randomUUID(),
              groupId: view.group.id,
              current: { id: editing.id, version: editing.version },
              row,
            })
          : addPayment({ mutationId: crypto.randomUUID(), groupId: view.group.id, paymentId, row }),
      );
    } catch (error) {
      if (error instanceof LocalRefusal)
        return setProblem(
          refusalSentence(error.refusal, {
            ...(names[view.group.id] ? { group: names[view.group.id] as string } : {}),
            member: nameOf,
          }),
        );
      throw error;
    }
    onDone();
  }

  if (open.length === 0)
    return <p className={styles.muted}>A payment is always in a group: make one first.</p>;
  const valid = amount !== null && amount > 0 && from !== '' && to !== '' && from !== to;
  return (
    <form
      className={styles.stack}
      aria-label={editing ? 'Edit payment' : 'Record a payment'}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void save();
      }}
    >
      {problem ? <Alert variant="error">{problem}</Alert> : null}
      {!editing && !suggested && mine.length > 0 ? (
        <div className={styles.stack}>
          <span className={styles.small}>Suggested</span>
          <div className={styles.row}>
            {mine.map((d) => (
              <Button
                key={`${d.currency}:${d.fromId}:${d.toId}`}
                variant="secondary"
                onClick={() => {
                  setFrom(d.fromId);
                  setTo(d.toId);
                  setAmount(d.amount);
                  setCurrency(d.currency);
                }}
              >
                {nameOf(d.fromId)} {d.fromId === view?.me?.id ? 'pay' : 'pays'} {objectOf(d.toId)}{' '}
                {formatMoney(d.amount, d.currency)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {suggested && amount !== null ? (
        <p role="status" aria-label="What will be recorded">
          Record that {objectOf(from) === 'you' ? 'you' : nameOf(from)} paid {objectOf(to)}{' '}
          {formatMoney(amount, currency)}?
        </p>
      ) : null}
      <div className={styles.row}>
        <span className={styles.row}>
          <Select
            aria-label="Who paid"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {nameOf(m.id)}
              </option>
            ))}
          </Select>
          <span className={styles.small}>paid</span>
          <Select
            aria-label="Who was paid"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {objectOf(m.id)}
              </option>
            ))}
          </Select>
        </span>
      </div>
      <div className={styles.row}>
        <div style={{ flex: '1 1 10rem' }}>
          <MoneyInput
            value={amount}
            onChange={setAmount}
            currency={currency}
            aria-label="Amount"
            focusOnOpen={!suggested}
          />
        </div>
        <CurrencyPicker
          value={currency}
          onChange={setCurrency}
          first={view ? [view.group.defaultCurrency] : []}
          aria-label="Currency"
        />
      </div>
      <div className={styles.row}>
        <span className={styles.row}>
          <span className={styles.small}>in</span>
          <Select
            aria-label="Group"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            disabled={Boolean(editing) || suggested}
          >
            {open.map((v) => (
              <option key={v.group.id} value={v.group.id}>
                {names[v.group.id] ?? '…'}
              </option>
            ))}
          </Select>
        </span>
        <span className={styles.row}>
          <span className={styles.small}>on</span>
          <Input
            type="date"
            aria-label="Date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </span>
      </div>
      <FormField label="Note">
        {(field) => (
          <Textarea
            {...field}
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </FormField>
      <div className={styles.row}>
        <Button type="submit" disabled={!valid}>
          {editing ? 'Save' : 'Record payment'}
        </Button>
      </div>
    </form>
  );
}
