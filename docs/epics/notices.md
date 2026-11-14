# Epic 9: Notices and reminders

## Status

📋 Planned.

## Overview

What a person is told, in Tally's own bell always, by email when they want it, and through core's bell when hosted (epic 11). Push is phase 2, but its
channel is a value in the same preferences from the start (`DESIGN.md` §12.3, §21.4).

## Related

[`DESIGN.md`](../../DESIGN.md) §12.2, §12.3, §12.4 · Tusk's `DESIGN.md` §16

## Tasks

#### ✅ 9.1 — Notices and the bell

**Goal:** the right people told, in the app. **Design:** §12.2. **Depends on:** 5.2, 7.1.

**Technical:** `notice` and one function that raises them (`src/notices/raise.ts`), called in the transaction of the change, never for the actor; the
kinds of §12.2 with who is told: every member for the group's kinds, filtered by each member's choice for the group (`member.notify`: `all` by
default, `involved` worked out from payers and shares, `none`), the personal kinds whatever the choice; the choice in the group's settings (7.9);
sealed text in `details` as the change carried it, opened by the bell on the device; the bell (`NotificationsPanel`) left of the avatar with the unread count, read per notice and Mark all read
(`inbox_seen_at`), dismiss; `/notifications` by day; a notice for a group the reader left is not shown; kept 90 days, at most 500; the last unread count
kept on the device for offline.

**Accepts when:** for each kind and each choice, a test shows who is told and that the actor is not; a new member hears everything until they choose
otherwise; reading on one device reads on another.

**Done as:** a `notice` (migration `0012_add_notices`) is a row per account told, pointing at the activity line it tells of (`activity_id`), so that
what it says is the line's, sealed text still sealed, and the device says it with `describeActivity`. **`raiseNotices`** (`src/notices/raise.ts`) is
called by `recordActivity` for every line, in the change's transaction: a group's kind (`GROUP_KIND_OF` in `src/notices/kinds.ts`) goes to every active
member with an account but the actor, by `member.notify` (`involved` from the line's payers and shares, the payment's two people, and for a comment
those on its expense or payment and whoever commented on it before; closing and reopening involve everyone); `added_to_group`, `edit_replaced` and
`owner_passed` come from the line itself (a `role_changed` line with no actor, which deleting an account now writes when a group passes on), and
`invite_accepted` is handed in by the claim. A personal notice takes the place of the group's for the same person. `reminder` is a kind with no caller
yet (9.3). `/api/notices` lists a page with the unread count and takes read, dismiss, `read_all` (`account_settings.inbox_seen_at`) and `clear_all`,
every statement naming the account and the group's active membership, so a group left shows and counts nothing. The bell (`src/notices/NotificationBell.tsx`,
copied from Tusk's and changed to Tally's kinds and words) uses the design system's `NotificationsPanel`; `/notifications` lists them by day in the
reader's zone; both read on load, on coming back into view, each minute while in view and after each sync, and the last count is kept in
`localStorage` for offline and forgotten at sign-out. The pruning job keeps 90 days and the latest 500 an account; notices are deleted with their
group (`GROUP_TABLES`) and with their account. Activity's opening of sealed text moved to `src/activity/opened.ts`, shared with the bell. Tests: in
Vitest, on each database, each choice for each kind of the group, the personal kinds, the actor never told, a new member on `all`, reading across
devices, read all, dismiss, a group left, another account's notices untouchable; wording, links, "ago" and the days; deletion's `owner_passed`. In
Playwright, Chromium and WebKit: an expense another member recorded in the bell in words, opened and read, on `/notifications` by day, and the
recorder told only of the invitation taken. **Left out:** export of notices joins export (12.1); delivery by email and to core's bell is 9.2.

#### ✅ 9.2 — Preferences and email

**Goal:** each kind by each channel, as the person chooses. **Design:** §12.3, §16. **Depends on:** 9.1, 8.1.

**Technical:** `notice_pref` with the defaults of §12.3 and channels `email`, `core_bell` (used by 11.1) and `push` (reserved for phase 2, not shown);
Settings > Notifications, saying plainly what is not available (no mail, no core), and linking to each group's choice; `raise` writes the mail outbox
for kinds with email on, with no sealed text in it ("Kasun added an expense of €84.00 in a group on Tally").

**Accepts when:** turning a kind's email off stops its mail and keeps its bell; with no mail set up, Settings says so and nothing fails.

**Done as:** `notice_pref` (migration `0013_add_notice_prefs`) keeps a choice only where it differs from the default (`src/notices/prefs.ts`: email on
for `added_to_group`, `reminder` and `invite_accepted`, core's bell on for every kind, push off), so a default changed later reaches everyone who never
chose; only email is offered for now, and `PATCH /api/account/notifications` refuses any other channel. `raiseNotices` now writes, beside each notice,
a `notice` row in the mail outbox where mail is set up and that kind's email is on, read in the statement that finds who is told
(`src/notices/mail.ts` decides whether mail is on, from `TALLY_SMTP_*` and `TALLY_URL`; tests set it). The mail carries the actor's name in Tally, the
figure and two links, never sealed text: "Ada added an expense of €9.00 in a group on Tally" (`noticeSentence` and `noticeMessage` in
`src/mail/templates.ts`, which replace an unused template copied from Tusk). Settings has a Notifications section: a switch per kind for email, which
says so and is disabled where mail is not set up, a sentence that no Sovereign instance is connected, and a link to each group's own choice. Deleting
an account deletes its choices. Tests: in Vitest, on each database, a kind's email on mails it with no sealed text, rendered through the outbox with
who and how much and a link to the expense, and off stops the mail while the bell keeps it; the actor gets no mail; the default kinds mailed; nothing
written with no mail; a choice equal to the default kept as no row, and a channel not offered refused. In Playwright, Chromium and WebKit: with no
mail set up, Settings says the bell is the only way, the switches are there and disabled, and the group's link opens its settings. **Left out:**
core's bell, its column and its sending are 11.1; the choices are exported with export (12.1).

#### 📋 9.3 — Reminders

**Goal:** a nudge, once a day. **Design:** §12.4. **Depends on:** 9.2, 4.3.

**Technical:** an operation that re-derives the debt on the server by the group's setting and refuses unless that person owes the one reminding;
`reminder` holding one per (from, to, group, day); the notice and email for an account, an email with the live invitation for a placeholder with an
address, a refusal with "Invite Sam to remind them" for one without; Remind wired on Home, a group's balances and a person's page, disabled with the
time left once used.

**Accepts when:** a second reminder the same day is refused by the server, whatever the button showed; a reminder for someone who does not owe is
refused.
