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

#### 📋 7.1 — The shell's places and the groups list

**Goal:** the sidebar's Groups section and `/groups`. **Design:** §15.2, §15.3. **Depends on:** 6.2, 3.2.

**Technical:** the sidebar's Groups from the store: open groups by latest activity with the dot and the reader's balance, closed ones after, dimmed;
_New group_ (a dialog: name, colour, currency; online, §11.6); `/groups` with the same, as tiles, for every width; the places Home, People, Activity
and Insights wired to their routes with empty states until their tasks.

**Accepts when:** a new group appears in the sidebar at once and on a second device at its next pull; offline, New group says it needs a connection.

#### 📋 7.2 — Adding an expense

**Goal:** the sheet everything is built to make quick. **Design:** §15.9. **Depends on:** 7.1, 6.2, 14.4.

**Technical:** `Sheet` wide, `Drawer` narrow; `?add=expense&g=`; the amount first (`MoneyInput`), the description, then the sentence of choices
(group, date, category, payers, method and members) each opening in place; the result always shown with what is left; Save disabled until it adds up;
defaults remembered per group on the device; Enter saves; Save and add another; edit mode filled from an expense (used by 7.6); the keyboard shortcuts
`N` and `Esc`; writes through 6.2.

**Accepts when:** in Playwright, an expense with each method, and one with two payers, is added by keyboard alone, offline and online; a split that
does not add up cannot be saved and says why.

#### 📋 7.3 — A group: expenses

**Goal:** a group's page and its list. **Design:** §15.5. **Depends on:** 7.2.

**Technical:** `/g/<id>`: the header (dot, name, `AvatarStack` once 14.2 is released, the reader's balance, Add expense, Settle up, the gear); views by
`?view=`; Expenses: by month, rows with the category's icon, who paid, the reader's part in words, the date and the clock mark; payments as rows;
search (`/`), filters by person and category, deleted behind a toggle; a closed group read-only; the not-found state for a group the reader is not in.

**Accepts when:** a list of a thousand expenses paints from the device without a spinner; search and filters live in the address.

#### 📋 7.4 — A group: balances

**Goal:** who owes whom in a group. **Design:** §15.5, §10. **Depends on:** 7.3, 4.3.

**Technical:** Balances: each member's `BalanceChip` per currency; who owes whom by the group's setting, each pair with Settle up or Remind (Remind
wired in 9.3); the line saying whether debts are simplified, an owner's link to change it; on a wide screen, also as a column beside Expenses
(`SplitPane`).

**Accepts when:** the figures match 4.3's fixtures seeded into a group; turning simplify on changes the pairs on every device at its next pull.

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
