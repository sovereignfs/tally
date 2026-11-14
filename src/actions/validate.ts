import { parseSealed } from '../cipher/seal';
import { type Minor, isMinor } from '../money/amount';
import { isSupportedCurrencyCode } from '../money/currencies';
import { SplitError, checkPayers, checkShares, isSplitMethod } from '../money/split';
import { isCategory } from './categories';
import {
  COMMENT_SUBJECTS,
  type Change,
  type CommentRow,
  type CommentSubject,
  type ExpenseRow,
  type Mutation,
  type PaymentRow,
} from './types';

/**
 * **The validators are one module** (DESIGN.md §11.2, §11.5), run by the browser before it queues an action and by the server before it applies one:
 * whatever the device said, the server says it again. It imports nothing of the browser or the server, so both run the same lines.
 *
 * Two kinds of check: **what people typed**, on the device before it is sealed (`checkExpenseText` and its siblings; the server never sees it), and
 * **what travels**, on both (`parseMutation`, `checkExpense`, `checkPayment`, `checkComment`), where the sealed text is checked only for its form, its
 * epoch and its length (§5.3). Every refusal is one `Refusal`, with a code a screen turns into a sentence (`refusalSentence`); none carries an amount, a
 * name or anything typed.
 */

export type RefusalCode =
  /** Not a mutation, or not one this version knows. */
  | 'malformed'
  /** The group, or a row, is not there for this account: another group's, or none (a refusal reads as not found, §5.2). */
  | 'not_found'
  /** The account is no longer in the group. */
  | 'not_in_group'
  | 'closed'
  /** Someone named is no longer in the group (and was not on the version being edited). */
  | 'member_gone'
  | 'amount'
  | 'currency'
  | 'date'
  | 'category'
  | 'method'
  | 'payers'
  | 'shares'
  | 'same_person'
  /** What was typed is missing or too long; `field` says which. */
  | 'text'
  /** The sealed text is not in the sealed form, under an epoch of the group, within its length. */
  | 'sealed'
  /** Only the author can delete a comment. */
  | 'not_author';

export interface Refusal {
  code: RefusalCode;
  /** The field, for `text` and the like: `description`, `note`, `body`. */
  field?: string;
  /** The member, for `member_gone`. */
  memberId?: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; refusal: Refusal };

const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const no = (
  code: RefusalCode,
  extra: Omit<Refusal, 'code'> = {},
): { ok: false; refusal: Refusal } => ({
  ok: false,
  refusal: { code, ...extra },
});

/** Limits (§8.1, §8.6). Characters are counted as people see them, by code point. */
export const MAX_DESCRIPTION = 200;
export const MAX_NOTE = 2_000;
export const MAX_COMMENT = 2_000;
/** The longest sealed value: the longest description and note, every character four bytes, sealed, padded and in base64url, with room to spare. */
export const MAX_SEALED = 16_384;
/** The most changes one mutation carries, and an id's form: what a device makes (`crypto.randomUUID()`), or anything as plain. */
export const MAX_CHANGES = 20;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

export const isId = (value: unknown): value is string =>
  typeof value === 'string' && ID.test(value);

const length = (text: string) => [...text].length;

// ——— What people typed, on the device, before it is sealed ———

export interface ExpenseText {
  description: string;
  note: string | null;
}

/** The description is required and at most 200 characters; the note at most 2,000. Returns them trimmed, an empty note as `null`. */
export function checkExpenseText(text: ExpenseText): Checked<ExpenseText> {
  const description = text.description.trim();
  if (description === '' || length(description) > MAX_DESCRIPTION)
    return no('text', { field: 'description' });
  const note = checkNote(text.note);
  if (note === undefined) return no('text', { field: 'note' });
  return ok({ description, note });
}

export function checkPaymentText(text: { note: string | null }): Checked<{ note: string | null }> {
  const note = checkNote(text.note);
  return note === undefined ? no('text', { field: 'note' }) : ok({ note });
}

export function checkCommentText(text: { body: string }): Checked<{ body: string }> {
  const body = text.body.trim();
  if (body === '' || length(body) > MAX_COMMENT) return no('text', { field: 'body' });
  return ok({ body });
}

function checkNote(note: string | null): string | null | undefined {
  const trimmed = note?.trim() ?? '';
  if (length(trimmed) > MAX_NOTE) return undefined;
  return trimmed === '' ? null : trimmed;
}

// ——— What travels, on both ———

/** A `YYYY-MM-DD` that is a day of the calendar, from 1970 to 9999. */
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (y < 1970) return false;
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d;
}

