'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RowBinding } from '../cipher/seal';
import { useGroupViews } from '../screens/useGroups';
import { useGroupKeys } from '../sync/react';
import type { ActivityLine } from './kinds';

/**
 * What lines of activity need to be said in words on the device (DESIGN.md §12.1, §5.3), shared by Activity and the bell: the sealed text they carry,
 * opened with each group's key, and the names of the members they point at, from the device's own rows.
 */
export function useOpenedLines(
  lines:
    readonly (Pick<ActivityLine, 'kind' | 'groupId' | 'subjectId'> & { details: unknown })[] | null,
): Map<string, Record<string, string | null>> {
  const keys = useGroupKeys();
  const [opened, setOpened] = useState<Map<string, Record<string, string | null>>>(new Map());
  useEffect(() => {
    if (!keys || !lines) return;
    let live = true;
    const wanted: { sealed: string; binding: RowBinding }[] = [];
    for (const line of lines) {
      const d = line.details as Record<string, unknown>;
      if (line.kind.startsWith('expense_') && typeof d.sealed === 'string')
        wanted.push({
          sealed: d.sealed,
          binding: { group: line.groupId, table: 'expense', row: line.subjectId ?? '' },
        });
      if (line.kind === 'comment_added') {
        if (typeof d.sealed === 'string' && typeof d.commentId === 'string')
          wanted.push({
            sealed: d.sealed,
            binding: { group: line.groupId, table: 'comment', row: d.commentId },
          });
        if (typeof d.subjectSealed === 'string')
          wanted.push({
            sealed: d.subjectSealed,
            binding: { group: line.groupId, table: 'expense', row: line.subjectId ?? '' },
          });
      }
      if (
        (line.kind === 'group_created' || line.kind === 'group_renamed') &&
        typeof d.sealed === 'string'
      )
        wanted.push({
          sealed: d.sealed,
          binding: { group: line.groupId, table: 'grp', row: line.groupId },
        });
    }
    void Promise.all(
      wanted.map(async (w) => [w.sealed, await keys.openText(w.sealed, w.binding)] as const),
    ).then((pairs) => {
      if (!live) return;
      const map = new Map<string, Record<string, string | null>>();
      for (const [sealed, content] of pairs) if (content) map.set(sealed, content);
      setOpened(map);
    });
    return () => {
      live = false;
    };
  }, [keys, lines]);
  return opened;
}

/** Every member of the reader's groups, as their person, and every person's name, from the device's rows. */
export function useMemberNames(): {
  byMember: Map<string, string>;
  byPerson: Map<string, string>;
} {
  const views = useGroupViews();
  return useMemo(() => {
    const byMember = new Map<string, string>();
    const byPerson = new Map<string, string>();
    for (const view of views ?? [])
      for (const m of view.members) {
        byMember.set(m.id, m.personId);
        byPerson.set(m.personId, m.name);
      }
    return { byMember, byPerson };
  }, [views]);
}
