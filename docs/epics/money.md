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

#### 📋 4.2 — Splitting and rounding

**Goal:** the four methods, one rounding rule. **Design:** §8.3. **Depends on:** 4.1.

**Technical:** `src/money/split.ts`: from an amount, a method, member inputs and the group's member order, the shares in minor units; rounding down then
the leftover units one each in member order; the inverse check (do these shares match this method and input?) used by the server; payers' and amounts'
sums; a test per method and currency decimals, and a property test that shares always add up and do not depend on the input's order.

**Accepts when:** 100.00 split three ways equally gives 33.34, 33.33, 33.33 by member order on every run; percentages not totalling 100.00% and amounts
not adding up are refused; the property test passes.

#### 📋 4.3 — Balances, pairwise and simplified

**Goal:** every figure of who owes whom. **Design:** §10.1, §10.2, §10.3. **Depends on:** 4.2.

**Technical:** `src/balances/`: a member's balance per currency; pairwise debts from each expense's shares divided among its payers by the same
rounding rule, reduced by payments, netted per pair and currency; simplified suggestions (greedy minimum cash flow, ties by member order); the
suggestions for a group by its setting; property tests: balances add up to zero per group and currency, pairwise debts add up to the balance, applying
the suggestions settles everyone, results do not depend on row order.

**Accepts when:** hand-worked fixtures with several payers, every method, payments and two currencies give the expected figures; the property tests
pass.

#### 📋 4.4 — Across groups

**Goal:** what lies between two people, and a person's whole position. **Design:** §10.4. **Depends on:** 4.3.

**Technical:** from several groups' rows: for the reader and one other person, per currency and per group, the pairwise debt or, with simplify on, the
suggested payments between them; for the reader alone, owed and owing per currency, ordered with the primary currency first; the list of payments that
"settle up with a person" would record (§9).

**Accepts when:** a person shared across two groups in two currencies shows both figures, never one; the settle-up list zeroes every pair when applied.
