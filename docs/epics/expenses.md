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

#### 📋 5.1 — Actions and validators

**Goal:** every recorded action is a pure function, and one module says what is valid. **Design:** §11.2, §11.5. **Depends on:** 4.2, 3.2.

**Technical:** `src/actions/`: add, edit, delete and restore an expense; the same for a payment; add and delete a comment; each from intent and the
current rows to a mutation (ids made by the caller, `baseVersion` for edits); `src/actions/validate.ts`: sizes, the category list, known currencies,
members of the group, payers and shares adding up, shares matching the method (`split.ts`), a payment between two different members; one result type
of refusals with a reason the screen can say.

**Accepts when:** each action builds the mutation the design's example shows; each refusal in §11.5 has a test; the module imports nothing from the
browser or the server.

#### 📋 5.2 — Applying a mutation

**Goal:** the server's one path for a recorded change. **Design:** §11.3, §11.4, §11.5, §8.5. **Depends on:** 5.1.

**Technical:** `src/sync/apply.ts`: in one short transaction, check the account is an active member and the group open (the permission in the
statement), re-run the validators against the stored rows, refuse an id that belongs to another group, then increment `grp.seq`, write the rows
(expense and its payers and shares replaced whole), bump `version`, write the `revision` (created, edited, deleted, restored, or `replaced` when
`baseVersion` is older than the stored version), and record `applied_mutation`; an edit of a deleted row restores it; the same mutation id a second time
answers as before and writes nothing. Activity and notices hook in here (5.4, 9.1).

**Accepts when:** on all three databases: two edits from one base leave the later one stored and the earlier as `replaced`; an edit after a delete
restores; a replayed mutation writes nothing; a refused one writes nothing; a mutation for another person's group reads as not found.

#### 📋 5.3 — Comments

**Goal:** comments on expenses and payments. **Design:** §8.6. **Depends on:** 5.2.

**Technical:** `comment` through the same path: add (the author is the account's person) and delete (the author only); a comment on a deleted expense
allowed; refused in a closed group; plain text, at most 2,000 characters.

**Accepts when:** only the author can delete a comment; a comment written against an expense deleted meanwhile is kept and shows when it is restored.

#### 📋 5.4 — The activity log and its words

**Goal:** what happened in a group, written with the change and read in words. **Design:** §12.1. **Depends on:** 5.2, 3.2.

**Technical:** `activity` written in the transaction of every applied mutation (5.2) and every operation (3.2, 3.3, 8.2, 8.3); `GET` of a group's
activity and of every group's (paged, filters by group, person and kind, the permission in the statement); `src/activity/describe.ts`, one pure
function giving each line in words from the reader's point of view, with a test per kind.

**Accepts when:** every kind in §12.1 is written by the change that causes it, in its transaction; a member who left no longer reads the group's
activity; the words say "You" for the reader.
