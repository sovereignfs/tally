# Epic 10: Insights

## Status

🚧 In progress: the figures are done; the screens wait for charts in `@sovereignfs/ui` (14.1).

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

#### 📋 10.2 — The screens

**Goal:** `/insights` and a group's Insights view. **Design:** §13, §15.5. **Depends on:** 10.1, 7.3, 14.1.

**Technical:** the charts from 14.1 with a table of the same figures beside each; a month picker; a currency switch when there is more than one; empty
states when there is nothing to show yet; from the device, offline too.

**Accepts when:** the screens show the fixtures' figures, and a screen reader reads the tables.
