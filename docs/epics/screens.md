# Epic 7: Screens

## Status

📋 Planned.

## Overview

The interface of `DESIGN.md` §15, designed anew, on the device's data (epic 6): screens paint from IndexedDB and need the server only for activity,
notices, settings and online operations. Every screen is one route for every width; only what is rendered forks. Parts the design system lacks are
built there first (epic 14), never here.

## Related

[`DESIGN.md`](../../DESIGN.md) §9, §15

## Tasks

#### ✅ 7.1 — The shell's places and the groups list

**Goal:** the sidebar's Groups section and `/groups`. **Design:** §15.2, §15.3. **Depends on:** 6.2, 3.2.

**Technical:** the sidebar's Groups from the store: open groups by latest activity with the dot and the reader's balance, closed ones after, dimmed;
_New group_ (a dialog: name, colour, currency; online, §11.6); `/groups` with the same, as tiles, for every width; the places Home, People, Activity
and Insights wired to their routes with empty states until their tasks.

**Accepts when:** a new group appears in the sidebar at once and on a second device at its next pull; offline, New group says it needs a connection.

**Done as:** `src/screens/` begins: `data.ts` (`readGroupView`, `readGroupViews`, `myBalances`, pure reads of the store with balances from
`src/balances/`), `hooks.ts` (`useOpened`, `useGroupNames`: sealed text opened on the device, tried again on every store change), `useGroups.ts`,
`Balance.tsx` (a balance in words, "you owe €63.00", in the currency's own decimals; the design system's `BalanceChip` assumes cents, a gap worth
raising in `sovereign`) and the group's dot, `NewGroupDialog.tsx` (name, colour with `ColorPicker`, currency with the interim `CurrencyPicker`;
`GroupKeys.prepareGroup` and `group.create`, online only) and `GroupsList.tsx` (`/groups`, tiles with `AvatarStack`). The sidebar lists the groups
from the store, open by latest activity with the reader's balance in short, closed dimmed after, and opens New group. `SyncProvider` now wraps the
whole shell, carries the reader (`useMe`, with the primary currency) and offers `useLocal`; `GroupKeys` gains `openText` and `sealText`. Fixed on the
way: a group's key arriving in a sync now tells the screens, so names opened on a second device. The other places keep their empty states until their
tasks. A group's page is 7.3, so New group goes to `/groups` for now. Tests in Playwright, Chromium and WebKit: a new group in the sidebar and on
`/groups` at once and on a second device at its next sync, and offline, "Making a group needs a connection."

#### ✅ 7.2 — Adding an expense

**Goal:** the sheet everything is built to make quick. **Design:** §15.9. **Depends on:** 7.1, 6.2, 14.4.

**Technical:** `Sheet` wide, `Drawer` narrow; `?add=expense&g=`; the amount first (`MoneyInput`), the description, then the sentence of choices
(group, date, category, payers, method and members) each opening in place; the result always shown with what is left; Save disabled until it adds up;
defaults remembered per group on the device; Enter saves; Save and add another; edit mode filled from an expense (used by 7.6); the keyboard shortcuts
`N` and `Esc`; writes through 6.2.

**Accepts when:** in Playwright, an expense with each method, and one with two payers, is added by keyboard alone, offline and online; a split that
does not add up cannot be saved and says why.

**Done as:** `src/screens/AddExpense.tsx` (the form) and `AddSheet.tsx` (`?add=expense`, `&g=`, `&e=` to edit; a `Sheet` wide and a `Drawer`
narrow through `ResponsiveSurface`, the same content; `N` wherever no field has focus), mounted by the signed-in layout and the offline shell; the
sidebar's Add expense opens it over the page, with the page's group filled in. The amount first, in the interim `MoneyInput` (`src/ui/`, exact parsing
through `parseAmount`, focused once the sheet has placed its own focus), with its currency from the interim `CurrencyPicker`; then the description,
then the group, date, category, who paid (one, or several with an amount each) and the split (`SplitMethodSelector`, `MemberMultiSelect` with an input
per member: amounts, percentages as basis points parsed exactly, shares with `QuantityStepper`); the result always shown with what is left, by
`computeShares`; Save disabled until it adds up and the description is there. Saving seals `{description, note}` under the group's newest key
(`GroupKeys.sealText`) and commits through the device; a locked group says it unlocks by itself. Defaults per group (category, payer, method,
members) and the last group are kept in `localStorage`. **Changed from the design:** the sentence's choices are native selects and a date field rather
than buttons opening popovers, which keeps it quick by keyboard; a `Popover` sentence can follow. **Not yet:** two payers in Playwright, since a group
has only its maker until adding people (Milestone F); the form supports several payers and the unit tests of the split cover it. Tests in Playwright,
Chromium and WebKit: an expense with each method added by keyboard alone, one of them offline, and a split that does not add up refused with its reason.

