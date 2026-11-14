'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { type AnchorHTMLAttributes, Suspense, useCallback, useEffect, useState } from 'react';
import { Drawer, ResponsiveSurface, Sheet } from '@sovereignfs/ui';
import { useGroupKeys } from '../sync/react';
import { AddExpenseForm, type Editing } from './AddExpense';
import { AddPaymentForm } from './AddPayment';
import { useGroupNames } from './hooks';
import { useGroupViews } from './useGroups';
import styles from './Screens.module.css';

/**
 * The sheets that open over any page (DESIGN.md §15.3, §15.9): `?add=expense`, with `&g=` to fill the group and `&e=` to edit an expense, so that a link
 * and the back button behave; `?add=payment` records a payment (filled from `from`, `to`, `amount`, `currency`, or `p` to edit one). A `Sheet` on a wide screen and a `Drawer` on a narrow one, the same content: only what is rendered forks. `N` and `P` open them
 * wherever no field has focus; `Esc` closes it.
 */
export function AddSheet() {
  return (
    <Suspense fallback={null}>
      <AddSheetHost />
    </Suspense>
  );
}

/**
 * Changes the address in the browser alone (`history.pushState`/`replaceState`, which Next keeps `useSearchParams` in step with): opening and closing a
 * sheet, a group's view and its filters are the page's own state, so they need no request to the server, and two in a row cannot arrive out of order.
 */
export function goLocally(href: string, how: 'push' | 'replace' = 'push') {
  if (how === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
}

/** A link that opens a sheet or a view over this page, locally (`goLocally`), and is still a link for a middle click or a copied address. */
export function LocalLink({
  href,
  onClick,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.button !== 0
        )
          return;
        event.preventDefault();
        goLocally(href);
      }}
    >
      {children}
    </a>
  );
}

/** The address of the page with a sheet's parameters set, or taken away. */
export function sheetHref(
  pathname: string,
  params: URLSearchParams,
  set: Record<string, string | null>,
): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(set)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function AddSheetHost() {
  const params = useSearchParams();
  const pathname = usePathname();
  const views = useGroupViews();
  const names = useGroupNames(views?.map((v) => v.group) ?? []);
  const keys = useGroupKeys();
  const kind = params.get('add');
  const adding = kind === 'expense' || kind === 'payment';
  // The group named in the address, or the group whose page this is (§15.9: opened from a group, the group is filled in).
  const groupFromAddress = params.get('g') ?? /^\/g\/([^/]+)/.exec(pathname)?.[1] ?? undefined;
  const editId = kind === 'payment' ? params.get('p') : params.get('e');
  const [editing, setEditing] = useState<Editing | null | undefined>(undefined);

  const close = useCallback(
    () =>
      goLocally(
        sheetHref(pathname, params, {
          add: null,
          g: null,
          e: null,
          p: null,
          from: null,
          to: null,
          amount: null,
          currency: null,
        }),
        'replace',
      ),
    [pathname, params],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target) || adding) return;
      const sheet =
        event.key === 'n' || event.key === 'N'
          ? 'expense'
          : event.key === 'p' || event.key === 'P'
            ? 'payment'
            : null;
      if (sheet) {
        event.preventDefault();
        goLocally(sheetHref(pathname, params, { add: sheet }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pathname, params, adding]);

  // An edit opens its row's text on the device first.
  useEffect(() => {
    if (!adding || !editId || !views || !keys) return setEditing(undefined);
    if (kind === 'payment') {
      const view = views.find((v) => v.payments.some((x) => x.id === editId));
      const payment = view?.payments.find((x) => x.id === editId);
      if (!view || !payment) return setEditing(null);
      let live = true;
      void (
        payment.sealed
          ? keys.openText(payment.sealed, {
              group: view.group.id,
              table: 'payment',
              row: payment.id,
            })
          : Promise.resolve(undefined)
      ).then((text) => {
        if (live)
          setEditing({
            id: payment.id,
            version: payment.version,
            description: '',
            note: typeof text?.note === 'string' ? text.note : null,
          });
      });
      return () => {
        live = false;
      };
    }
    const view = views.find((v) => v.expenses.some((e) => e.id === editId));
    const expense = view?.expenses.find((e) => e.id === editId);
    if (!view || !expense) return setEditing(null);
    let live = true;
    void keys
      .openText(expense.sealed, { group: view.group.id, table: 'expense', row: expense.id })
      .then((text) => {
        if (live)
          setEditing({
            id: expense.id,
            version: expense.version,
            description: typeof text?.description === 'string' ? text.description : '',
            note: typeof text?.note === 'string' ? text.note : null,
          });
      });
    return () => {
      live = false;
    };
  }, [adding, kind, editId, views, keys]);

  if (!adding || !views) return null;
  if (editId && editing === undefined) return null;
  const title =
    kind === 'payment'
      ? editId
        ? 'Edit payment'
        : 'Record a payment'
      : editId
        ? 'Edit expense'
        : 'Add expense';
  const prefillAmount = Number(params.get('amount'));
  const content = (
    <div className={styles.sheet}>
      {kind === 'payment' ? (
        <AddPaymentForm
          key={`${editId ?? 'new'}:${groupFromAddress ?? ''}:${params.get('from') ?? ''}:${params.get('to') ?? ''}`}
          views={views}
          names={names}
          initialGroupId={groupFromAddress ?? lastGroup()}
          prefill={{
            ...(params.get('from') ? { from: params.get('from') as string } : {}),
            ...(params.get('to') ? { to: params.get('to') as string } : {}),
            ...(Number.isSafeInteger(prefillAmount) && prefillAmount > 0
              ? { amount: prefillAmount }
              : {}),
            ...(params.get('currency') ? { currency: params.get('currency') as string } : {}),
          }}
          {...(editing
            ? { editing: { id: editing.id, version: editing.version, note: editing.note } }
            : {})}
          onDone={close}
        />
      ) : (
        <AddExpenseForm
          key={`${editId ?? 'new'}:${groupFromAddress ?? ''}`}
          views={views}
          names={names}
          initialGroupId={groupFromAddress ?? lastGroup()}
          {...(editing ? { editing } : {})}
          onDone={close}
        />
      )}
    </div>
  );
  return (
    <ResponsiveSurface
      web={
        <Sheet open onClose={close} title={title} aria-label={title}>
          {content}
        </Sheet>
      }
      mobile={
        <Drawer open onClose={close} title={title} aria-label={title}>
          {content}
        </Drawer>
      }
    />
  );
}

function lastGroup(): string | undefined {
  try {
    return window.localStorage.getItem('tally.lastGroup') ?? undefined;
  } catch {
    return undefined;
  }
}
