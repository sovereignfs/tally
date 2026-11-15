import {
  type GroupContext,
  checkCommentText,
  checkExpense,
  checkExpenseText,
  checkPayment,
  checkPaymentText,
  isDate,
} from '../actions/validate';
import { isCategory } from '../actions/categories';
import { isGroupColor } from '../groups/colors';
import { toMinor } from '../money/amount';
import { isSupportedCurrencyCode } from '../money/currencies';
import { isSplitMethod } from '../money/split';
import { cleanName } from '../people/persons';
import { type ExportFile, FORMAT, VERSION } from './format';

/**
 * **A file to import, checked whole** (DESIGN.md §17), in the browser before anything is sealed or sent, and pure. Every figure is held to the
 * same rules a change is (`src/actions/validate.ts`): amounts in minor units, a known currency and category, payers adding up and shares exactly
 * what the split method gives, everyone named a member of the group. A file from a newer version is refused with a sentence that says so; anything
 * else wrong is refused as not a file this can read. What a file left out because it could not be opened (null text) comes in as plain words.
 */
export const MAX_GROUPS_IN_FILE = 100;
export const MAX_ROWS_IN_GROUP = 20_000;
/** A text with nothing to seal stands for what the export could not open. */
export const UNOPENED_DESCRIPTION = 'An expense';

export type Validated = { ok: true; file: ExportFile } | { ok: false; message: string };

const NOT_A_FILE = 'That is not a Tally export, or it is damaged. Nothing was imported.';
const refuse = (message = NOT_A_FILE): Validated => ({ ok: false, message });

/** A sealed value in the right form, for holding plain rows to the change's checks, which want one. */
const STAND_IN = `s1.1.${'A'.repeat(80)}`;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, most: number): v is string => typeof v === 'string' && v.length <= most;
const isTime = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);

