# Epic 6: Offline and sync

## Status

📋 Planned.

## Overview

The device holds every group the account is in and records without a network; the server checks, orders and hands on every change. The shape is Tusk's
Desk (its `src/sync/`, local store and loop, copied and adapted), with the order kept per group rather than per account, since a group is written by
several people (`DESIGN.md` §11.3). Each task says what it took from Tusk and what changed.

## Related

[`DESIGN.md`](../../DESIGN.md) §11, §15.11 · Tusk's `DESIGN.md` §8, §17.9

## Tasks

#### 📋 6.1 — The sync endpoint

**Goal:** `POST /api/sync`. **Design:** §11.3. **Depends on:** 5.2.

**Technical:** session and `Origin` checked; a bounded body; a protocol version; the outbox applied in order through 5.2, each answered applied or
refused with its reason; then, for the account's current groups (membership read in the statement), rows whose `seq` is past each cursor, paged at
`seq` boundaries, tombstones included; groups the account is no longer in named as gone; a rate limit. Shape from Tusk's `src/sync/`, with cursors per
group.

**Accepts when:** a device starting at zero gets each group whole; a cursor gets only what is new; a group left between two syncs is named gone and its
rows stop; a lost answer retried applies nothing twice.

#### 📋 6.2 — The device's store, outbox and loop

**Goal:** screens read and write the device, and the loop syncs. **Design:** §11.1, §11.3, §11.7. **Depends on:** 6.1.

**Technical:** `src/local/`: IndexedDB through `idb`, one database per account (`tally-<account id>`), the group tables of §19.3's device store; a
write applies to the store and the outbox in one IndexedDB transaction, through the actions of 5.1; a store reader with change events for React; the
loop (after a write, debounced; on load, focus, coming online; every 30 seconds while visible), one tab at a time (Web Locks), others told
(BroadcastChannel); server rows replace local ones on pull, and outbox entries still pending are re-applied on top; sign-out deletes the database
after trying to send; an ended session keeps the outbox; `navigator.storage.persist()`. Shape from Tusk's Desk.

**Accepts when:** with `fake-indexeddb`, a write is visible at once and sent once; two tabs do not both sync; in Playwright, two browsers in one group
converge, one of them having recorded offline.

#### 📋 6.3 — Couldn't sync

**Goal:** a refused change is kept, explained, and recoverable. **Design:** §11.5. **Depends on:** 6.2.

**Technical:** a refused expense or payment moves from the outbox to a `failed` store with its reason, and leaves the group's screens; a refused
comment is undone with a toast; Settings > This device lists them with Fix and send again (opens the add sheet), Move to another group, and Discard; a
mark on the avatar while any are there; last synced time; Reset this device.

**Accepts when:** an expense recorded offline in a group closed meanwhile lands in Couldn't sync with "Lisbon was closed", and can be moved to another
group and synced.

#### 📋 6.4 — Opening offline

**Goal:** a signed-in address opens with no network. **Design:** §15.11. **Depends on:** 6.2, 1.11.

**Technical:** as Tusk's §17.9: the service worker answers a signed-in address (`/`, `/groups`, `/g/…`, `/people/…`, `/insights`) with the kept shell
page, headers and all; the page finds who is signed in on the device (`src/identity.ts`, kept by every signed-in page and removed at sign-out) and
renders from the store; every other address gets the worker's offline page; Background Sync registered for the outbox.

**Accepts when:** in Chromium, with the network off after one visit, Home and a group open from the device and an expense can be added; the worker's
test shows no page with data is cached.

#### 📋 6.5 — Keeping the history small

**Goal:** tombstones and records that do not grow for ever. **Design:** §11.8. **Depends on:** 6.1, 1.6.

**Technical:** a pruning job: deleted comments removed after 30 days (leaving tombstones); tombstones and `applied_mutation` after 90 days; a cursor
older than what was pruned answered with a fresh snapshot of that group, the device sending its outbox first.

**Accepts when:** a device away for longer than the window resyncs to the same rows as a fresh device; the job is safe from two processes.
