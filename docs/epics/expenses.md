# Epic 5: Expenses and payments

## Status

📋 Planned.

## Overview

The one write path for what is recorded: actions as pure functions that build mutations, the validators the browser and the server share, applying a
mutation with its revision and activity, comments, and the activity's words. Sync (epic 6) carries mutations to this path; nothing else writes an
expense, a payment or a comment.

## Related

[`DESIGN.md`](../../DESIGN.md) §8, §9, §11.2, §11.4, §11.5, §12.1

## Tasks

#### ✅ 5.1 — Actions and validators

**Goal:** every recorded action is a pure function, and one module says what is valid. **Design:** §11.2, §11.5. **Depends on:** 4.2, 3.2.

**Technical:** `src/actions/`: add, edit, delete and restore an expense; the same for a payment; add and delete a comment; each from intent and the
current rows to a mutation (ids made by the caller, `baseVersion` for edits); `src/actions/validate.ts`: sizes, the category list, known currencies,
members of the group, payers and shares adding up, shares matching the method (`split.ts`), a payment between two different members, the sealed
text within its limits on the device and the `sealed` blob's form and length on the server (`DESIGN.md` §5.3); one result type
of refusals with a reason the screen can say.

**Accepts when:** each action builds the mutation the design's example shows; each refusal in §11.5 has a test; the module imports nothing from the
browser or the server.

**Done as:** `src/actions/`: `types.ts` (the mutation and its changes; each carries `op`, `put`, `delete` or `restore`, which `DESIGN.md` §11.2's
example now shows), `categories.ts` (§8.4's list), `index.ts` (the actions, `expenseRow` from the add sheet's intent through `split.ts`, and `settleUp`
as one payment mutation per group) and `validate.ts`: the plain-text checks the device runs before sealing (`checkExpenseText`, `checkPaymentText`,
`checkCommentText`, counted by code point), `parseMutation` for the shape of what arrived, and `checkExpense`, `checkPayment`, `checkComment` against a
`GroupContext` (member order, active members, the key epoch), with the members of the version being edited allowed though they have left. One
`Checked` result with a `Refusal` code; `refusalSentence` says it with the names the device opened ("Lisbon was closed."). A test reads the module's
imports and finds only `src/money` and `src/cipher`. Left for 5.2: the account's membership, the group's state and rows of another group, which need
the database.

#### ✅ 5.2 — Applying a mutation

**Goal:** the server's one path for a recorded change. **Design:** §11.3, §11.4, §11.5, §8.5. **Depends on:** 5.1.

**Technical:** `src/sync/apply.ts`: in one short transaction, check the account is an active member and the group open (the permission in the
statement), re-run the validators against the stored rows, refuse an id that belongs to another group, then increment `grp.seq`, write the rows
(expense and its payers and shares replaced whole), bump `version`, write the `revision` (created, edited, deleted, restored, or `replaced` when
`baseVersion` is older than the stored version), and record `applied_mutation`; an edit of a deleted row restores it; the same mutation id a second time
answers as before and writes nothing. Activity and notices hook in here (5.4, 9.1).

**Accepts when:** on all three databases: two edits from one base leave the later one stored and the earlier as `replaced`; an edit after a delete
restores; a replayed mutation writes nothing; a refused one writes nothing; a mutation for another person's group reads as not found.

**Done as:** `src/sync/apply.ts` (`applyMutation`) and migration `0005_add_expenses` (`expense`, `expense_payer`, `expense_share`, `payment`,
`revision`, `applied_mutation`, both dialects). The group's `seq` is moved on first, in an `UPDATE` that carries the open group and the account's
active membership, which also orders the group's writes; a failed one says `closed` to a member, `not_in_group` to someone who was one, and
`not_found` to anyone else. The members are read and each change goes through `src/actions/validate.ts` with the members of the stored version
allowed; a row of another group is `not_found`; refusals throw inside the transaction, so nothing at all is written. **Revisions:** one per version,
with the row as written (sealed text still sealed); an edit based on an older version keeps the version it overwrote as `replaced`, under its
author's name, with that version's snapshot (for the notice and "restore my version", 9.1); an edit of a deleted row is `restored`; deleting what
is deleted, or restoring what is not, is applied and writes nothing more. A replay answers with the first answer's `seq`. `People.deletePerson`
deletes the new tables with a group that goes (by `group_id`), keeps them on a group that carries on, and deletes the account's `applied_mutation`
rows; its test seeds one of each. Tested on a file, sqld and PostgreSQL; the replay test failed with the replay check taken out. Comments are refused
as `malformed` until 5.3; activity and notices hook in with 5.4 and 9.1.

#### ✅ 5.3 — Comments

**Goal:** comments on expenses and payments. **Design:** §8.6. **Depends on:** 5.2.

**Technical:** `comment` through the same path: add (the author is the account's person) and delete (the author only); a comment on a deleted expense
allowed; refused in a closed group; plain text, at most 2,000 characters.

**Accepts when:** only the author can delete a comment; a comment written against an expense deleted meanwhile is kept and shows when it is restored.

**Done as:** the `comment` table (migration `0006_add_comments`) and `applyComment` in `src/sync/apply.ts`. A comment is inserted only where its
expense or payment is the same group's, in the same statement (a deleted one included); its author is the account's person; only the author's delete
is applied (`not_author` otherwise), and deleting it twice changes nothing. A closed group refuses it through the `seq` statement, as everything
else. The text is checked on the device (`checkCommentText`, 5.1) and for its sealed form on the server. Comments go with a group that goes and stay,
by the author's name, on one that carries on (`People.deletePerson`, tested). Pruning deleted comments after 30 days joins with 6.x (§11.8).

#### ✅ 5.4 — The activity log and its words

**Goal:** what happened in a group, written with the change and read in words. **Design:** §12.1. **Depends on:** 5.2, 3.2.

**Technical:** `activity` written in the transaction of every applied mutation (5.2) and every operation (3.2, 3.3, 8.2, 8.3); `GET` of a group's
activity and of every group's (paged, filters by group, person and kind, the permission in the statement); `src/activity/describe.ts`, one pure
function giving each line in words from the reader's point of view, run on the device, which opens the sealed text the line's details carry
(`DESIGN.md` §5.3), with a test per kind.

**Accepts when:** every kind in §12.1 is written by the change that causes it, in its transaction; a member who left no longer reads the group's
activity; the words say "You" for the reader.

**Done as:** `src/activity/`: `kinds.ts` (every kind and what its details carry, sealed text as the change carried it), `record.ts` (one insert,
called with the change's transaction), `describe.ts` (the words, pure, on the device, with "an expense" and "the group" where the text cannot be
opened) and `api.ts`, `GET /api/activity` (every group of the account, or one with `group`, filtered by `person` and `kind`, paged with `before`;
only groups the account is an active member of, in the statement), with migration `0007_add_activity`. Written today by the write path (an expense or
payment added, edited, deleted, restored, or `replaced` with whose version it overwrote; a comment, with its expense's sealed description) and by the
group operations (made, renamed, currency, simplify debts, a role); `group_created` is Tally's addition to §12.1's list. Recolouring and what one hears
are not activity. **Not yet written, because their changes do not exist yet:** closed and reopened, left and removed (3.3), added and invited (8.2,
8.3), joined (8.3) and merged (3.4); each of those tasks writes its line. Activity goes with a group that goes and stays on one that carries on
(`People.deletePerson`). Tests: a sentence per kind (and a check that every kind has one), every line written by its change and none by a refused one,
paging and filters, and nothing read by Grace or by a member who left, on a file, sqld and PostgreSQL.
