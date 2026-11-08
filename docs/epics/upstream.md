# Epic 14: Upstream, in `sovereign`

## Status

📋 Planned.

## Overview

What Tally needs from `sovereignfs/sovereign` before it can use it: parts of the design system it lacks, and a value the environment contract does not
allow yet. **The work is done in `sovereign`,** as that repository's own tasks, following its `AGENTS.md` (design system first, a story and a gallery
entry per component, a published release). These entries record what Tally needs, so that a Tally task can depend on them; each is marked done when
the release that carries it is published.

## Related

[`DESIGN.md`](../../DESIGN.md) §6.4, §15.10, §22 · `docs/specs/design-system.md` and `contracts/env.md` in `sovereign`

## Tasks

#### 📋 14.1 — Charts

**Goal:** charts in `@sovereignfs/ui`. **Design:** §13, §15.10. **Depends on:** nothing here.

**What Tally needs:** a bar chart (categories, groups, members) and a chart over time (months), token-coloured in light and dark, each with an
accessible table of the same data, no chart library loaded from elsewhere. Ledger needs the same (its §11.3, §14.5), so they are designed for both.

**Accepts when:** a `@sovereignfs/ui` release carrying them is published.

#### 📋 14.2 — `AvatarStack`

**Goal:** overlapping avatars with "+N". **Design:** §15.4, §15.5. **Depends on:** nothing here.

**What Tally needs:** a list of names (initials, since no picture is loaded from elsewhere) in a row, overlapping, with a count beyond a limit and an
accessible label naming everyone.

**Accepts when:** a `@sovereignfs/ui` release carrying it is published.

#### 📋 14.3 — A floating action button

**Goal:** the phone's Add. **Design:** §15.11. **Depends on:** nothing here.

**What Tally needs:** a floating button that sits above `MobileFooter` and respects the safe area, with an icon and an accessible label.

**Accepts when:** a `@sovereignfs/ui` release carrying it is published.

#### 📋 14.4 — `MoneyInput` and a currency picker

**Goal:** money typed in any currency. **Design:** §8.7, §15.9. **Depends on:** nothing here.

**What Tally needs:** `MoneyInput`, `CurrencyInput` bound to a currency's decimals (0, 2 or 3) with its code shown and changeable; a searchable currency
picker with the chosen currencies first. Ledger planned both as its own (its §14.5); two apps needing them is the reason they belong in the design
system, and the currency table they read moves with them or is passed in.

**Accepts when:** a `@sovereignfs/ui` release carrying them is published.

#### 📋 14.5 — `AUTH_SIGNUP` by invitation

**Goal:** `invite` as a value of the shared `AUTH_SIGNUP`. **Design:** §6.4. **Depends on:** nothing here.

**What Tally needs:** `contracts/env.md` to allow `invite` ("the first account, and anyone holding a valid invitation the app issued"), and
`@sovereignfs/config`'s declaration of the shared name to accept it, so that every app can offer it.

**Accepts when:** the contract change is merged and a `@sovereignfs/config` release accepting it is published.

#### 📋 14.6 — Tally's port in the guide

**Goal:** port 3004 recorded. **Design:** §22. **Depends on:** nothing here.

**What Tally needs:** building-an-app §2's ports table to list Tally's 3004 (and Ledger's 3003, if not already there).

**Accepts when:** the change is merged in `sovereign`.
