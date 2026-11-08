# Epic 8: Bringing people in

## Status

📋 Planned.

## Overview

People outside Tally are in a group from the first expense, as placeholders, and take their place through an invitation, with everything already
recorded for them. Mail is Tally's own, sent in the background; with no mail set up, the link still works and the screen says so.

## Related

[`DESIGN.md`](../../DESIGN.md) §6.2, §6.3, §6.4, §12.3

## Tasks

#### 📋 8.1 — The mail outbox

**Goal:** mail sent in the background, reliably and quietly. **Design:** §12.3. **Depends on:** 1.6.

**Technical:** `mail_outbox` written in the transaction of the change that causes it; a mail job that claims due rows, renders the template (plain text
and simple HTML, the instance's name, no remote image), sends through Tally's SMTP (`src/mail/`, copied in 2.1), and retries with backoff up to a
limit, recording a failure kind; nothing about a message logged but its id and failure kind; with no SMTP set, rows are not written and callers are told
mail is off.

**Accepts when:** against a fake SMTP server, a message is sent once from two processes; a failing server is retried and then marked failed; no
address appears in any log line.

#### 📋 8.2 — Adding people and placeholders

**Goal:** one field to add anyone. **Design:** §6.2, §6.1. **Depends on:** 7.9, 3.1.

**Technical:** the Add people field in a group's settings: names of people the adder shares a group with and their own placeholders; an exact email of
an account here adds its person, another email makes a placeholder with it (rate-limited per account and hour); "Add as not on Tally yet" for a name
alone; any member may add (`DESIGN.md` §24); placeholders editable by whoever added them and owners; the
operation writes activity and, for an account, the `added_to_group` notice (once 9.1 is in). The directory joins in 11.2.

**Accepts when:** a placeholder can be a payer and in a split from the moment it is added; the email lookup's limit refuses with a sentence; another
member cannot see a placeholder's email.

#### 📋 8.3 — Invitations and claiming

**Goal:** a placeholder's place taken by a real account. **Design:** §6.3, §6.4. **Depends on:** 8.1, 8.2, 14.5.

**Technical:** `invitation`: 32 random bytes, stored as a hash, constant-time comparison, 14 days, single use, one live per placeholder, revocable,
Resend at most once an hour; sent through 8.1 when there is an email and mail, always available as a link (`CopyButton`); `/invite/<token>` showing the
group and inviter only, with sign-in, sign-up (and core when set); `TALLY_AUTH_SIGNUP=invite` as the default, accepting an invitation as the reason to
allow a local sign-up; the claim in one transaction (members repointed, the placeholder's email dropped, the placeholder deleted, the group's `seq`
incremented so devices pull the change, activity and `invite_accepted`); refused for a group the account is already in. Every invalid link shows the
same page.

**Accepts when:** journeys 3 and 4 of §3 pass in Playwright, once with mail and once with the link alone; an expired, used or revoked link shows the
same page as a made-up one; the claimed person's balance is the placeholder's.
