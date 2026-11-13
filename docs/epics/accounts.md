# Epic 2: Accounts and sign-in

## Status

📋 Planned.

## Overview

Signing in, locally and through a Sovereign core, from one image, with both on at once when hosted; who may sign up; core's two notices; deleting
everything personal of an account while keeping its name on the shared record. Copied from Tusk's `src/auth/` and `src/sovereign/`, renamed and
trimmed (`DESIGN.md` §5.1).

## Related

[`DESIGN.md`](../../DESIGN.md) §6.4, §14, §16, §18 · Tusk's `DESIGN.md` §6, §22 · `contracts/app-manifest.md` §4, `contracts/env.md`

## Tasks

#### ✅ 2.1 — Local sign-in

**Goal:** accounts of the app's own. **Design:** §14.1, §6.4, §5.3. **Depends on:** 1.5, 1.8, 15.1.

**Technical:** better-auth 1.7 in the `tally_auth` store with its own migrations; password, passkeys, authenticator app with backup codes, when
`TALLY_AUTH_LOCAL` is `1` or `true` (404 otherwise); `TALLY_AUTH_SIGNUP` with `open` and `closed` in the user-creation hook (the hook is shaped so
that 8.3 adds `invite` without moving it); **the password never sent:** every form that takes one (sign-up, sign-in, change, reset) sends the
Argon2id sign-in value of 15.1 in its place, and the minimum length is checked in the browser (a change from Tusk); email verification and reset only
with SMTP; the `Auth` components; `getSession`, `requireAccount`. Copied:
Tusk's `src/auth/`, `src/mail/` (the mailer only), `src/limits/`.

**Accepts when:** the first account can register and the second is refused with sign-up closed; sign-in works on all three databases over real
requests; the pages answer 404 with local sign-in off.

**Done as:** copied from Ledger's same task (itself Tusk's: `src/auth/`, `src/mail/`, `src/limits/`, the four pages, `/api/auth`, the proxy's 404
with local sign-in off, the signed-in layout sending a visitor to `/sign-in`, Sign out in the avatar menu, `src/db/test-store.ts`) and renamed;
better-auth 1.7.22 with its passkey plugin at 1.7.16, as Ledger pairs them. **Tally's change, the password never sent:** the sign-up, sign-in and
reset forms send the Argon2id sign-in value (`src/auth/derive.ts`, 15.1) and check the minimum length themselves; a better-auth `before` hook refuses
any `password`, `newPassword` or `currentPassword` that is not a sign-in value (`PASSWORD_NOT_DERIVED`), and a reset whose address is not the one the
link was sent to (`WRONG_RESET_EMAIL`), so the reset form asks for it. The tests' client derives a stand-in value (SHA-256, the same shape) and can
send a raw one. A browser test watches the sign-in request and finds no password in it, only a 43-character value. Run here: 308 tests on sqld and a
file, 307 on PostgreSQL; 37 browser tests in Chromium and WebKit on a file, and the smoke and auth specs on sqld and PostgreSQL. The hook's tests and
the browser test each failed with their fault planted. **Left out:** the account key made at sign-up (15.2), the person made with the account (3.1),
Sovereign sign-in (2.3) and `invite` (8.3).

#### 📋 2.2 — Landing page and the address `/`

**Goal:** a visitor sees what Tally is; a signed-in person sees Home. **Design:** §15.3. **Depends on:** 2.1.

**Technical:** a static landing page from typed content with no client code; `proxy.ts` serves the signed-in area at `/` for a request with a session
cookie, as Tusk's.

**Accepts when:** `/` shows the landing page signed out and Home signed in, with no redirect loop.

#### 📋 2.3 — Sign-in through core

**Goal:** a Sovereign core as a way in, beside local accounts or alone. **Design:** §14.1, §14.2. **Depends on:** 2.1, 3.1.

**Technical:** `genericOAuth` with PKCE S256 when `TALLY_CORE_*` are all set; redirect `/api/auth/callback/sovereign`; scopes as the manifest
(§14.4); an account made through core whatever `TALLY_AUTH_SIGNUP` says (§6.4); making the account makes its person, or claims the placeholder whose
`core_sub` is the `sub` (§14.2; the placeholder exists once 11.2 is in); no linking by email, linking from a signed-in session only; the fake Sovereign
copied for tests. Capturing the refresh token for the directory is 11.2.

**Accepts when:** sign-in through the fake Sovereign works with local accounts on and off; a core login whose email matches a local account is
refused until linked from a session; a partial `TALLY_CORE_*` stops start-up; sign-up `closed` does not refuse a core sign-in.

#### 📋 2.4 — Core's notices

**Goal:** back-channel logout and account deleted. **Design:** §14.3. **Depends on:** 2.3, 2.5.

**Technical:** `/api/sovereign/backchannel-logout` and `/api/sovereign/account-deleted`, verified by `@sovereignfs/sdk` (`verifyLogoutToken`,
`verifyAccountDeletedToken`), `notice_seen` for replays, a bounded form, a rate limit, 404 without core. Account deleted runs `deletePerson` and
answers `200` only once done. Copied: Tusk's `src/sovereign/http.ts`, `verifiers.ts`, `identity.ts`.

**Accepts when:** against `createFakeCore`, a logout notice ends every session of the person, an account-deleted notice leaves nothing personal of
them and every other member's balances unchanged, and a replayed `jti` is refused after a restart.

#### 📋 2.5 — Deleting a person

**Goal:** one routine that removes everything personal of an account and keeps its name on the shared record. **Design:** §18. **Depends on:** 3.2.

**Technical:** `People.deletePerson` in `src/sovereign/people.ts`: the person kept as a name only (`account_id`, `email`, `core_sub` cleared,
`deleted_at` set); memberships ended where the balance is zero (once 4.3 is in; until then, kept); a group's ownership passed to its longest-standing
member with an account (`owner_passed` once 9.1 is in); a group with no other account deleted by `group_id`; and the rows listed in §18 removed,
the account key, its wraps and its group key wraps included once 15.2 is in;
better-auth's rows and the account; the `sub` link last; safe to run twice. `/api/account/delete` after the password or a fresh session. The test seeds
one row of every table for the person and for a second person sharing a group, and fails for a table nobody decided about. Each later task that adds a
table extends it.

**Accepts when:** after deletion no table holds the person's email, sign-in or anything listed in §18; their name still shows on the second person's
group; the second person's balances are unchanged; a second run succeeds.

#### 📋 2.6 — Settings

**Goal:** Settings as a page and from the avatar menu. **Design:** §16. **Depends on:** 2.1, 1.8, 3.1.

**Technical:** `/settings` with Profile (name and email, written to the account and the person together; primary currency in `account_settings`), the
account sections Tusk has (sign-in methods, passkeys, two-factor, linking core), and Data holding delete account. Notifications arrive with 9.2, Devices
and Unlocking with 15.2, Recovery key with 15.4, This device with 6.3, export and import with 12.1 and 12.2.

**Accepts when:** each section works on all three databases; changing the name changes it on every group the person is in.