#### ✅ 7.3 — A group: expenses

**Goal:** a group's page and its list. **Design:** §15.5. **Depends on:** 7.2.

**Technical:** `/g/<id>`: the header (dot, name, `AvatarStack` once 14.2 is released, the reader's balance, Add expense, Settle up, the gear); views by
`?view=`; Expenses: by month, rows with the category's icon, who paid, the reader's part in words, the date and the clock mark; payments as rows;
search (`/`), filters by person and category, deleted behind a toggle; a closed group read-only; the not-found state for a group the reader is not in.

**Accepts when:** a list of a thousand expenses paints from the device without a spinner; search and filters live in the address.

**Done as:** `app/(app)/g/[id]/page.tsx` and `src/screens/GroupScreen.tsx` (with `GroupPage`, which the offline shell now also chooses by address):
the header (dot, name, `AvatarStack`, the gear to the group's settings, the reader's balance per currency in words, Add expense; Settle up waits
for 7.5 behind a prop), the views by `?view=` as `Tabs` once a second view exists, and Expenses: by month, newest first, each row the category's
icon, the description opened on the device, who paid and how much, the reader's part ("you lent", "you borrowed", "not involved", `myPart`), the date
and the clock mark while unsent (`pendingRows`); payments as rows; search (`/` focuses it) over the opened description and note, filters by person and
category and a deleted toggle, all kept as one state and written whole to the address; a closed group read-only; a group the device does not hold,
or the reader is not in, "This group is not here". `readGroupView` answers `null` for a group not held. Fixed on the way: `N` opened the sheet
without the page's group (it now takes the group from the page), and `SyncClient.sync` runs one sync at a time in a page, since New group's own sync
could overlap the loop's (not reproduced as a loss in a test, so kept as a guard without a regression test). Tests in Playwright, Chromium and WebKit,
three times each: the page after adding, the reader's part, search and filters in the address and back after a reload, a thousand expenses painted
from the device within the time with no progress bar, and not found.

#### ✅ 7.4 — A group: balances

**Goal:** who owes whom in a group. **Design:** §15.5, §10. **Depends on:** 7.3, 4.3.

**Technical:** Balances: each member's `BalanceChip` per currency; who owes whom by the group's setting, each pair with Settle up or Remind (Remind
wired in 9.3); the line saying whether debts are simplified, an owner's link to change it; on a wide screen, also as a column beside Expenses
(`SplitPane`).

**Accepts when:** the figures match 4.3's fixtures seeded into a group; turning simplify on changes the pairs on every device at its next pull.

**Done as:** `src/screens/BalancesView.tsx`, the group's Balances view (`?view=balances`, so the group's views are now tabs): each member's balance
per currency in words ("you are owed €10.00", "owes €10.00", "settled up", a member who left marked), then who owes whom from `src/balances/` by the
group's setting (`readGroupView` now carries `suggestions`), each pair involving the reader with Settle up, which opens the payment sheet filled in
(7.5), and the line saying whether debts are simplified, with an owner's link to the group's settings (7.9). **Not done:** Remind (9.3), and the
column beside Expenses on a wide screen (`SplitPane`), which can follow. Members other than the maker exist only once adding people does (Milestone F),
so the browser tests seed placeholders straight into their own SQLite file (`e2e/seed.ts`, a fixture, moving the group's `seq` on as an operation
would). Tests in Playwright, Chromium and WebKit: a hand-worked case (you pay for you and Sam, Sam pays for Sam and Lee) gives each balance and the
two pairs, and turning simplify on gives the one payment that settles everyone.

