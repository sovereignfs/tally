# Epic 3: People and groups

## Status

📋 Planned.

## Overview

Tally's own record of people, with accounts or without; groups, their members and roles; and the permission every statement carries. These are online
operations (`/api/ops`), decided by the server at once (`DESIGN.md` §11.6). Adding people and invitations are epic 8.

## Related

[`DESIGN.md`](../../DESIGN.md) §5.2, §6.1, §7, §11.6

## Tasks

#### ✅ 3.1 — Persons

**Goal:** every account has a person, and a person may have no account. **Design:** §6.1. **Depends on:** 2.1.

**Technical:** the `person` table; a person made in the same transaction as the account (better-auth's user-creation hook, after the policy); name and
email kept in step from Settings; who may see an email (`src/people/visibility.ts`, one function, used by every read that returns a person); names read
from `person`, never from the auth store.

**Accepts when:** a new account has exactly one person; a person row can exist with no account; an email is returned only to those §6.1 allows, which a
test checks for each read.

**Done as:** `person` on both dialects (migration `0001_add_person`; `account_id` and `core_sub` unique, many placeholders allowed), and
`src/people/persons.ts`: `ensurePerson`, `personOfAccount`, `personById`, `cleanName`. **Not one transaction with the account,** since the account is
in the auth store and the person in the app store: better-auth's after-create hook makes the person (`onAccountCreated` in `createAuth`), and
`requirePerson` (`src/people/session.ts`) makes it again if missing at every signed-in request; an insert that races another does nothing
(`ON CONFLICT (account_id)`), and a person is never overwritten by a later ask. `src/people/visibility.ts` is the one rule for an email
(`emailVisible`, `viewPerson`), the relation a read finds in its SQL given to it. The signed-in layout reads the name and email from the person.
`src/db/tables.ts` names an app table for raw SQL on either dialect. Run here: 318 tests on sqld and a file, 317 on PostgreSQL; 38 browser tests; the
test of a new account's person failed with the hook taken out. **Left out:** the only read that returns a person today is one's own; group reads
(3.2, 8.2) bring the owner relation and their own tests; Settings keeping name and email in step is 2.6.

#### ✅ 3.2 — Groups, members and access

**Goal:** a person makes a group, is its owner, and nobody else can reach it. **Design:** §5.2, §5.3, §7.1, §7.2. **Depends on:** 3.1, 4.1, 15.2.

**Technical:** `grp` and `member`; `/api/ops` (session, `Origin`, one handler per operation, answering at once with the group's new state or a refusal
that reads as not found); operations: create (name sealed on the device with the group's first key epoch, wrapped to the creator's devices and recovery key, 15.3; colour; default currency from the person's primary currency), rename and recolour, change currency,
simplify debts on or off, make and unmake owner (the last owner held); the membership condition as one SQL fragment in `src/access/` used by every
statement; `src/access/routes.ts` and the second-person test; limits (§7.3).

**Accepts when:** a second person gets not found from every operation on the first person's group; a group never has no owner; the limits refuse with a
sentence.

**Done as:** `grp`, `member` (with `notify`, `all` by default, §12.2) and `key_wrap` (migration `0003_add_groups`), the last made here because
creating a group stores its first wrap; 15.3 brings the granting. `src/access/membership.ts`: `activeMemberOf` and `ownerOf`, the one SQL fragment each
statement carries. `src/groups/ops.ts` and `POST /api/ops` (`src/groups/api.ts`, in `routes.ts`): `group.read`, `group.create` (an id the browser made,
a sealed name of epoch 1, a colour, a currency, the first key wrapped to the creator; an id that is another group's refused), `group.rename`,
`group.recolour`, `group.currency`, `group.simplify`, `member.role` (the last owner held in the same statement) and `member.notify`; each owner's
operation carries the role and that the group is open, and moves `seq` on. A group's state answers with each member through `viewPerson`, an owner
seeing the emails of those still in it. Colours are Tusk's swatches and any `#rrggbb` (`src/groups/colors.ts`), since the design system has no accent
palette; §7.1 is corrected. Run here: 394 tests on sqld and a file, 393 on PostgreSQL; boot-check on each; planted faults (the member condition in
place of the owner's, the last-owner condition removed) each failed their test. **Left out:** the screens (7.1, 7.9); adding people (8.2), which
checks `MAX_MEMBERS`; leaving, removing, closing and deleting (3.3).

#### ✅ 3.3 — Leaving, removing, closing, deleting

**Goal:** a group's lifecycle, with balances guarding it. **Design:** §7.3. **Depends on:** 3.2, 4.3, 5.2.

**Technical:** operations leave, remove (owners), close and reopen (owners), delete (owners; only with no expense or payment row, deleted ones
included); the guards read balances through `src/balances/` on the server, in the same transaction; a closed group refuses every mutation (5.2) and
every operation but reopen; deleting names every table by `group_id`, `key_wrap` included, in one transaction. A member who left keeps their row; their
leaving makes the group due a new key epoch (15.6).

**Accepts when:** leave, remove and close are refused with the amounts while a balance is not zero; a closed group refuses an expense through sync; a
group with one deleted expense cannot be deleted; deleting a group leaves no row of it in any table.

**Done as:** `src/groups/lifecycle.ts`, as `member.leave`, `member.remove`, `group.close`, `group.reopen` and `group.delete` in `POST /api/ops`
(`OpError` moved to `src/groups/errors.ts`, with `unsettled` and `not_empty`). Each moves the group's `seq` on in a statement that carries the open group
and the membership or the owner, then reads the group's rows (`groupRows`) and guards with `src/balances/` in the same transaction; the sentence names
the amounts ("You owe €10.00 and are owed ¥500 in this group."). Leaving keeps the membership with `left_at` and drops an owner's role; the last owner
cannot leave while another account is in the group. A closed group refuses every operation but reopen and read, `member.notify` included, and every
mutation (`closed`, from 5.2). Deleting holds the owner and "never an expense or a payment" in the `DELETE` of the group's row, then removes every
other row by `group_id` through `deleteGroupRows`, now shared with `People.deletePerson`, so the list of a group's tables is one. Activity:
`member_left`, `member_removed`, `group_closed`, `group_reopened`. **Left for 15.6:** leaving and removing should make the group due a new key epoch;
nothing marks it yet.

#### 📋 3.4 — Merging a placeholder

**Goal:** one person in a group twice becomes once. **Design:** §7.2. **Depends on:** 8.2, 5.2.

**Technical:** an owner's operation: the placeholder's payers, shares and payments in the group moved to the member, in one transaction that writes
revisions for every expense and payment touched, increments the group's `seq` so devices pull the change, and records the activity; the placeholder's
membership ended, and the placeholder deleted if it is in no other group.

**Accepts when:** after a merge every balance in the group is what it was with the two people added together, and a device that was offline during the
merge ends with the merged rows.
