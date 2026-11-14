# Epic 10: Insights

## Status

✅ Done, with interim charts in Tally until `@sovereignfs/ui` has its own (14.1).

## Overview

What was spent, as a person's share, per currency, never converted, computed on the device so that it works offline. Charts come from
`@sovereignfs/ui` (14.1).

## Related

[`DESIGN.md`](../../DESIGN.md) §13, §15.5

## Tasks

#### ✅ 10.1 — The figures

**Goal:** every spending figure, pure. **Design:** §13. **Depends on:** 4.2.

**Technical:** `src/insights/`: a person's spending (their shares) by category for a month, by month for twelve months, and by group; a group's total
by category and by month, and each member's share; all per currency, ordered with the primary currency first; a month is read from an expense's own
date (`YYYY-MM-DD`), so no time zone is involved.

**Accepts when:** hand-worked fixtures across two groups and two currencies give the expected figures, and buying dinner for four counts a quarter.

**Done as:** `src/insights/index.ts`, pure, over plain rows (each expense's date, currency, category, deletion and shares; each group's reader
member), so that the screens read the device's rows through it and nothing else counts spending. The reader's spending by category for a month, by
month for the twelve months ending with a given one (every month listed, oldest first), and by group (over everything or a month); a group's spending
by category and by month, and each member's share (largest first, a tie in the group's member order). Each answer is a list of currencies, each with
its total and rows, the primary currency first and then by code; no figure blends two. Spending is the reader's share; a deleted expense and a group the
reader is not in count for nothing; payments are not spending; a month is the first seven characters of the expense's own date. Tests: a fixture
worked by hand across two groups and two currencies (a cent left over, a deleted expense, an expense the reader paid for but has no share in, one
thirteen months back, a group the reader is not in), every figure written out; the dinner for four seen failing when spending counted what was paid.

#### ✅ 10.2 — The screens

**Goal:** `/insights` and a group's Insights view. **Design:** §13, §15.5. **Depends on:** 10.1, 7.3, 14.1.

**Technical:** the charts from 14.1 with a table of the same figures beside each; a month picker; a currency switch when there is more than one; empty
states when there is nothing to show yet; from the device, offline too.

**Accepts when:** the screens show the fixtures' figures, and a screen reader reads the tables.

**Done as:** `/insights` and a group's Insights tab (`src/screens/InsightsView.tsx`), from the device's rows through `src/insights/`, so offline too
(the offline shell serves `/insights`, and the group's tab is the group page's). `/insights`: a month picker (the last 24 months), by category for that
month, by month for the twelve ending with it, and by group over everything. A group's tab: by category, by month for the last twelve, and each
member's share. A currency switch when the figures have more than one currency, the primary first; an empty state with nothing spent yet.
**Changed from the wording above:** the owner chose an interim on 2026-11-14 rather than waiting for 14.1: `src/ui/charts/` draws a bar chart and a
chart over months in the design system's tokens only, the drawing hidden from a screen reader, and beside each a table of the same figures with a
caption and a total, which is what a screen reader reads. They move to `@sovereignfs/ui` with 14.1. Tests: in Playwright, Chromium and WebKit, dinner
for four in a new group: the group's tab, with the network off, shows €100.00 of eating out and €25.00 for each member in its tables; `/insights`
shows the group's €25.00 in the reader's by-group table, eating out in the month's, and the twelve months; and on a phone neither Insights page, nor
Notifications, scrolls sideways.