#### 📋 7.5 — Payments and settling up

**Goal:** recording payments, suggested and by hand. **Design:** §9, §15.9. **Depends on:** 7.4.

**Technical:** the payment sheet (`?add=payment`, pre-filled from a suggestion, `P` shortcut); Settle up from a group (its suggestions involving the
reader) with a confirmation; payments edited, deleted and restored from their page (7.6).

**Accepts when:** settling a suggested payment zeroes that pair on both devices; a partial payment reduces it by its amount.

#### 📋 7.6 — An expense: comments and history

**Goal:** an expense's and a payment's page. **Design:** §15.6. **Depends on:** 7.3, 5.3.

**Technical:** `/g/<id>/e/<id>` and `/g/<id>/p/<id>`: the figures, payers and shares; Comments from the device with a field to add one (offline too);
History read from the server (online, §11.6) in words, a replaced version's Restore this version (an edit with that snapshot); Edit opens 7.2 filled in;
Delete and Restore in the menu.

**Accepts when:** restoring a replaced version makes it current and writes a revision; a comment added offline appears for another member after sync.

#### 📋 7.7 — Home

**Goal:** where the reader stands, and what to do about it. **Design:** §15.4. **Depends on:** 7.5, 4.4, 14.2.

**Technical:** your balance per currency (primary first, largest); To settle, every person with a balance against the reader, largest first, the
groups it comes from, Settle up (with a person, 4.4) or Remind; Groups with a balance as tiles; Recently, the last ten involving the reader; the empty
state for no group.

**Accepts when:** figures match a hand-worked seed across two groups and two currencies; a new account sees only Create your first group.

#### 📋 7.8 — People and a person

**Goal:** everyone the reader shares a group with, and one of them. **Design:** §15.7. **Depends on:** 7.5, 4.4.

**Technical:** `/people`: with a balance first (largest), then by name; `/people/<id>`: initials avatar, "not on Tally yet" for a placeholder, the
balance per currency, by group, Settle up with a person (one payment per group and currency, one confirmation), Remind, and the expenses and payments
both took part in, with their group; for a placeholder the reader added, Invite and editing the name and email (8.2, 8.3).

**Accepts when:** settling up with a person shared across two groups records one payment in each and zeroes both.

#### 📋 7.9 — A group's settings

**Goal:** the group's details, people and lifecycle. **Design:** §7, §15.3. **Depends on:** 7.3, 3.3.

**Technical:** `/g/<id>/settings`: details (owners), simplify debts (owners), people with roles (owners change them; the last owner held, with the
reason shown), Add people (8.2), invitations (8.3), Notifications for this group, for every member (everything by default, only what involves me,
nothing; `DESIGN.md` §12.2), Leave, Remove (owners), Close and Reopen, Delete (only when allowed, §7.3); each an online
operation with its refusal in a sentence; every disabled control says why.

**Accepts when:** every refusal of 3.3 shows its sentence; Delete is absent once an expense exists.

#### 📋 7.10 — Activity

**Goal:** every group's activity. **Design:** §15.8. **Depends on:** 5.4, 7.1.

**Technical:** `/activity` and a group's Activity view: by day, newest first, lines from `describe.ts`, filters in the query, paged; online, with a
sentence offline.

**Accepts when:** each kind of §12.1 shows in words; filters combine.

#### 📋 7.11 — The phone

**Goal:** the same app at a phone's width. **Design:** §15.11. **Depends on:** 7.7, 7.8, 14.3.

**Technical:** `MobileFooter` with Home and Groups left, People and Activity right; the floating Add (14.3) opening the drawer; Insights,
Notifications and Settings in the avatar menu; a group's views as tabs; full pages with back links for an expense, a person and settings. Rendering
forks only; no navigation decision does.

**Accepts when:** every Playwright journey of epics 7 passes at 390 pixels wide in WebKit, with no horizontal scroll.