/** The form of a sealed value (§5.3): the sealed form, under an epoch the group has had, within its length. The server has no key, and needs none. */
export function isSealed(value: unknown, epochAtMost: number): value is string {
  if (typeof value !== 'string' || value.length > MAX_SEALED) return false;
  try {
    return parseSealed(value).epoch <= epochAtMost;
  } catch {
    return false;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isVersion = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/**
 * The shape of a mutation, from what arrived: its id and group's, one to twenty changes of known tables and kinds, each row's fields of the right types,
 * no row changed twice. The values themselves (members, sums, the sealed form) are for `checkExpense` and its siblings, which need the group.
 */
export function parseMutation(value: unknown): Checked<Mutation> {
  if (!isObject(value) || !isId(value.mutationId) || !isId(value.groupId)) return no('malformed');
  const { changes } = value;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_CHANGES)
    return no('malformed');
  const parsed: Change[] = [];
  const seen = new Set<string>();
  for (const raw of changes) {
    const change = parseChange(raw);
    if (!change) return no('malformed');
    const key = `${change.table}:${change.id}`;
    if (seen.has(key)) return no('malformed');
    seen.add(key);
    parsed.push(change);
  }
  return ok({ mutationId: value.mutationId, groupId: value.groupId, changes: parsed });
}

function parseChange(raw: unknown): Change | null {
  if (!isObject(raw) || !isId(raw.id)) return null;
  const { table, op, id } = raw;
  if (table === 'comment') {
    if (op === 'delete') return { table, op, id };
    if (op !== 'put') return null;
    const row = parseCommentRow(raw.row);
    return row ? { table, op, id, row } : null;
  }
  if (table !== 'expense' && table !== 'payment') return null;
  if (op === 'delete' || op === 'restore') {
    if (!isVersion(raw.baseVersion)) return null;
    return { table, op, id, baseVersion: raw.baseVersion } as Change;
  }
  if (op !== 'put') return null;
  const baseVersion =
    raw.baseVersion === null ? null : isVersion(raw.baseVersion) ? raw.baseVersion : undefined;
  if (baseVersion === undefined) return null;
  if (table === 'expense') {
    const row = parseExpenseRow(raw.row);
    return row ? { table, op, id, baseVersion, row } : null;
  }
  const row = parsePaymentRow(raw.row);
  return row ? { table, op, id, baseVersion, row } : null;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isUnits = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isSafeInteger(value));

function parseExpenseRow(raw: unknown): ExpenseRow | null {
  if (!isObject(raw)) return null;
  const { sealed, amount, currency, date, category, method, payers, shares } = raw;
  if (!isString(sealed) || !isMinor(amount) || !isString(currency) || !isString(date)) return null;
  if (!isString(category) || !isString(method) || !Array.isArray(payers) || !Array.isArray(shares))
    return null;
  if (payers.length > 100 || shares.length > 100) return null;
  const parsedPayers: ExpenseRow['payers'] = [];
  for (const p of payers) {
    if (!isObject(p) || !isId(p.memberId) || !isMinor(p.amount)) return null;
    parsedPayers.push({ memberId: p.memberId, amount: p.amount });
  }
  const parsedShares: ExpenseRow['shares'] = [];
  for (const s of shares) {
    if (!isObject(s) || !isId(s.memberId) || !isMinor(s.amount) || !isUnits(s.units)) return null;
    parsedShares.push({ memberId: s.memberId, amount: s.amount, units: s.units });
  }
  // The category and method are only strings here; `checkExpense` says whether they are known, with a refusal of their own.
  return {
    sealed,
    amount,
    currency,
    date,
    category: category as ExpenseRow['category'],
    method: method as ExpenseRow['method'],
    payers: parsedPayers,
    shares: parsedShares,
  };
}

function parsePaymentRow(raw: unknown): PaymentRow | null {
  if (!isObject(raw)) return null;
  const { sealed, fromMemberId, toMemberId, amount, currency, date } = raw;
  if (!(sealed === null || isString(sealed)) || !isId(fromMemberId) || !isId(toMemberId))
    return null;
  if (!isMinor(amount) || !isString(currency) || !isString(date)) return null;
  return { sealed, fromMemberId, toMemberId, amount, currency, date };
}

function parseCommentRow(raw: unknown): CommentRow | null {
  if (!isObject(raw)) return null;
  const { subject, subjectId, sealed } = raw;
  if (
    !(COMMENT_SUBJECTS as readonly unknown[]).includes(subject) ||
    !isId(subjectId) ||
    !isString(sealed)
  )
    return null;
  return { subject: subject as CommentSubject, subjectId, sealed };
}

/**
 * What a row is checked against: the group as the checker sees it. On the server, from its rows, in the transaction that applies; on the device, from
 * its store.
 */
export interface GroupContext {
  /** Every member the group has had, in member order (joined, then id); the leftover of a split follows it. */
  order: readonly string[];
  /** The members still in the group. */
  active: ReadonlySet<string>;
  /** The group's current key epoch: a sealed value under a later one is refused. */
  epoch: number;
}

/**
 * Whether everyone a row names may be named: an active member, or one already on the version being edited (`onVersion`), so that editing an old
 * expense of someone who has left does not have to take them out of it.
 */
function named(
  ids: readonly string[],
  context: GroupContext,
  onVersion: ReadonlySet<string>,
): Refusal | null {
  for (const id of ids)
    if (!context.active.has(id) && !onVersion.has(id))
      return context.order.includes(id)
        ? { code: 'member_gone', memberId: id }
        : { code: 'not_found' };
  return null;
}

function amountCurrencyDate(amount: Minor, currency: string, date: string): Refusal | null {
  if (!isMinor(amount) || amount <= 0) return { code: 'amount' };
  if (!isSupportedCurrencyCode(currency)) return { code: 'currency' };
  if (!isDate(date)) return { code: 'date' };
  return null;
}

/**
 * An expense (§8, §11.5): sealed text in form, a positive amount in a known currency, a real date, a known category and method, everyone named still in
 * the group or on the version being edited, the payers adding up to the amount and the shares exactly what the method and units give (`split.ts`).
 * Returns the row with its payers and shares in member order.
 */
export function checkExpense(
  row: ExpenseRow,
  context: GroupContext,
  onVersion: ReadonlySet<string> = new Set(),
): Checked<ExpenseRow> {
  if (!isSealed(row.sealed, context.epoch)) return no('sealed');
  const basic = amountCurrencyDate(row.amount, row.currency, row.date);
  if (basic) return { ok: false, refusal: basic };
  if (!isCategory(row.category)) return no('category');
  if (!isSplitMethod(row.method)) return no('method');
  const gone = named(
    [...row.payers.map((p) => p.memberId), ...row.shares.map((s) => s.memberId)],
    context,
    onVersion,
  );
  if (gone) return { ok: false, refusal: gone };
  let payers: ExpenseRow['payers'];
  try {
    payers = checkPayers(row.amount, row.payers, context.order);
  } catch (error) {
    if (error instanceof SplitError) return no('payers');
    throw error;
  }
  let shares: ExpenseRow['shares'];
  try {
    shares = checkShares(row.amount, row.method, row.shares, context.order);
  } catch (error) {
    if (error instanceof SplitError) return no('shares');
    throw error;
  }
  return ok({ ...row, payers, shares });
}

/** A payment (§9): sealed note in form or none, a positive amount in a known currency, a real date, between two different members of the group. */
export function checkPayment(
  row: PaymentRow,
  context: GroupContext,
  onVersion: ReadonlySet<string> = new Set(),
): Checked<PaymentRow> {
  if (row.sealed !== null && !isSealed(row.sealed, context.epoch)) return no('sealed');
  const basic = amountCurrencyDate(row.amount, row.currency, row.date);
  if (basic) return { ok: false, refusal: basic };
  if (row.fromMemberId === row.toMemberId) return no('same_person');
  const gone = named([row.fromMemberId, row.toMemberId], context, onVersion);
  if (gone) return { ok: false, refusal: gone };
  return ok(row);
}

/** A comment (§8.6): its sealed body in form. Whether its expense or payment is the group's is the applier's, which reads it. */
export function checkComment(row: CommentRow, context: GroupContext): Checked<CommentRow> {
  if (!isSealed(row.sealed, context.epoch)) return no('sealed');
  return ok(row);
}

/**
 * A refusal in a sentence a person can read (§11.5): "Lisbon was closed", "You're no longer in Roomies", "Sam is no longer in this group". The names
 * come from the device, which can open them; the server never makes this sentence.
 */
export function refusalSentence(
  refusal: Refusal,
  names: { group?: string; member?: (memberId: string) => string | undefined } = {},
): string {
  const group = names.group ?? 'this group';
  switch (refusal.code) {
    case 'closed':
      return `${names.group ?? 'This group'} was closed.`;
    case 'not_in_group':
      return `You’re no longer in ${group}.`;
    case 'not_found':
      return names.group ? `${names.group} is no longer there.` : 'This is no longer there.';
    case 'member_gone': {
      const who = refusal.memberId ? names.member?.(refusal.memberId) : undefined;
      return `${who ?? 'Someone in it'} is no longer in ${names.group ?? 'this group'}.`;
    }
    case 'amount':
      return 'The amount must be more than zero.';
    case 'currency':
      return 'That currency is not one Tally knows.';
    case 'date':
      return 'That date is not a real day.';
    case 'category':
      return 'That category is not one Tally knows.';
    case 'method':
    case 'shares':
      return 'The split does not add up to the amount.';
    case 'payers':
      return 'What was paid does not add up to the amount.';
    case 'same_person':
      return 'A payment is between two different people.';
    case 'text':
      return refusal.field === 'description'
        ? 'A description is needed, of at most 200 characters.'
        : refusal.field === 'body'
          ? 'A comment needs some text, of at most 2,000 characters.'
          : 'A note can be at most 2,000 characters.';
    case 'not_author':
      return 'Only who wrote a comment can delete it.';
    case 'sealed':
    case 'malformed':
      return 'This could not be read. Update Tally, and try again.';
  }
}
