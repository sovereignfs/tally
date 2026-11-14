# Epic 8: Bringing people in

## Status

📋 Planned.

## Overview

People outside Tally are in a group from the first expense, as placeholders, and take their place through an invitation, with everything already
recorded for them. Mail is Tally's own, sent in the background; with no mail set up, the link still works and the screen says so.

## Related

[`DESIGN.md`](../../DESIGN.md) §6.2, §6.3, §6.4, §12.3

## Tasks

#### ✅ 8.1 — The mail outbox

**Goal:** mail sent in the background, reliably and quietly. **Design:** §12.3. **Depends on:** 1.6.

**Technical:** `mail_outbox` written in the transaction of the change that causes it; a mail job that claims due rows, renders the template (plain text
and simple HTML, the instance's name, no remote image, and never sealed text: no group's name, description or comment, `DESIGN.md` §5.3), sends through Tally's SMTP (`src/mail/`, copied in 2.1), and retries with backoff up to a
limit, recording a failure kind; nothing about a message logged but its id and failure kind; with no SMTP set, rows are not written and callers are told
mail is off.

**Accepts when:** against a fake SMTP server, a message is sent once from two processes; a failing server is retried and then marked failed; no
address appears in any log line.

**Done as:** migration `0010_add_mail_outbox` and `src/mail/outbox.ts`, Tally's own (neither Tusk nor Ledger has an outbox): `enqueueMail` writes in
the caller's transaction, to an account (its address read from the sign-in store when sending) or to an address; `sendDue`, run every minute by the
`send-mail` job (registered only to do anything when `TALLY_SMTP_HOST` is set), claims each due row with a conditional update that counts the attempt
and leases it, renders it, sends it through `smtpMailer`, and on a failure retries after 1, 4, 16 and 64 minutes, then marks it failed with the error's
kind; a message to an account with no address, or of a template this version does not know, is given up at once; sent and failed rows go after a
week, with their addresses. Logs carry the row's id and a kind, never an address or a link. `mailOn` tells a caller whether to write at all. The one
template is the invitation (`invitationMessage`): who invited and the link, never the group's name, which is sealed. `People.deletePerson` deletes an
account's waiting mail. Tests against the fake SMTP server (`SmtpSink`): one message to an address and one to an account sent once by two connections
at once, a failing server retried with backoff and then failed, a log with no address, and the week's cleanup. **Run locally on a file only:** Docker
was not running for sqld and PostgreSQL, which CI's legs run.

#### ✅ 8.2 — Adding people and placeholders

**Goal:** one field to add anyone. **Design:** §6.2, §6.1. **Depends on:** 7.9, 3.1.

**Technical:** the Add people field in a group's settings: names of people the adder shares a group with and their own placeholders; an exact email of
an account here adds its person, the adder's device wrapping the group key to their account key in the same operation (15.3), another email makes a placeholder with it (rate-limited per account and hour); "Add as not on Tally yet" for a name
alone; any member may add (`DESIGN.md` §24); placeholders editable by whoever added them and owners; the
operation writes activity and, for an account, the `added_to_group` notice (once 9.1 is in). The directory joins in 11.2.

**Accepts when:** a placeholder can be a payer and in a split from the moment it is added; the email lookup's limit refuses with a sentence; another
member cannot see a placeholder's email.

**Done as:** `src/groups/people.ts`, `member.add` and `person.edit` in `POST /api/ops`. `member.add` takes a person the adder already knows (someone
they share a group with, or a placeholder they added, checked in the statement), an exact email (the account's person when one has it, else a new
placeholder with it; looked up at most 30 times an hour per account, `rate_limited` with a sentence beyond) or a name alone; one transaction moves the
group's `seq` on (open group, active membership), holds the 50-member limit, adds the member (or brings back one who left), and writes
`member_added`. `already_member` and `too_many_members` are refused with sentences. `person.edit` renames a placeholder, or changes its email, for
whoever added it or an owner of a group it is in, and moves those groups on so devices pull the new name. **Changed from the epic:** an account added
by email is given the group's key by any member's device at its next exchange (15.3), not by the adder's in the same operation; the effect is the
same, and an adder whose device is offline does not hold anyone up. In a group's settings, **Add people** is one field: matching people from the
reader's other groups, "Add <email>" for an address, and "Add “Sam” as not on Tally yet" for a name. The `added_to_group` notice joins with 9.1, the
directory with 11.2, Invite with 8.3. Tests on the file database: a placeholder paying and in a split at once, an account by email and refused again,
a placeholder's email seen by its adder and not by another member, the edit rule, and the lookup's limit; in Playwright, Chromium, WebKit and the phone:
a name added in settings in the next expense's split.

#### 📋 8.3 — Invitations and claiming

**Goal:** a placeholder's place taken by a real account. **Design:** §6.3, §6.4. **Depends on:** 8.1, 8.2, 14.5.

**Technical:** `invitation`: 32 random bytes, stored as a hash, constant-time comparison, 14 days, single use, one live per placeholder, revocable,
Resend at most once an hour; sent through 8.1 when there is an email and mail, always available as a link (`CopyButton`; the key in its fragment
joins with 15.5); `/invite/<token>` showing the inviter only (and the group's name once 15.5 opens it from the fragment), with sign-in, sign-up (and core when set); `TALLY_AUTH_SIGNUP=invite` as the default, accepting an invitation as the reason to
allow a local sign-up; the claim in one transaction (members repointed, the placeholder's email dropped, the placeholder deleted, the group's `seq`
incremented so devices pull the change, activity and `invite_accepted`); refused for a group the account is already in. Every invalid link shows the
same page.

**Accepts when:** journeys 3 and 4 of §3 pass in Playwright, once with mail and once with the link alone; an expired, used or revoked link shows the
same page as a made-up one; the claimed person's balance is the placeholder's.
