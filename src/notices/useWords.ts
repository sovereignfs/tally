'use client';

import { useMemo } from 'react';
import { useMemberNames, useOpenedLines } from '../activity/opened';
import { toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import { useGroupNames } from '../screens/hooks';
import { useGroupViews } from '../screens/useGroups';
import { useMe } from '../sync/react';
import type { NoticeRow } from './kinds';
import { noticeWords } from './words';

/** The words of each notice on the device: its line's text opened with the group's key, its people named from the device's rows (§12.2, §5.3). */
export function useNoticeWords(
  notices: readonly NoticeRow[] | null,
): (notice: NoticeRow) => string {
  const me = useMe();
  const views = useGroupViews();
  const names = useGroupNames(views?.map((v) => v.group) ?? []);
  const lines = useMemo(() => notices?.map((n) => n.line) ?? null, [notices]);
  const opened = useOpenedLines(lines);
  const members = useMemberNames();
  return (notice) =>
    noticeWords(
      notice,
      {
        readerPersonId: me?.personId ?? '',
        personOfMember: (memberId) => members.byMember.get(memberId),
        nameOf: (personId) => members.byPerson.get(personId),
        opened: (sealed) => opened.get(sealed),
        money: (amount, currency) => formatMoney(toMinor(amount), currency),
      },
      names[notice.groupId],
    );
}
