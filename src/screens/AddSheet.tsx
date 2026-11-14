'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Drawer, ResponsiveSurface, Sheet } from '@sovereignfs/ui';
import { useGroupKeys } from '../sync/react';
import { AddExpenseForm, type Editing } from './AddExpense';
import { useGroupNames } from './hooks';
import { useGroupViews } from './useGroups';
import styles from './Screens.module.css';

/**
 * The sheets that open over any page (DESIGN.md §15.3, §15.9): `?add=expense`, with `&g=` to fill the group and `&e=` to edit an expense, so that a link
 * and the back button behave. A `Sheet` on a wide screen and a `Drawer` on a narrow one, the same content: only what is rendered forks. `N` opens it
 * wherever no field has focus; `Esc` closes it.
 */
export function AddSheet() {
  return (
    <Suspense fallback={null}>
      <AddSheetHost />
    </Suspense>
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
  const router = useRouter();
  const views = useGroupViews();
  const names = useGroupNames(views?.map((v) => v.group) ?? []);
  const keys = useGroupKeys();
  const adding = params.get('add') === 'expense';
  const groupFromAddress = params.get('g') ?? undefined;
  const editId = params.get('e');
  const [editing, setEditing] = useState<Editing | null | undefined>(undefined);

  const close = useCallback(
    () =>
      router.replace(sheetHref(pathname, params, { add: null, g: null, e: null }), {
        scroll: false,
      }),
    [router, pathname, params],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target) || adding) return;
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        router.push(sheetHref(pathname, params, { add: 'expense' }), { scroll: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, pathname, params, adding]);

  // An edit opens its expense's text on the device first.
  useEffect(() => {
    if (!adding || !editId || !views || !keys) return setEditing(undefined);
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
  }, [adding, editId, views, keys]);

  if (!adding || !views) return null;
  if (editId && editing === undefined) return null;
  const title = editId ? 'Edit expense' : 'Add expense';
  const content = (
    <div className={styles.sheet}>
      <AddExpenseForm
        key={`${editId ?? 'new'}:${groupFromAddress ?? ''}`}
        views={views}
        names={names}
        initialGroupId={groupFromAddress ?? lastGroup()}
        {...(editing ? { editing } : {})}
        onDone={close}
      />
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
