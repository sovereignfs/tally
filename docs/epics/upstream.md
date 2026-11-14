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

**Not yet, and an interim in Tally for charts too (decided by the owner on 2026-11-14):** Tally draws a bar chart and a chart over
months of its own in `src/ui/charts/`, in the design system's tokens only, each with a table of the same figures, no chart library; they are to move
here, and be replaced in Tally by the release, when this task is done.

**The money input, the same way (decided by the owner on 2026-11-14):** `@sovereignfs/ui` 0.96.1 has `CurrencyInput` with a currency's own
decimals but no picker, and it turns typed text into an amount through floating point (`Math.round(parsed * 10 ** decimals)`), which Tally's rule
forbids. Until this task lands, Tally composes its own money input and currency picker in `src/ui/` from the published `Input` and `Combobox`, with
`src/money/text.ts`'s exact parsing; they are to move here, and be replaced in Tally by the release, when this task is done.

#### ✅ 14.2 — `AvatarStack`

**Goal:** overlapping avatars with "+N". **Design:** §15.4, §15.5. **Depends on:** nothing here.

**What Tally needs:** a list of names (initials, since no picture is loaded from elsewhere) in a row, overlapping, with a count beyond a limit and an
accessible label naming everyone.

**Accepts when:** a `@sovereignfs/ui` release carrying it is published.

**Done as:** published in `@sovereignfs/ui` 0.96.0 (`AvatarStack`); Tally takes 0.96.1, exact-pinned, its exception in `pnpm-workspace.yaml`
moved with it.

#### ✅ 14.3 — A floating action button

**Goal:** the phone's Add. **Design:** §15.11. **Depends on:** nothing here.

**What Tally needs:** a floating button that sits above `MobileFooter` and respects the safe area, with an icon and an accessible label.

**Accepts when:** a `@sovereignfs/ui` release carrying it is published.

**Done as:** published in `@sovereignfs/ui` 0.96.0 (`FloatingActionButton`); Tally takes 0.96.1.

#### 📋 14.4 — `MoneyInput` and a currency picker

**Goal:** money typed in any currency. **Design:** §8.7, §15.9. **Depends on:** nothing here.

**What Tally needs:** `MoneyInput`, `CurrencyInput` bound to a currency's decimals (0, 2 or 3) with its code shown and changeable; a searchable currency
picker with the chosen currencies first. Ledger planned both as its own (its §14.5); two apps needing them is the reason they belong in the design
system, and the currency table they read moves with them or is passed in.

**Accepts when:** a `@sovereignfs/ui` release carrying them is published.

#### ✅ 14.5 — `AUTH_SIGNUP` by invitation

**Goal:** `invite` as a value of the shared `AUTH_SIGNUP`. **Design:** §6.4. **Depends on:** nothing here.

**What Tally needs:** `contracts/env.md` to allow `invite` ("the first account, and anyone holding a valid invitation the app issued"), and
`@sovereignfs/config`'s declaration of the shared name to accept it, so that every app can offer it.

**Accepts when:** the contract change is merged and a `@sovereignfs/config` release accepting it is published.

**Done as:** merged in `sovereign` as `3eb5aee` ("docs(contracts): AUTH_SIGNUP=invite, for an app that issues invitations"): `contracts/env.md` lists
`invite` (the first account, and anyone holding a valid invitation the app issued) and says what an app that issues none must do. **No
`@sovereignfs/config` release was needed:** the contract has an app declare the setting as its own choice among the modes it supports, which Tally
already does in `src/auth/config.ts`; 8.3 adds `invite` there.

#### 📋 14.6 — Tally's port in the guide

**Goal:** port 3004 recorded. **Design:** §22. **Depends on:** nothing here.

**What Tally needs:** building-an-app §2's ports table to list Tally's 3004 (and Ledger's 3003, if not already there).

**Accepts when:** the change is merged in `sovereign`.
