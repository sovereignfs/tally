'use client';

import { useEffect, useState } from 'react';
import type { RowBinding } from '../cipher/seal';
import { useGroupKeys, useStoreChanges } from '../sync/react';

/**
 * What a screen opens of what people wrote (DESIGN.md §5.3): each sealed value opened in memory with the group's key, on the device. A value that cannot
 * be opened yet (the group is not unlocked here) is `undefined`, and the screen says "…" or a plain word instead.
 */
export function useOpened(
  items: readonly { sealed: string | null; binding: RowBinding }[],
): (Record<string, string | null> | undefined)[] {
  const keys = useGroupKeys();
  // A store change may be a key that arrived, so what could not be opened is tried again.
  const changes = useStoreChanges();
  const signature = items
    .map((i) => `${i.binding.group}:${i.binding.table}:${i.binding.row}:${i.sealed ?? ''}`)
    .join('|');
  const [opened, setOpened] = useState<(Record<string, string | null> | undefined)[]>([]);
  useEffect(() => {
    if (!keys) return;
    let live = true;
    void Promise.all(
      items.map((i) =>
        i.sealed ? keys.openText(i.sealed, i.binding) : Promise.resolve(undefined),
      ),
    ).then((values) => live && setOpened(values));
    return () => {
      live = false;
    };
    // `items` is described by `signature`.
  }, [keys, signature, changes]);
  return opened;
}

/** The names of groups, opened on the device, by id. */
export function useGroupNames(
  groups: readonly { id: string; sealed: string }[],
): Record<string, string | undefined> {
  const opened = useOpened(
    groups.map((g) => ({ sealed: g.sealed, binding: { group: g.id, table: 'grp', row: g.id } })),
  );
  const out: Record<string, string | undefined> = {};
  groups.forEach((g, i) => {
    const name = opened[i]?.name;
    out[g.id] = typeof name === 'string' ? name : undefined;
  });
  return out;
}
