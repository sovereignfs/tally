# Epic 12: Portability

## Status

📋 Planned.

## Overview

A person can take their groups with them, and bring them into a Tally as new groups, without bringing anyone else in without asking.

## Related

[`DESIGN.md`](../../DESIGN.md) §17

## Tasks

#### ✅ 12.1 — Export

**Goal:** one file of what is the person's to take. **Design:** §17. **Depends on:** 5.3, 3.3.

**Technical:** `src/portability/`, made in the browser from the device's store with its sealed rows opened (the server cannot open them,
`DESIGN.md` §5.3), the screen saying the file is plain: the person's profile and settings, and every group they are in, whole (members by name, expenses with payers,
shares and comments, payments), with no other person's email; `format` and `version`; ids kept; Settings > Data downloads it; the activity line on core
when hosted (11.1).

**Accepts when:** the file holds every table the design lists for a group, and no email but the person's own; a test fails when a new table is neither
exported nor named as left out.

**Done as:** `src/portability/format.ts`, pure: `buildExport` makes the file (`format: "tally"`, `version: 1`, `exportedAt`) from the device's rows
and the opened text: the profile (name, the person's own address, primary currency, the choices of what they are told), and every group whole, its
members by name with their role and kind, its expenses with payers, shares and comments, and its payments with theirs, ids kept, in order of date,
time and id. What is there, not what was deleted. The device holds no one else's address, so none can be in it. `EXPORTED_TABLES` and
`LEFT_OUT_TABLES` say what of every table the file carries or why it is left out (keys and secrets, versions and activity, markers and counters).
`src/portability/collect.ts` makes it in the browser from the device's store, opening each sealed text with the group's key here, and counts what
cannot be opened yet, which the file leaves out rather than guessing and the screen says. Settings, Data, Export downloads it after a sync, saying
the file is plain text, and notes it on the person's activity page in core when hosted (`/api/account/exported`, `src/sovereign/activity.ts`, which
import will use too). Tests: the file from a fixture of two groups, text opened, the deleted out, comments under what they are on with their author,
what could not be opened counted, no address but the person's own, the same twice but for its time; every table of the store decided, seen failing
for one left undecided; the note on core for someone linked and nobody else; in Playwright, Chromium and WebKit, the download from Settings holding
the group by name and its expense's words, and no other address. Tusk's export format was the model; nothing of it is copied, since Tally's
groups are not Tusk's boards.

#### ✅ 12.2 — Import

**Goal:** a file becomes new groups. **Design:** §17. **Depends on:** 12.1, 8.2.

**Technical:** read and validated whole in the browser first, which makes each new group's key and seals its text; validated again and written by
the server in one transaction with ids remapped consistently; the importer as owner, every other member a
placeholder with a name and no email; refused for a newer `version` with a sentence; the round-trip test (export, import into a second account, export
again; equal but for ids, times and the members' kind).

**Accepts when:** the round trip passes on all three databases; a malformed file writes nothing.

**Done as:** in the browser, `validateFile` (`src/portability/validate.ts`, pure) checks the file whole, every figure held to the rules a change is
held to (`checkExpense`, `checkPayment` and the text checks, against the group's members in their order), and refuses a newer `version` with a
sentence; `prepareImport` (`prepare.ts`) gives every group, member, expense, payment and comment a new id, mapped consistently, has the device make
each group's key (`GroupKeys.keyForImport`, kept on this device and wrapped to the account's key) and seals the name and every text under it. Only
sealed text leaves the device. On the server, `importGroups` (`import.ts`, `POST /api/import`) checks every row again and writes all the groups in one
transaction, or none: the importer each group's owner (their own member, or one added for them), everyone else a placeholder with their name and no
email, the members' order kept (a split's leftover follows it); the rows are written by `importGroupRows` in `src/sync/apply.ts`, as created, with
their first revision. A group comes in open; a closed one in the file is opened. Settings, Data, Import reads the file and says what it made, or why
not; an import is noted on core's activity page when hosted. The export now lists payers and shares in member order, as the server keeps them, so a
file is the same whichever way the rows were read. Tests: on each database, the round trip (a file of two groups and two currencies, with a member who
left, a comment, a split's leftover and three split methods, imported into a second account and exported again: equal but for ids, times and the
members' kind); the importer the owner of each and everyone else a placeholder with no email; a newer version refused with its sentence, a split that
does not add up refused; a wrong row in the last group, and a sealed name not in form, writing nothing. In Playwright, Chromium and WebKit: the
downloaded file imported back as a copy, owned and opened at once with its expense's words; a newer file refused with its sentence.
