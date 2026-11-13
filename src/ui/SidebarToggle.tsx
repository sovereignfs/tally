'use client';

import { useSyncExternalStore } from 'react';
import { Icon } from '@sovereignfs/ui';
import { chooseSidebar, type SidebarChoice } from '@/src/theme/preferences';

/** Where the choice is read from: the attribute the script set before first paint, which this button keeps in step. */
function current(): SidebarChoice {
  return document.documentElement.getAttribute('data-sidebar') === 'rail' ? 'rail' : 'full';
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The header's ☰ (DESIGN.md §15.2): a full sidebar becomes a rail of icons and a rail becomes full, remembered in this browser. On a phone, which has
 * no sidebar, the stylesheet hides it. The server draws the full sidebar's label; the page corrects it at once if a rail was chosen.
 */
export function SidebarToggle({ className }: { className?: string }) {
  const state = useSyncExternalStore(subscribe, current, () => 'full' as const);
  const label = state === 'rail' ? 'Widen the sidebar' : 'Narrow the sidebar';
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      aria-pressed={state === 'rail'}
      onClick={() => {
        const storage = (() => {
          try {
            return window.localStorage;
          } catch {
            return undefined;
          }
        })();
        chooseSidebar(state === 'rail' ? 'full' : 'rail', document.documentElement, storage);
        for (const listener of listeners) listener();
      }}
    >
      <Icon name="menu" aria-hidden />
    </button>
  );
}