export function validateFile(raw: unknown): Validated {
  if (!isObject(raw) || raw.format !== FORMAT || typeof raw.version !== 'number') return refuse();
  if (raw.version > VERSION)
    return refuse(
      `This file was made by a newer Tally (its version is ${raw.version}, and this one reads ${VERSION}). Update this Tally to import it.`,
    );
  if (raw.version !== VERSION) return refuse();
  const profile = raw.profile;
  if (!isObject(profile) || !Array.isArray(raw.groups) || raw.groups.length > MAX_GROUPS_IN_FILE)
    return refuse();
  if (raw.groups.length === 0)
    return refuse('That file has no groups in it. Nothing was imported.');

  const groups: ExportFile['groups'] = [];
  for (const g of raw.groups as unknown[]) {
    if (
      !isObject(g) ||
      !isId(g.id) ||
      !Array.isArray(g.members) ||
      !Array.isArray(g.expenses) ||
      !Array.isArray(g.payments)
    )
      return refuse();
    if (g.name !== null && !isText(g.name, 100)) return refuse();
    if (
      !isGroupColor(g.color) ||
      typeof g.defaultCurrency !== 'string' ||
      !isSupportedCurrencyCode(g.defaultCurrency)
    )
      return refuse();
    if (typeof g.simplifyDebts !== 'boolean') return refuse();
    if (g.members.length === 0 || g.members.length > 50) return refuse();
    if (g.expenses.length + g.payments.length > MAX_ROWS_IN_GROUP) return refuse();

    const members: ExportFile['groups'][number]['members'] = [];
    for (const m of g.members as unknown[]) {
      if (
        !isObject(m) ||
        !isId(m.id) ||
        !isText(m.name, 200) ||
        !cleanName(m.name) ||
        !isTime(m.joinedAt)
      )
        return refuse();
      if (m.leftAt !== null && !isTime(m.leftAt)) return refuse();
      members.push({
        id: m.id,
        name: cleanName(m.name),
        role: m.role === 'owner' || m.role === 'member' ? m.role : null,
        placeholder: m.placeholder === true,
        leftTally: m.leftTally === true,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
      });
    }
    const ids = new Set(members.map((m) => m.id));
    if (ids.size !== members.length) return refuse();
    if (g.yourMemberId !== null && !(isId(g.yourMemberId) && ids.has(g.yourMemberId)))
      return refuse();
    const context: GroupContext = {
      order: [...members]
        .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
        .map((m) => m.id),
      active: ids,
      epoch: 1,
    };
    const comments = (
      list: unknown,
    ): ExportFile['groups'][number]['expenses'][number]['comments'] | undefined => {
      if (!Array.isArray(list)) return undefined;
      const out: ExportFile['groups'][number]['expenses'][number]['comments'] = [];
      for (const c of list as unknown[]) {
        if (!isObject(c) || !isId(c.id) || !isTime(c.createdAt)) return undefined;
        if (c.authorMemberId !== null && !(isId(c.authorMemberId) && ids.has(c.authorMemberId)))
          return undefined;
        // A comment the export could not open has nothing to bring.
        if (c.body === null) continue;
        if (typeof c.body !== 'string') return undefined;
        const body = checkCommentText({ body: c.body });
        if (!body.ok) return undefined;
        out.push({
          id: c.id,
          authorMemberId: c.authorMemberId,
          body: body.value.body,
          createdAt: c.createdAt,
        });
      }
      return out;
    };

    const expenses: ExportFile['groups'][number]['expenses'] = [];
    for (const e of g.expenses as unknown[]) {
      if (
        !isObject(e) ||
        !isId(e.id) ||
        !isTime(e.createdAt) ||
        !Array.isArray(e.payers) ||
        !Array.isArray(e.shares)
      )
        return refuse();
      if (typeof e.amount !== 'number' || typeof e.currency !== 'string' || !isDate(e.date))
        return refuse();
      if (!isCategory(e.category) || !isSplitMethod(e.method)) return refuse();
      const payers = (e.payers as unknown[]).map((p) =>
        isObject(p) && isId(p.memberId) && typeof p.amount === 'number'
          ? { memberId: p.memberId, amount: p.amount }
          : null,
      );
      const shares = (e.shares as unknown[]).map((s) =>
        isObject(s) &&
        isId(s.memberId) &&
        typeof s.amount === 'number' &&
        (s.units === null || typeof s.units === 'number')
          ? { memberId: s.memberId, amount: s.amount, units: s.units as number | null }
          : null,
      );
      if (payers.some((p) => p === null) || shares.some((s) => s === null)) return refuse();
      let checked;
      try {
        checked = checkExpense(
          {
            sealed: STAND_IN,
            amount: toMinor(e.amount),
            currency: e.currency,
            date: e.date,
            category: e.category,
            method: e.method,
            payers: payers.map((p) => ({
              memberId: p?.memberId ?? '',
              amount: toMinor(p?.amount),
            })),
            shares: shares.map((s) => ({
              memberId: s?.memberId ?? '',
              amount: toMinor(s?.amount),
              units: s?.units ?? null,
            })),
          },
          context,
        );
      } catch {
        return refuse();
      }
      if (!checked.ok) return refuse();
      if (
        (e.description !== null && typeof e.description !== 'string') ||
        (e.note !== null && typeof e.note !== 'string')
      )
        return refuse();
      const text = checkExpenseText({
        description: e.description ?? UNOPENED_DESCRIPTION,
        note: e.note,
      });
      if (!text.ok) return refuse();
      const list = comments(e.comments);
      if (!list) return refuse();
      expenses.push({
        id: e.id,
        date: e.date,
        category: e.category,
        amount: e.amount,
        currency: e.currency,
        method: e.method,
        description: text.value.description,
        note: text.value.note,
        payers: checked.value.payers.map((p) => ({ memberId: p.memberId, amount: p.amount })),
        shares: checked.value.shares.map((s) => ({
          memberId: s.memberId,
          amount: s.amount,
          units: s.units,
        })),
        createdAt: e.createdAt,
        comments: list,
      });
    }

    const payments: ExportFile['groups'][number]['payments'] = [];
    for (const p of g.payments as unknown[]) {
      if (!isObject(p) || !isId(p.id) || !isTime(p.createdAt) || typeof p.amount !== 'number')
        return refuse();
      if (
        typeof p.currency !== 'string' ||
        !isDate(p.date) ||
        !isId(p.fromMemberId) ||
        !isId(p.toMemberId)
      )
        return refuse();
      let checked;
      try {
        checked = checkPayment(
          {
            sealed: null,
            fromMemberId: p.fromMemberId,
            toMemberId: p.toMemberId,
            amount: toMinor(p.amount),
            currency: p.currency,
            date: p.date,
          },
          context,
        );
      } catch {
        return refuse();
      }
      if (!checked.ok) return refuse();
      if (p.note !== null && typeof p.note !== 'string') return refuse();
      const note = checkPaymentText({ note: p.note });
      const list = comments(p.comments);
      if (!note.ok || !list) return refuse();
      payments.push({
        id: p.id,
        date: p.date,
        amount: p.amount,
        currency: p.currency,
        fromMemberId: p.fromMemberId,
        toMemberId: p.toMemberId,
        note: note.value.note,
        createdAt: p.createdAt,
        comments: list,
      });
    }
    groups.push({
      id: g.id,
      name: g.name ?? null,
      color: g.color,
      defaultCurrency: g.defaultCurrency,
      simplifyDebts: g.simplifyDebts,
      closedAt: null,
      yourMemberId: g.yourMemberId,
      members,
      expenses,
      payments,
    });
  }
  return {
    ok: true,
    file: {
      format: FORMAT,
      version: VERSION,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      profile: {
        name: isText(profile.name, 200) ? profile.name : '',
        email: isText(profile.email, 254) ? profile.email : '',
        primaryCurrency: typeof profile.primaryCurrency === 'string' ? profile.primaryCurrency : '',
        notifications: {},
      },
      groups,
      unopened: 0,
    },
  };
}
