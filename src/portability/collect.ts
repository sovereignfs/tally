'use client';

import type { RowBinding } from '../cipher/seal';
import type { LocalDatabase } from '../local/db';
import { readGroupRows, readGroups } from '../local/store';
import { type ExportFile, type GroupInput, buildExport } from './format';

/**
 * **The export, made in the browser** (DESIGN.md §17): every group in the device's store, read whole, and what people wrote opened with each group's
 * key here, since the server cannot open it (§5.3). What cannot be opened yet (a group not unlocked on this device) is left out and counted, and the
 * screen says so.
 */
export interface TextOpener {
  openText(sealed: string, binding: RowBinding): Promise<Record<string, string | null> | undefined>;
}

export async function makeExport(input: {
  db: LocalDatabase;
  keys: TextOpener | null;
  personId: string;
  profile: ExportFile['profile'];
  now: number;
}): Promise<ExportFile> {
  const groups: GroupInput[] = [];
  for (const group of await readGroups(input.db)) {
    const rows = await readGroupRows(input.db, group.id);
    if (!rows.group) continue;
    groups.push({
      group: rows.group,
      members: rows.members,
      expenses: rows.expenses,
      payments: rows.payments,
      comments: rows.comments,
    });
  }
  // Every sealed text, opened once, by the row it belongs to.
  const wanted: { sealed: string; binding: RowBinding }[] = [];
  for (const g of groups) {
    const group = g.group.id;
    wanted.push({ sealed: g.group.sealed, binding: { group, table: 'grp', row: group } });
    for (const e of g.expenses)
      wanted.push({ sealed: e.sealed, binding: { group, table: 'expense', row: e.id } });
    for (const p of g.payments)
      if (p.sealed)
        wanted.push({ sealed: p.sealed, binding: { group, table: 'payment', row: p.id } });
    for (const c of g.comments)
      wanted.push({ sealed: c.sealed, binding: { group, table: 'comment', row: c.id } });
  }
  const opened = new Map<string, Record<string, string | null>>();
  for (const w of wanted) {
    const content = await input.keys?.openText(w.sealed, w.binding).catch(() => undefined);
    if (content) opened.set(w.sealed, content);
  }
  return buildExport({
    profile: input.profile,
    personId: input.personId,
    groups,
    opened: (sealed) => opened.get(sealed),
    now: input.now,
  });
}

/** The file's name: the app's, and the day. */
export const exportFileName = (now: number) =>
  `tally-export-${new Date(now).toISOString().slice(0, 10)}.json`;
