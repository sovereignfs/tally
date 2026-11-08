# Epic 10: Insights

## Status

📋 Planned.

## Overview

What was spent, as a person's share, per currency, never converted, computed on the device so that it works offline. Charts come from
`@sovereignfs/ui` (14.1).

## Related

[`DESIGN.md`](../../DESIGN.md) §13, §15.5

## Tasks

#### 📋 10.1 — The figures

**Goal:** every spending figure, pure. **Design:** §13. **Depends on:** 4.2.

**Technical:** `src/insights/`: a person's spending (their shares) by category for a month, by month for twelve months, and by group; a group's total
by category and by month, and each member's share; all per currency, ordered with the primary currency first; a month is read from an expense's own
date (`YYYY-MM-DD`), so no time zone is involved.

**Accepts when:** hand-worked fixtures across two groups and two currencies give the expected figures, and buying dinner for four counts a quarter.

#### 📋 10.2 — The screens

**Goal:** `/insights` and a group's Insights view. **Design:** §13, §15.5. **Depends on:** 10.1, 7.3, 14.1.

**Technical:** the charts from 14.1 with a table of the same figures beside each; a month picker; a currency switch when there is more than one; empty
states when there is nothing to show yet; from the device, offline too.

**Accepts when:** the screens show the fixtures' figures, and a screen reader reads the tables.
