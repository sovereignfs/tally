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

#### ✅ 6.1 — The sync endpoint

**Goal:** `POST /api/sync`. **Design:** §11.3. **Depends on:** 5.2.

**Technical:** session and `Origin` checked; a bounded body; a protocol version; the outbox applied in order through 5.2, each answered applied or
refused with its reason; then, for the account's current groups (membership read in the statement), rows whose `seq` is past each cursor, paged at
`seq` boundaries, tombstones included; groups the account is no longer in named as gone; the key exchange of 15.3 folded in (wraps the account lacks,
wraps it is asked for); a rate limit. Shape from Tusk's `src/sync/`, with cursors per group.

**Accepts when:** a device starting at zero gets each group whole; a cursor gets only what is new; a group left between two syncs is named gone and its
rows stop; a lost answer retried applies nothing twice.

**Done as:** `src/sync/format.ts` (the protocol, version 1, and its limits), `src/sync/pull.ts` and `src/sync/endpoint.ts` (`handleSync`,
`syncHandler`), routed at `app/api/sync/route.ts`. From Tusk's `src/sync/endpoint.ts`: the body read to a limit (413), the protocol checked first (426
with the version), a request refused whole only when it is not one (400) or comes too often (429, `sync:<account>`, 120 a minute), and each mutation
answered on its own; `readCapped` was already Tally's. **Changed from Tusk:** a cursor per group (`cursors`), answered per group with the group's row,
its members (names only, never an email), expenses with payers and shares, payments and comments past the cursor, paged at `seq` boundaries with a
row budget shared by the request's groups; a cursor past a group's counter restarts that group from its snapshot; groups the device named and the
account is no longer in are `gone`; the key exchange is folded in (`grants` in the request; `wraps`, `needed` and `rotations` in the answer), so a
device needs no second request. Every statement of the pull carries the account's active membership. Tombstones are in the shape and empty until
pruning (6.5) removes rows. Tested on a file, sqld and PostgreSQL; the paging test failed when a page ended past its boundary.

#### ✅ 6.2 — The device's store, outbox and loop

**Goal:** screens read and write the device, and the loop syncs. **Design:** §11.1, §11.3, §11.7. **Depends on:** 6.1.

**Technical:** `src/local/`: IndexedDB through `idb`, one database per account (`tally-<account id>`), the group tables of §19.3's device store; a
write applies to the store and the outbox in one IndexedDB transaction, through the actions of 5.1, its text sealed as the row's blob under the group's newest epoch, or
sealed once the key arrives (15.3); sealed blobs kept as they arrived and opened in memory; a store reader with change events for React; the
loop (after a write, debounced; on load, focus, coming online; every 30 seconds while visible), one tab at a time (Web Locks), others told
(BroadcastChannel); server rows replace local ones on pull, and outbox entries still pending are re-applied on top; sign-out deletes the database
after trying to send; an ended session keeps the outbox; `navigator.storage.persist()`. Shape from Tusk's Desk.

**Accepts when:** with `fake-indexeddb`, a write is visible at once and sent once; two tabs do not both sync; in Playwright, two browsers in one group
converge, one of them having recorded offline.

**Done as:** `src/local/db.ts` (`tally-<account>`: the group tables, `shadow`, `outbox`, `failed`, `meta`), `src/local/store.ts` (`checkLocally`
runs the server's validators against the device's copy of the group; `commitMutation` writes rows and outbox in one transaction; `settle` takes back
every unanswered change through `shadow`, moves answered entries out, refused ones to `failed`, lays the pull down, removes gone groups and applies
what still waits on top), `src/sync/client.ts` (`SyncClient`: commit, rounds of sync, the key exchange folded in through `GroupKeys.exchange`, which
`GroupKeys.sync` now uses too; `fetchTransport`), `src/sync/loop.ts` (copied from Tusk's; changed: every 30 seconds and only while visible, no
deleted-account outcome), `src/sync/device.ts` (one device per account per page, `navigator.storage.persist()`, a `BroadcastChannel` to the other
tabs, and `signOutDevice`, which tries once more to send and then deletes the store, from the account menu and from deleting the account) and
`src/sync/react.tsx` (`SyncProvider` in the signed-in layout, `useSync`, `useStoreChanges`); `idb` added, as Tusk's. **Changed from Tusk:** a whole row
is laid over, never a field, since an expense travels whole. Tests: the loop with every timer and lock given (debounce, focus, online, 30 seconds only
while visible, one tab, back-off, an ended session); two devices over the real endpoint on a file, sqld and PostgreSQL (a write at once and sent once,
a refusal at once on the device, one device offline while the other records and both ending with the same rows, a refused change in `failed`); sign-out
sending once more and deleting the store, an ended session keeping the outbox. **Left out:** writing to a group the device has not unlocked yet,
with the text queued until the key arrives (a write today needs the key; it joins the add sheet, 7.x); the two-browser Playwright convergence, which
needs a screen that records an expense (7.x) and is covered here by the two-device test over the real endpoint; `KeyGate` still runs its own
30-second key exchange beside the sync's, which is harmless and goes when Settings' This device lands (6.3).

#### ✅ 6.3 — Couldn't sync

**Goal:** a refused change is kept, explained, and recoverable. **Design:** §11.5. **Depends on:** 6.2.

**Technical:** a refused expense or payment moves from the outbox to a `failed` store with its reason, and leaves the group's screens; a refused
comment is undone with a toast; Settings > This device lists them with Fix and send again (opens the add sheet), Move to another group, and Discard; a
mark on the avatar while any are there; last synced time; Reset this device.

**Accepts when:** an expense recorded offline in a group closed meanwhile lands in Couldn't sync with "Lisbon was closed", and can be moved to another
group and synced.

**Done as:** in `src/local/store.ts`, `settle` keeps a refused expense or payment in `failed` and lets a refused comment go (the client's `onRefused`
tells the screen, for the toast); `resendFailed`, `discardFailed` and `moveFailed`, which records the change in another group as new, finding its
people there by person, working the split out again by that group's order and sealing the text again for its new row (`GroupKeys.reseal`), and
refuses a move naming whom the other group lacks. `SyncClient` has `resend`, `move` and `discard`. Settings has a **This device** section
(`src/account/DeviceSection.tsx`): last synced, what waits to be sent, Couldn't sync with the reason in `refusalSentence`'s words and Send again,
Move there and Discard, and Reset this device (`resetDevice`), which says how many changes would be lost first. The avatar has a dot and a
"Couldn't sync (n)" item while any are waiting (`watchFailed`), composed beside the design system's `UserMenu`, which has no badge of its own.
**Changed from the epic:** "Fix and send again" is Send again until the add sheet exists (7.x), which will open it filled in. Tests: an expense
recorded offline in a group closed meanwhile lands in `failed` with "Lisbon was closed." and moves to another group and syncs, on a file, sqld and
PostgreSQL; the section in Playwright.

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
