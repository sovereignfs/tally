'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  FormField,
  Input,
  MemberMultiSelect,
  QuantityStepper,
  Select,
  SplitMethodSelector,
  Textarea,
} from '@sovereignfs/ui';
import {
  CATEGORIES,
  type Category,
  DEFAULT_CATEGORY,
  addExpense,
  editExpense,
  expenseRow,
} from '../actions';
import { checkExpenseText, refusalSentence } from '../actions/validate';
import { LocalRefusal } from '../local/store';
import { type Minor, toMinor } from '../money/amount';
import {
  SplitError,
  type SplitInput,
  type SplitMethod,
  checkPayers,
  computeShares,
} from '../money/split';
import { formatMoney, parseAmount } from '../money/text';
import { useGroupKeys, useSync } from '../sync/react';
import { CurrencyPicker } from '../ui/CurrencyPicker';
import { MoneyInput } from '../ui/MoneyInput';
import { CATEGORY_VIEW } from './categories';
import type { GroupView } from './data';
import styles from './Screens.module.css';

/**
 * **Adding an expense** (DESIGN.md §15.9): the amount first, then the description, then the sentence of choices (group, date, category, who paid, how it
 * is split and between whom), with the result always shown and what is left to assign. Save is disabled until it adds up, and says why. Enter saves;
 * Save and add another keeps the group, date and split. The defaults are remembered per group on the device. Saving seals the text under the group's
 * newest key and writes to the device (`SyncClient.commit`): it closes at once, and the expense is on the device.
 *
 * The same form edits an expense (`editing`), filled from it, and replaces it whole (§8.5).
 */
type Method = SplitMethod;
type UiMethod = 'equal' | 'amount' | 'percentage' | 'shares';
const toUi: Record<Method, UiMethod> = {
  equal: 'equal',
  amounts: 'amount',
  percentages: 'percentage',
  shares: 'shares',
};
const fromUi: Record<UiMethod, Method> = {
  equal: 'equal',
  amount: 'amounts',
  percentage: 'percentages',
  shares: 'shares',
};

interface Defaults {
  category: Category;
  payer: string | null;
  method: Method;
  included: string[] | null;
}

const defaultsKey = (groupId: string) => `tally.defaults.${groupId}`;
function readDefaults(groupId: string): Partial<Defaults> {
  try {
    return JSON.parse(
      window.localStorage.getItem(defaultsKey(groupId)) ?? '{}',
    ) as Partial<Defaults>;
  } catch {
    return {};
  }
}
function keepDefaults(groupId: string, defaults: Defaults) {
  try {
    window.localStorage.setItem(defaultsKey(groupId), JSON.stringify(defaults));
    window.localStorage.setItem('tally.lastGroup', groupId);
  } catch {
    // A device that keeps nothing asks again next time.
  }
}

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Basis points from what was typed as a percentage ("33.33" → 3333), exactly, through decimal text: two decimals, as a currency of cents has. */
const basisPoints = (text: string): number | null => parseAmount(text, 'USD');

export interface Editing {
  id: string;
  version: number;
  description: string;
  note: string | null;
}

