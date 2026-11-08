# Epic 11: The suite

## Status

📋 Planned.

## Overview

What a Sovereign instance adds when it hosts Tally: core's bell, email and activity page, and its directory. Each is an addition: with no core, an
older core, or a scope not granted, Tally does the same work alone and nothing fails (`DESIGN.md` §14.5).

## Related

[`DESIGN.md`](../../DESIGN.md) §6.2, §12.3, §14.4, §14.5 · `docs/using-the-sdk.md` in `sovereign`

## Tasks

#### 📋 11.1 — Core's bell, email and activity

**Goal:** notices and email through core for people linked to it. **Design:** §12.3, §14.5. **Depends on:** 2.3, 9.2.

**Technical:** `src/sovereign/` with `@sovereignfs/sdk`: `sv.app.notifications.send` for kinds whose `core_bell` channel is on, with a link back;
`sv.app.email.sendToUser` by `sub` for kinds with email on, in place of Tally's SMTP when granted (Tally's when not, and always for placeholders); a
`key` per send; `sv.app.activity.log` for export, import and account deletion; sent after the transaction from the same outbox claim as mail, never
holding a transaction across a call; `NotSupportedError` and no core send nothing. The `core` floor checked against core's changelog and raised if
needed.

**Accepts when:** against `createFakeCore`, each kind reaches core's bell by its preference; a core without the scope, or an older one, changes nothing
but that.

#### 📋 11.2 — Core's directory

**Goal:** finding people on the instance, and their placeholders claimed when they arrive. **Design:** §6.2, §14.2, §14.4. **Depends on:** 2.3, 8.2.

**Technical:** the person's refresh token from better-auth's `genericOAuth` into the SDK's `tokenStore`, kept as a `credential` under envelope
encryption (`src/crypto/`), rotated as the SDK requires (one refresh at a time per person); `sv.as({ sub }).directory.searchUsers` behind the Add people
field, debounced, from two characters; choosing someone makes a placeholder with their `core_sub` and the directory's name (or adds their person if they
already have an account here), and tells them through core's bell; signing in through core claims a placeholder by `sub` (2.3). If the SDK cannot be fed
from better-auth as it stands, the gap is raised in `sovereign` and the task waits on it (`DESIGN.md` §22). With no grant, the field searches Tally
alone.

**Accepts when:** against the fake core, a directory person added to a group signs in for the first time and finds the group with their history; the
refresh token is never in a log, an error or the browser; the field works unchanged without the scope.
