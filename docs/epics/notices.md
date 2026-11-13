# Epic 9: Notices and reminders

## Status

📋 Planned.

## Overview

What a person is told, in Tally's own bell always, by email when they want it, and through core's bell when hosted (epic 11). Push is phase 2, but its
channel is a value in the same preferences from the start (`DESIGN.md` §12.3, §21.4).

## Related

[`DESIGN.md`](../../DESIGN.md) §12.2, §12.3, §12.4 · Tusk's `DESIGN.md` §16

## Tasks

#### 📋 9.1 — Notices and the bell

**Goal:** the right people told, in the app. **Design:** §12.2. **Depends on:** 5.2, 7.1.

**Technical:** `notice` and one function that raises them (`src/notices/raise.ts`), called in the transaction of the change, never for the actor; the
kinds of §12.2 with who is told: every member for the group's kinds, filtered by each member's choice for the group (`member.notify`: `all` by
default, `involved` worked out from payers and shares, `none`), the personal kinds whatever the choice; the choice in the group's settings (7.9);
sealed text in `details` as the change carried it, opened by the bell on the device; the bell (`NotificationsPanel`) left of the avatar with the unread count, read per notice and Mark all read
(`inbox_seen_at`), dismiss; `/notifications` by day; a notice for a group the reader left is not shown; kept 90 days, at most 500; the last unread count
kept on the device for offline.

**Accepts when:** for each kind and each choice, a test shows who is told and that the actor is not; a new member hears everything until they choose
otherwise; reading on one device reads on another.

#### 📋 9.2 — Preferences and email

**Goal:** each kind by each channel, as the person chooses. **Design:** §12.3, §16. **Depends on:** 9.1, 8.1.

**Technical:** `notice_pref` with the defaults of §12.3 and channels `email`, `core_bell` (used by 11.1) and `push` (reserved for phase 2, not shown);
Settings > Notifications, saying plainly what is not available (no mail, no core), and linking to each group's choice; `raise` writes the mail outbox
for kinds with email on, with no sealed text in it ("Kasun added an expense of €84.00 in a group on Tally").

**Accepts when:** turning a kind's email off stops its mail and keeps its bell; with no mail set up, Settings says so and nothing fails.

#### 📋 9.3 — Reminders

**Goal:** a nudge, once a day. **Design:** §12.4. **Depends on:** 9.2, 4.3.

**Technical:** an operation that re-derives the debt on the server by the group's setting and refuses unless that person owes the one reminding;
`reminder` holding one per (from, to, group, day); the notice and email for an account, an email with the live invitation for a placeholder with an
address, a refusal with "Invite Sam to remind them" for one without; Remind wired on Home, a group's balances and a person's page, disabled with the
time left once used.

**Accepts when:** a second reminder the same day is refused by the server, whatever the button showed; a reminder for someone who does not owe is
refused.