export function AddExpenseForm({
  views,
  names,
  initialGroupId,
  editing,
  onDone,
}: {
  views: GroupView[];
  names: Record<string, string | undefined>;
  initialGroupId: string | undefined;
  editing?: Editing;
  onDone: () => void;
}) {
  const client = useSync();
  const keys = useGroupKeys();
  const open = views.filter((v) => v.group.closedAt === null && v.me && v.me.leftAt === null);
  const [groupId, setGroupId] = useState<string>(
    initialGroupId && open.some((v) => v.group.id === initialGroupId)
      ? initialGroupId
      : (open[0]?.group.id ?? ''),
  );
  const view = open.find((v) => v.group.id === groupId);
  const stored = editing ? view?.expenses.find((e) => e.id === editing.id) : undefined;

  // Who can be named: the active members, and on an edit, anyone already on the version being edited.
  const members = useMemo(
    () =>
      (view?.members ?? []).filter(
        (m) =>
          m.leftAt === null ||
          (stored &&
            [
              ...stored.payers.map((p) => p.memberId),
              ...stored.shares.map((s) => s.memberId),
            ].includes(m.id)),
      ),
    [view, stored],
  );
  const memberIds = members.map((m) => m.id);
  const nameOf = (id: string) =>
    id === view?.me?.id ? 'You' : (members.find((m) => m.id === id)?.name ?? 'Someone');
  const possessive = (id: string) => (id === view?.me?.id ? 'Your' : `${nameOf(id)}’s`);

  const [amount, setAmount] = useState<Minor | null>(stored ? toMinor(stored.amount) : null);
  const [currency, setCurrency] = useState(
    stored?.currency ?? view?.group.defaultCurrency ?? 'EUR',
  );
  const [description, setDescription] = useState(editing?.description ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [showNote, setShowNote] = useState(Boolean(editing?.note));
  const [date, setDate] = useState(stored?.date ?? today());
  const [category, setCategory] = useState<Category>(stored?.category ?? DEFAULT_CATEGORY);
  const [several, setSeveral] = useState((stored?.payers.length ?? 1) > 1);
  const [payer, setPayer] = useState<string>(stored?.payers[0]?.memberId ?? view?.me?.id ?? '');
  const [paid, setPaid] = useState<Record<string, Minor | null>>(
    Object.fromEntries((stored?.payers ?? []).map((p) => [p.memberId, toMinor(p.amount)])),
  );
  const [method, setMethod] = useState<Method>(stored?.method ?? 'equal');
  const [included, setIncluded] = useState<Set<string>>(
    new Set(stored ? stored.shares.map((s) => s.memberId) : memberIds),
  );
  const [amounts, setAmounts] = useState<Record<string, Minor | null>>(
    stored?.method === 'amounts'
      ? Object.fromEntries(stored.shares.map((s) => [s.memberId, toMinor(s.amount)]))
      : {},
  );
  const [percents, setPercents] = useState<Record<string, string>>(
    stored?.method === 'percentages'
      ? Object.fromEntries(
          stored.shares.map((s) => [s.memberId, ((s.units ?? 0) / 100).toFixed(2)]),
        )
      : {},
  );
  const [shares, setShares] = useState<Record<string, number>>(
    stored?.method === 'shares'
      ? Object.fromEntries(stored.shares.map((s) => [s.memberId, (s.units ?? 100) / 100]))
      : {},
  );
  const [problem, setProblem] = useState<string | null>(null);

  // A new group: its currency, and what this device remembers of it.
  useEffect(() => {
    if (!view || editing) return;
    const remembered = readDefaults(view.group.id);
    const active = view.members.filter((m) => m.leftAt === null).map((m) => m.id);
    setCurrency(view.group.defaultCurrency);
    setCategory(remembered.category ?? DEFAULT_CATEGORY);
    setPayer(
      remembered.payer && active.includes(remembered.payer)
        ? remembered.payer
        : (view.me?.id ?? active[0] ?? ''),
    );
    setMethod(remembered.method ?? 'equal');
    const kept = (remembered.included ?? active).filter((id) => active.includes(id));
    setIncluded(new Set(kept.length > 0 ? kept : active));
    setSeveral(false);
    // Only a change of group resets these.
  }, [view?.group.id]);

  // The result: the payers and the shares by the one rounding rule, or why not.
  const result = useMemo(() => {
    const order = view?.order ?? [];
    if (amount === null || amount <= 0) return { error: 'Type the amount.' } as const;
    const payers = several
      ? memberIds
          .filter((id) => paid[id] != null && (paid[id] ?? 0) > 0)
          .map((id) => ({ memberId: id, amount: paid[id] as Minor }))
      : [{ memberId: payer, amount }];
    const paidTotal = payers.reduce((sum, p) => sum + p.amount, 0);
    const inputs: SplitInput[] = memberIds
      .filter((id) => included.has(id))
      .map((id) => ({
        memberId: id,
        units:
          method === 'equal'
            ? null
            : method === 'amounts'
              ? (amounts[id] ?? null)
              : method === 'percentages'
                ? basisPoints(percents[id] ?? '')
                : Math.round((shares[id] ?? 1) * 100),
      }));
    const assigned = inputs.reduce((sum, i) => sum + (i.units ?? 0), 0);
    const left =
      method === 'amounts'
        ? `${formatMoney(toMinor(amount - assigned), currency)} left to assign`
        : method === 'percentages'
          ? `${((10_000 - assigned) / 100).toFixed(2)}% left to assign`
          : null;
    if (several && paidTotal !== amount)
      return {
        error: `What was paid adds up to ${formatMoney(toMinor(paidTotal), currency)}, not ${formatMoney(amount, currency)}.`,
      } as const;
    try {
      checkPayers(amount, payers, order);
      const computed = computeShares(amount, method, inputs, order);
      return {
        payers,
        shares: computed,
        left:
          left && (method === 'amounts' ? amount - assigned : 10_000 - assigned) !== 0
            ? left
            : null,
      } as const;
    } catch (error) {
      if (!(error instanceof SplitError)) throw error;
      const why =
        error.code === 'EMPTY'
          ? 'Choose who it was for.'
          : error.code === 'AMOUNTS_TOTAL'
            ? `The amounts must add up to the expense: ${left}.`
            : error.code === 'PERCENT_TOTAL'
              ? `The percentages must add up to 100%: ${left}.`
              : 'Each part must be more than zero.';
      return { error: why } as const;
    }
  }, [
    amount,
    currency,
    several,
    paid,
    payer,
    method,
    included,
    amounts,
    percents,
    shares,
    memberIds,
    view?.order,
  ]);

  async function save(another: boolean) {
    setProblem(null);
    if (!view || !client || !keys || 'error' in result) return;
    const text = checkExpenseText({ description, note: showNote ? note : null });
    if (!text.ok) return setProblem(refusalSentence(text.refusal));
    const expenseId = editing?.id ?? crypto.randomUUID();
    const sealed = await keys.sealText(
      { description: text.value.description, note: text.value.note },
      { group: view.group.id, table: 'expense', row: expenseId },
      view.group.keyEpoch,
    );
    if (!sealed)
      return setProblem(
        'This group is not unlocked on this device yet. It unlocks by itself when another member’s device is online.',
      );
    const row = expenseRow(
      {
        sealed,
        amount: amount as Minor,
        currency,
        date,
        category,
        method,
        payers: result.payers,
        split: result.shares.map((s) => ({ memberId: s.memberId, units: s.units })),
      },
      view.order,
    );
    if (!row.ok) return setProblem(refusalSentence(row.refusal));
    try {
      await client.commit(
        editing
          ? editExpense({
              mutationId: crypto.randomUUID(),
              groupId: view.group.id,
              current: { id: editing.id, version: editing.version },
              row: row.value,
            })
          : addExpense({
              mutationId: crypto.randomUUID(),
              groupId: view.group.id,
              expenseId,
              row: row.value,
            }),
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
    keepDefaults(view.group.id, {
      category,
      payer: several ? null : payer,
      method,
      included: [...included],
    });
    if (another) {
      setAmount(null);
      setDescription('');
      setNote('');
      setShowNote(false);
      setAmounts({});
      setPaid({});
      return;
    }
    onDone();
  }

  if (open.length === 0)
    return <p className={styles.muted}>Make a group first: an expense is always in a group.</p>;

  const valid = !('error' in result) && description.trim() !== '';
  return (
    <form
      className={styles.stack}
      aria-label={editing ? 'Edit expense' : 'Add expense'}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void save(false);
      }}
    >
      {problem ? <Alert variant="error">{problem}</Alert> : null}
      <div className={styles.row}>
        <div style={{ flex: '1 1 10rem' }}>
          <MoneyInput
            value={amount}
            onChange={setAmount}
            currency={currency}
            aria-label="Amount"
            focusOnOpen
          />
        </div>
        <CurrencyPicker
          value={currency}
          onChange={setCurrency}
          first={view ? [view.group.defaultCurrency] : []}
          aria-label="Currency"
        />
      </div>
      <FormField label="Description" required>
        {(field) => (
          <Input
            {...field}
            value={description}
            maxLength={200}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Dinner"
          />
        )}
      </FormField>

      <div className={styles.row}>
        <span className={styles.row}>
          <span className={styles.small}>in</span>
          <Select
            aria-label="Group"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            disabled={Boolean(editing)}
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
        <span className={styles.row}>
          <span className={styles.small}>as</span>
          <Select
            aria-label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_VIEW[c].label}
              </option>
            ))}
          </Select>
        </span>
      </div>

      <div className={styles.row}>
        <span className={styles.small}>paid by</span>
        {several ? null : (
          <Select
            aria-label="Paid by"
            value={payer}
            onChange={(event) => setPayer(event.target.value)}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {nameOf(m.id)}
              </option>
            ))}
          </Select>
        )}
        <Button variant="secondary" onClick={() => setSeveral(!several)}>
          {several ? 'One person paid' : 'Several people paid'}
        </Button>
      </div>
      {several ? (
        <fieldset className={styles.stack} aria-label="What each paid">
          {members.map((m) => (
            <div key={m.id} className={styles.row}>
              <span style={{ minWidth: '6rem' }}>{nameOf(m.id)}</span>
              <MoneyInput
                value={paid[m.id] ?? null}
                onChange={(value) => setPaid({ ...paid, [m.id]: value })}
                currency={currency}
                aria-label={m.id === view?.me?.id ? 'What you paid' : `What ${nameOf(m.id)} paid`}
              />
            </div>
          ))}
        </fieldset>
      ) : null}

      <div className={styles.row}>
        <span className={styles.small}>split</span>
        <SplitMethodSelector
          value={toUi[method]}
          onChange={(value) => setMethod(fromUi[value])}
          aria-label="How it is split"
        />
      </div>
      <MemberMultiSelect
        label="Between"
        options={members.map((m) => ({ id: m.id, label: nameOf(m.id) }))}
        selectedIds={included}
        onToggle={(id, checked) => {
          const next = new Set(included);
          if (checked) next.add(id);
          else next.delete(id);
          setIncluded(next);
        }}
        renderTrailing={(id) =>
          method === 'amounts' ? (
            <MoneyInput
              value={amounts[id] ?? null}
              onChange={(value) => setAmounts({ ...amounts, [id]: value })}
              currency={currency}
              aria-label={`${possessive(id)} amount`}
            />
          ) : method === 'percentages' ? (
            <Input
              inputMode="decimal"
              aria-label={`${possessive(id)} percentage`}
              value={percents[id] ?? ''}
              onChange={(event) => setPercents({ ...percents, [id]: event.target.value })}
              placeholder="0.00"
              style={{ width: '6rem' }}
            />
          ) : method === 'shares' ? (
            <QuantityStepper
              aria-label={`${possessive(id)} shares`}
              value={shares[id] ?? 1}
              min={0.5}
              step={0.5}
              onChange={(value) => setShares({ ...shares, [id]: value })}
            />
          ) : null
        }
      />

      <p className={styles.small} role="status" aria-label="The result">
        {'error' in result ? (
          <span className={styles.owe}>{result.error}</span>
        ) : (
          <>
            {result.shares.map((s, i) => (
              <span key={s.memberId}>
                {i > 0 ? ' · ' : ''}
                {nameOf(s.memberId)} {formatMoney(s.amount, currency)}
              </span>
            ))}
            {result.left ? <span className={styles.owe}> · {result.left}</span> : null}
          </>
        )}
      </p>

      {showNote ? (
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
      ) : (
        <div>
          <Button variant="ghost" onClick={() => setShowNote(true)}>
            + Note
          </Button>
        </div>
      )}

      <div className={styles.row}>
        <Button type="submit" disabled={!valid}>
          Save
        </Button>
        {editing ? null : (
          <Button variant="secondary" disabled={!valid} onClick={() => void save(true)}>
            Save and add another
          </Button>
        )}
      </div>
    </form>
  );
}
