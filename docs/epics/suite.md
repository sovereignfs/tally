# Epic 11: The suite

## Status

📋 Planned.

## Overview

What a Sovereign instance adds when it hosts Tally: core's bell, email and activity page, and its directory. Each is an addition: with no core, an
older core, or a scope not granted, Tally does the same work alone and nothing fails (`DESIGN.md` §14.5).

## Related

[`DESIGN.md`](../../DESIGN.md) §6.2, §12.3, §14.4, §14.5 · `docs/using-the-sdk.md` in `sovereign`

## Tasks

#### ✅ 11.1 — Core's bell, email and activity

**Goal:** notices and email through core for people linked to it. **Design:** §12.3, §14.5. **Depends on:** 2.3, 9.2.

**Technical:** `src/sovereign/` with `@sovereignfs/sdk`: `sv.app.notifications.send` for kinds whose `core_bell` channel is on, with a link back;
`sv.app.email.sendToUser` by `sub` for kinds with email on, in place of Tally's SMTP when granted (Tally's when not, and always for placeholders); a
`key` per send; `sv.app.activity.log` for export, import and account deletion; sent after the transaction from the same outbox claim as mail, never
holding a transaction across a call; `NotSupportedError` and no core send nothing. The `core` floor checked against core's changelog and raised if
needed.

**Accepts when:** against `createFakeCore`, each kind reaches core's bell by its preference; a core without the scope, or an older one, changes nothing
but that.

**Done as:** `raiseNotices` now writes, beside each notice, a `core_notice` row to the outbox for someone linked to core (`person.core_sub`) whose
`core_bell` is on for that kind (on by default for every kind), and the email row as before, which for someone linked goes through core. The mail job
sends both after the transaction, from the same claim (`deliver` in `src/mail/outbox.ts`), through `sv.app` (`src/sovereign/core.ts`, `@sovereignfs/sdk`'s
client as the app itself, made from the settings alone, as Tusk's): `notifications.send` with a link back, `email.sendToUser` by `sub`, and
`activity.log`, each keyed by the row's id so that a repeat after a lost answer is one send. A refusal (`NotSupportedError`, or 403 for a scope not
granted) is not retried: core's email then falls back to Tally's own mail, and core's bell is given up as `not_permitted`; a core that is down is
retried with the outbox's backoff. A placeholder, and an account not linked, are reached by Tally's mail only. Deleting an account linked to core notes
it on the person's activity page in core. The job runs where there is Tally's mail or a core. Settings shows, for an account linked to core, a switch
for Sovereign's bell beside each kind's email. **The `core` floor stays `>=0.57.0`:** the three services first shipped in core v0.80.0, and an older core
answers "not supported", which changes nothing but that, so Tally works with both. **Left out:** the activity lines for export and import join those
tasks (12.1, 12.2), which write a `core_activity` row. Tests: on each database, against the SDK's fake core, a notice reaching core's bell by the
choice for its kind, only for someone linked, sent once; the choice off writing no row while the bell in Tally keeps it; email through core with no
sealed text, and through Tally's mail where core has no mail; a core too old sending nothing to its bell while Tally's mail still goes; a core that is
down retried and then sent; the deletion noted on the activity page. The choice and the fallback each seen failing when removed.

#### ✅ 11.2 — Core's directory

**Goal:** finding people on the instance, and their placeholders claimed when they arrive. **Design:** §6.2, §14.2, §14.4. **Depends on:** 2.3, 8.2.

**Technical:** the person's refresh token from better-auth's `genericOAuth` into the SDK's `tokenStore`, kept as a `credential` under envelope
encryption (`src/crypto/`), rotated as the SDK requires (one refresh at a time per person); `sv.as({ sub }).directory.searchUsers` behind the Add people
field, debounced, from two characters; choosing someone makes a placeholder with their `core_sub` and the directory's name (or adds their person if they
already have an account here), and tells them through core's bell; signing in through core claims a placeholder by `sub` (2.3). If the SDK cannot be fed
from better-auth as it stands, the gap is raised in `sovereign` and the task waits on it (`DESIGN.md` §22). With no grant, the field searches Tally
alone.

**Accepts when:** against the fake core, a directory person added to a group signs in for the first time and finds the group with their history; the
refresh token is never in a log, an error or the browser; the field works unchanged without the scope.

**Done as:** the manifest and the sign-in ask for `offline_access` and `directory` as well. better-auth keeps core's refresh token encrypted under its
own secret; at every sign-in through core its account hooks hand it to Tally opened (`onCoreToken` in `src/auth/auth.ts`), which seals it under the
instance key in `credential` (migration `0015_add_credentials`, Tusk's table with a unique account and purpose and a lease column;
`src/crypto/credentials.ts` is the one place that writes or reads it). So the SDK could be fed as it stands, and nothing was raised in `sovereign`.
`coreTokenStore` (`src/sovereign/tokens.ts`) is the SDK's `TokenStore` by `sub` over it: a write stores only in place of the token it replaces (a
conditional update on the sealed text read), and a lease in the database lets one process at a time refresh. `directory.search` (`src/sovereign/directory.ts`,
an operation over `/api/ops`, limited per account and minute) searches as the person, from two characters, and says who already has a person here; the
Add people field asks it after a pause in typing and offers whom it finds ("Add Sam · Sovereign"). Choosing one is `member.add` with their `sub`: their
person here, or a placeholder with their `core_sub` and the directory's name, told by core's bell (a `core_notice` row naming the `sub`). Signing in
through core claims it by `sub` (2.3). The token is deleted with the account. Anywhere without core, the instance key or the person's link, and whenever
core says no, the search answers "not available" and the field is as before. Tests: on each database, against the SDK's fake core, the token sealed,
swapped only in place of its predecessor, one lease at a time; a search as the person rotating the token with no reuse, herself left out; someone found
added as a placeholder with their `sub` and told by core's bell, added twice refused, and their first sign-in claiming the group with their share; no
scope, no source and no link answering "not available"; at sign-in, the token handed over opened while better-auth keeps its copy encrypted, at every
sign-in; the token deleted with the account. **Left out:** a browser test of the directory, since the browser tests' fake core (Tusk's) signs in but
serves no directory; the field without it is covered by the existing browser tests.
