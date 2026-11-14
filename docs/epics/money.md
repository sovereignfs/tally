# Epic 4: Money and balances

## Status

📋 Planned.

## Overview

The arithmetic, pure and shared by the browser and the server: currencies and minor units, splitting with one rounding rule, balances, who owes whom
pairwise or simplified, and the view across groups. Nothing here touches a database or a clock; every function takes rows and returns figures, and the
property tests of `DESIGN.md` §20 live here.

## Related

[`DESIGN.md`](../../DESIGN.md) §8.3, §8.7, §10

## Tasks

#### ✅ 4.1 — Money and currencies

**Goal:** amounts that are always integers of a currency's minor unit. **Design:** §8.7. **Depends on:** 1.5.

**Technical:** `src/money/`: the currency table and `pnpm generate:currencies` copied from Ledger (ICU, fiat only, decimals per currency); parsing
typed amounts to minor units and formatting them in a locale (`Intl.NumberFormat`), with the code where it could be mistaken; a safe-integer check.

**Accepts when:** JPY, EUR and BHD amounts round-trip from typing to minor units to text in two locales; a float never reaches an amount (a lint rule or
a type).

**Done as:** from Ledger's `src/money/`: `currencies.ts` and `scripts/generate-currencies.ts` (`pnpm generate:currencies`; the same 160 ICU
currencies, fiat only, without Ledger's exchange-rate pivot), `text.ts` (`decimalText`, `formatMoney`, `parseAmount`, through decimal text and never a
float) and their tests. `amount.ts` is Ledger's without its half-to-even division and its split, which are not Tally's (4.2 writes Tally's rounding
rule). **A float never reaches an amount by type:** `Minor` is a branded number, made only by `toMinor` (which checks it) and the arithmetic here;
`amount.types.test.ts` has four `@ts-expect-error` lines a float or an unchecked number would need, and `pnpm typecheck` failed when `Minor` was made
a plain number. A test round-trips JPY 1,500, EUR 1,234.56 and BHD 1.005 from typing to minor units to text and back, in English and in German.

#### ✅ 4.2 — Splitting and rounding

**Goal:** the four methods, one rounding rule. **Design:** §8.3. **Depends on:** 4.1.

**Technical:** `src/money/split.ts`: from an amount, a method, member inputs and the group's member order, the shares in minor units; rounding down then
the leftover units one each in member order; the inverse check (do these shares match this method and input?) used by the server; payers' and amounts'
sums; a test per method and currency decimals, and a property test that shares always add up and do not depend on the input's order.

**Accepts when:** 100.00 split three ways equally gives 33.34, 33.33, 33.33 by member order on every run; percentages not totalling 100.00% and amounts
not adding up are refused; the property test passes.

**Done as:** `src/money/split.ts`, Tally's own (Ledger's half-to-even split is not carried over). Every method comes down to weights through one
`distribute`: each part rounded down in integer `bigint` arithmetic, then the units left over one each to members with a weight, in the group's member
order (`memberOrder`: joined, then id), so the form's order never matters. `computeShares` makes the shares and refuses an amount not above zero,
nobody, someone twice or not in the group, units that are not the method's (a weight up to 1,000 shares), percentages not totalling 100.00% and
amounts not adding up; `checkShares` is the server's inverse check (shares rounded any other way are `MISMATCH`, even when they add up);
`checkPayers` checks payers (§8.2). Errors are a `SplitError` with a code and no amount or name. The property tests run on a seeded generator
(`src/testing/random.ts`, no new dependency): over 2,000 random splits in every method, shares add up, are never negative, do not depend on the input's
order and pass the server's check; no part is more than one unit from its exact value. The tests failed when the leftover was given in reverse order.

#### ✅ 4.3 — Balances, pairwise and simplified

**Goal:** every figure of who owes whom. **Design:** §10.1, §10.2, §10.3. **Depends on:** 4.2.

**Technical:** `src/balances/`: a member's balance per currency; pairwise debts from each expense's shares divided among its payers by the same
rounding rule, reduced by payments, netted per pair and currency; simplified suggestions (greedy minimum cash flow, ties by member order); the
suggestions for a group by its setting; property tests: balances add up to zero per group and currency, pairwise debts add up to the balance, applying
the suggestions settles everyone, results do not depend on row order.

**Accepts when:** hand-worked fixtures with several payers, every method, payments and two currencies give the expected figures; the property tests
pass.

**Done as:** `src/balances/index.ts`: `balances` (per currency and member, everyone who took part, ordered by code and member order), `pairwiseDebts`,
`simplifiedPayments` (greedy, the largest debtor to the largest creditor, ties by member order), `suggestedPayments` by the group's setting, and
`asPayments` to record suggestions. Deleted rows count for nothing. **Two corrections to `DESIGN.md`**, made there: §10.1 had the signs of payments the
wrong way round (a payment made raises the giver's balance), and §10.2's "each share divided by what each paid" rounds a payer's pieces apart from what
they paid (the property test caught it, two units out on its first seed); the shares are now taken in member order, each divided by what the payers
have left, so the pieces add up to every share and to every payment of the expense. Property tests, over random rows of every method, three currencies
(JPY, EUR, BHD), several payers, payments and deletions: balances add up to zero; a member's pairwise debts add up to their balance; recording the
suggestions settles everyone (and pairwise, every pair); simplified needs fewer payments than there are people with a balance; nothing depends on the
order of rows, payers or shares.

#### 📋 4.4 — Across groups

**Goal:** what lies between two people, and a person's whole position. **Design:** §10.4. **Depends on:** 4.3.

**Technical:** from several groups' rows: for the reader and one other person, per currency and per group, the pairwise debt or, with simplify on, the
suggested payments between them; for the reader alone, owed and owing per currency, ordered with the primary currency first; the list of payments that
"settle up with a person" would record (§9).

**Accepts when:** a person shared across two groups in two currencies shows both figures, never one; the settle-up list zeroes every pair when applied.
