import { describe, expect, it } from 'vitest';
import type { DescribeContext } from '../activity/describe';
import type { NoticeRow } from './kinds';
import { ago, groupByDay, noticeHref, noticeWords } from './words';

/** What a notice says and where it goes (DESIGN.md §12.2), how long ago, and the days of `/notifications`: pure. */
const context: DescribeContext = {
  readerPersonId: 'me',
  personOfMember: (memberId) => ({ m1: 'ada', m2: 'me' })[memberId],
  nameOf: (personId) => ({ ada: 'Ada' })[personId],
  opened: (sealed) => (sealed === 's' ? { description: 'Dinner', note: null } : undefined),
  money: (amount, currency) => `${currency} ${(amount / 100).toFixed(2)}`,
};
const notice = (kind: NoticeRow['kind'], line: Partial<NoticeRow['line']>): NoticeRow => ({
  id: 'n',
  kind,
  groupId: 'g',
  read: false,
  createdAt: 1,
  line: {
    id: 'a',
    groupId: 'g',
    kind: 'expense_added',
    actorPersonId: 'ada',
    subjectId: 'e1',
    details: {},
    createdAt: 1,
    ...line,
  },
});

describe('a notice in words', () => {
  it('says the line it tells of, from the reader’s side, with the group', () => {
    const n = notice('expense_added', {
      details: {
        sealed: 's',
        amount: 900,
        currency: 'EUR',
        payers: [{ memberId: 'm1', amount: 900 }],
        shares: [],
      },
    });
    expect(noticeWords(n, context, 'Lisbon')).toBe('Ada paid EUR 9.00 for Dinner in Lisbon');
    expect(noticeHref(n)).toBe('/g/g/e/e1');
  });

  it('says the personal kinds for the person told', () => {
    expect(noticeWords(notice('added_to_group', { kind: 'member_added' }), context, 'Lisbon')).toBe(
      'Ada added you to Lisbon',
    );
    expect(
      noticeWords(notice('invite_accepted', { kind: 'member_joined' }), context, undefined),
    ).toBe('Ada took your invitation and joined');
    expect(
      noticeWords(
        notice('owner_passed', { kind: 'role_changed', actorPersonId: null }),
        context,
        'Lisbon',
      ),
    ).toBe('You are an owner of Lisbon now: its last owner left Tally');
  });

  it('opens a comment on a payment at the payment, and the rest at the group', () => {
    expect(
      noticeHref(notice('comment', { kind: 'comment_added', details: { subject: 'payment' } })),
    ).toBe('/g/g/p/e1');
    expect(noticeHref(notice('group_closed', { kind: 'group_closed', subjectId: 'g' }))).toBe(
      '/g/g',
    );
  });
});

describe('time', () => {
  it('says how long ago', () => {
    const now = Date.UTC(2026, 10, 14, 12);
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5m ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(ago(now - 2 * 86_400_000, now)).toBe('2d ago');
    expect(ago(now + 5_000, now)).toBe('just now');
  });

  it('groups by the reader’s day, newest first', () => {
    const now = Date.UTC(2026, 10, 14, 12);
    const days = groupByDay(
      [
        { id: 'a', createdAt: Date.UTC(2026, 10, 14, 9) },
        { id: 'b', createdAt: Date.UTC(2026, 10, 13, 23) },
        { id: 'c', createdAt: Date.UTC(2026, 10, 10, 9) },
        { id: 'd', createdAt: Date.UTC(2026, 10, 14, 10) },
      ],
      now,
      'UTC',
      'en',
    );
    expect(days.map((d) => [d.label, d.notices.map((n) => n.id)])).toEqual([
      ['Today', ['d', 'a']],
      ['Yesterday', ['b']],
      ['Tue, Nov 10', ['c']],
    ]);
    // In Tokyo, 23:00 UTC on the 13th is the 14th.
    expect(
      groupByDay([{ id: 'b', createdAt: Date.UTC(2026, 10, 13, 23) }], now, 'Asia/Tokyo')[0]?.label,
    ).toBe('Today');
  });
});
