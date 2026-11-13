# Epic 12: Portability

## Status

📋 Planned.

## Overview

A person can take their groups with them, and bring them into a Tally as new groups, without bringing anyone else in without asking.

## Related

[`DESIGN.md`](../../DESIGN.md) §17

## Tasks

#### 📋 12.1 — Export

**Goal:** one file of what is the person's to take. **Design:** §17. **Depends on:** 5.3, 3.3.

**Technical:** `src/portability/`, made in the browser from the device's store with its sealed fields opened (the server cannot open them,
`DESIGN.md` §5.3), the screen saying the file is plain: the person's profile and settings, and every group they are in, whole (members by name, expenses with payers,
shares and comments, payments), with no other person's email; `format` and `version`; ids kept; Settings > Data downloads it; the activity line on core
when hosted (11.1).

**Accepts when:** the file holds every table the design lists for a group, and no email but the person's own; a test fails when a new table is neither
exported nor named as left out.

#### 📋 12.2 — Import

**Goal:** a file becomes new groups. **Design:** §17. **Depends on:** 12.1, 8.2.

**Technical:** read and validated whole in the browser first, which makes each new group's key and seals its text; validated again and written by
the server in one transaction with ids remapped consistently; the importer as owner, every other member a
placeholder with a name and no email; refused for a newer `version` with a sentence; the round-trip test (export, import into a second account, export
again; equal but for ids, times and the members' kind).

**Accepts when:** the round trip passes on all three databases; a malformed file writes nothing.
