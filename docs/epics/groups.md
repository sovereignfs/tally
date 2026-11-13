# Epic 3: People and groups

## Status

📋 Planned.

## Overview

Tally's own record of people, with accounts or without; groups, their members and roles; and the permission every statement carries. These are online
operations (`/api/ops`), decided by the server at once (`DESIGN.md` §11.6). Adding people and invitations are epic 8.

## Related

[`DESIGN.md`](../../DESIGN.md) §5.2, §6.1, §7, §11.6

## Tasks

#### 📋 3.1 — Persons

**Goal:** every account has a person, and a person may have no account. **Design:** §6.1. **Depends on:** 2.1.

**Technical:** the `person` table; a person made in the same transaction as the account (better-auth's user-creation hook, after the policy); name and
email kept in step from Settings; who may see an email (`src/people/visibility.ts`, one function, used by every read that returns a person); names read
from `person`, never from the auth store.

**Accepts when:** a new account has exactly one person; a person row can exist with no account; an email is returned only to those §6.1 allows, which a
test checks for each read.

#### 📋 3.2 — Groups, members and access

**Goal:** a person makes a group, is its owner, and nobody else can reach it. **Design:** §5.2, §5.3, §7.1, §7.2. **Depends on:** 3.1, 4.1, 15.2.

**Technical:** `grp` and `member`; `/api/ops` (session, `Origin`, one handler per operation, answering at once with the group's new state or a refusal
that reads as not found); operations: create (name sealed on the device with the group's first key epoch, wrapped to the creator's devices and recovery key, 15.3; colour; default currency from the person's primary currency), rename and recolour, change currency,
simplify debts on or off, make and unmake owner (the last owner held); the membership condition as one SQL fragment in `src/access/` used by every
statement; `src/access/routes.ts` and the second-person test; limits (§7.3).

**Accepts when:** a second person gets not found from every operation on the first person's group; a group never has no owner; the limits refuse with a
sentence.

#### 📋 3.3 — Leaving, removing, closing, deleting

**Goal:** a group's lifecycle, with balances guarding it. **Design:** §7.3. **Depends on:** 3.2, 4.3, 5.2.

**Technical:** operations leave, remove (owners), close and reopen (owners), delete (owners; only with no expense or payment row, deleted ones
included); the guards read balances through `src/balances/` on the server, in the same transaction; a closed group refuses every mutation (5.2) and
every operation but reopen; deleting names every table by `group_id`, `key_wrap` included, in one transaction. A member who left keeps their row; their
leaving makes the group due a new key epoch (15.6).

**Accepts when:** leave, remove and close are refused with the amounts while a balance is not zero; a closed group refuses an expense through sync; a
group with one deleted expense cannot be deleted; deleting a group leaves no row of it in any table.

#### 📋 3.4 — Merging a placeholder

**Goal:** one person in a group twice becomes once. **Design:** §7.2. **Depends on:** 8.2, 5.2.

**Technical:** an owner's operation: the placeholder's payers, shares and payments in the group moved to the member, in one transaction that writes
revisions for every expense and payment touched, increments the group's `seq` so devices pull the change, and records the activity; the placeholder's
membership ended, and the placeholder deleted if it is in no other group.

**Accepts when:** after a merge every balance in the group is what it was with the two people added together, and a device that was offline during the
merge ends with the merged rows.
