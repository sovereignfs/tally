# Epic 1: Foundation

## Status

📋 Planned.

## Overview

The repository that can hold Tally as `DESIGN.md` designs it: a Next.js app that runs alone or hosted, on three forms of database. Nothing a person
would notice. **Tusk is the model throughout, and its infrastructure is copied** (`DESIGN.md` §5.1), renamed to `TALLY_`, and trimmed of what Tally
does not use (workspaces, the Desk's personal key and the operator-key mode, the cipher, backup to git). Tally's encryption is its own (epic 15). Ledger made the same copy days earlier; where Ledger already trimmed a file the same way, its
copy may be the starting point, and the task says so. Each task says which files it copied.

## Related

[`DESIGN.md`](../../DESIGN.md) §5, §15.11, §19, §20 · Tusk's and Ledger's `docs/epics/foundation.md`

## Tasks

#### ✅ 1.1 — Repository conventions

**Goal:** the files a repository of the suite is expected to have. **Design:** §20, `AGENTS.md`. **Depends on:** nothing.

**Technical:** `LICENSE` (AGPL-3.0-or-later), `CHANGELOG.md` with `[Unreleased]`, `CONTRIBUTING.md`, `README.md`, PR template, Dependabot,
`.editorconfig`, `.node-version`; `package.json` (`@sovereignfs/tally`, `type: module`, engines `>=24.15 <25`, pnpm 11 with `minimumReleaseAge` and
`allowBuilds`); Next.js 16 (latest stable), React 19, TypeScript 6.0.x strict with `noUncheckedIndexedAccess`; `@sovereignfs/ui`, `sdk`, `config`,
`manifest` pinned exactly at Tusk's versions.

**Accepts when:** a clean checkout installs with `pnpm install --frozen-lockfile`, `pnpm typecheck` passes, and `git status` is clean after.

**Done as:** copied from Ledger's same task (itself Tusk's, renamed) and renamed for Tally: licence (AGPL-3.0-or-later), changelog, contributing
guide, pull request template (with Tally's checks: the one write path, sealed text), Dependabot, `.editorconfig`, `.node-version` (24.18.0),
`.gitignore`, `.prettierignore`, `pnpm-workspace.yaml` (engine-strict, every platform in the lockfile, `minimumReleaseAgeExclude` for
`@sovereignfs/ui@0.92.0` only, `allowBuilds`), `tsconfig.json` (strict, `noUncheckedIndexedAccess`); `package.json` (`@sovereignfs/tally`, port 3004) with Next.js 16.4, React 19.3, TypeScript 6.0.3, `@sovereignfs/ui` pinned at Tusk's 0.92.0. Prettier and ESLint configs came with the copy, as in
Ledger; their scripts are made to pass in 1.2. **Left out:** `@sovereignfs/config`, `sdk` and `manifest`, added by the tasks that use them (1.4, 2.3,
1.10), as Ledger did. A placeholder page keeps `next typegen` honest until the shell (1.8).

#### ✅ 1.2 — Format, lint and test tooling

**Goal:** the checks every later task runs. **Design:** §20 Testing. **Depends on:** 1.1.

**Technical:** Prettier and ESLint as Tusk's (copied configs); Vitest with the design system inlined and files run one after another, and
`fake-indexeddb` for the browser store's tests (6.2); scripts `format`, `format:check`, `lint`, `typecheck` (`next typegen && tsc --noEmit`), `test`;
one real test.

**Accepts when:** each check passes, and each is seen to fail on a planted fault.

**Done as:** Prettier and ESLint with Tusk's configuration, arrived with 1.1's copy (strict TypeScript rules, jsx-a11y, allowed on ESLint 10 by one
named peer rule); `vitest.config.ts` copied from Ledger's same task (the design system inlined for its CSS Modules, files one after another, the `@/`
alias); `fake-indexeddb` 6.2 as a dev dependency, unused until 6.2 imports it per test file as Tusk does; `src/smoke.test.ts` reads `package.json`, so
a runner that finds nothing cannot pass. Each of `format:check`, `lint` (an unused variable, and an image with no `alt`), `typecheck` and `test` was
seen to fail on a planted fault and pass once it was removed. **Left out:** git hooks, as in Ledger.

#### ✅ 1.3 — Continuous integration

**Goal:** CI that runs what a change can affect. **Design:** §20. **Depends on:** 1.2.

**Technical:** Tusk's `ci.yml` and its change classifier, copied; legs for format, lint, types, unit tests; the database legs join with 1.5, the image
with 1.10, the browser with 1.9. Skipped on drafts and `skip-ci`.

**Accepts when:** a PR runs only the legs its files affect, and a failing leg fails the PR.

**Done as:** copied from Ledger's same task (Tusk's CI): `scripts/ci-changes.sh` and its tests, and `.github/workflows/ci.yml`, a `changes` job with the
draft and `skip-ci` guard, then `check` (format, lint, types, build, test) and `scripts` (shellcheck, the classifier's tests); a push to `main` and a
weekly schedule always run. Changed: two strings naming Ledger's own task and file. Checked locally: actionlint and shellcheck clean, the classifier's 40
cases pass and one planted wrong expectation fails, `pnpm build` passes. **Left out:** it has not run on GitHub yet, so "a failing leg fails the PR" is
proved by the workflow's structure, not seen. The database, browser and image legs join with 1.5, 1.9 and 1.10.

#### ✅ 1.4 — Configuration and start-up

**Goal:** settings declared once and checked before anything is served. **Design:** §14.1, §20 Deployment. **Depends on:** 1.2.

**Technical:** `@sovereignfs/config` with prefix `TALLY`: `URL`, `AUTH_SECRET`, `AUTH_LOCAL`, `AUTH_SIGNUP` (`open`, `closed`; `invite` joins with
8.3 once 14.5 is released), `AUTH_PASSWORD_MIN_LENGTH`, `CORE_*`, `DB_*`, `SMTP_*`, `ENCRYPTION_KEY(_PREVIOUS)`, `WORKER`; `_FILE` forms for secrets;
`instrumentation.ts` hands to `instrumentation-node.ts`, which checks and stops on a wrong setting; `.env.example` held to the declarations by a test;
`/api/health`. Copied: Tusk's `src/config/`, instrumentation.

**Accepts when:** a missing or malformed setting stops start-up with every problem named and no value printed; `.env.example` matches the code.

**Done as:** copied from Ledger's same task (itself Tusk's `src/config/` and instrumentation, trimmed) and renamed: `src/config/` (`env.ts`,
`index.ts`, `current.ts`, `edge.ts`), `instrumentation.ts` and `instrumentation-node.ts`, `next.config.ts` (standalone output), `src/site.ts`,
`/api/health`, `.env.example`; every setting declared once through `@sovereignfs/config` 0.1.0 (prefix `TALLY`, secrets in the `_FILE` form,
exact-pinned and in `minimumReleaseAgeExclude`). Changed: Ledger's exchange-rate settings removed; `.env.example` describes Tally's jobs, mail and
`AUTH_SIGNUP`'s coming `invite`. Checked here: `TALLY_URL`, `WORKER`, the instance key with its previous one, and the all-or-none `CORE_*`; the
database, sign-in and mail settings are declared and listed, and checked by the tasks that read them (1.5, 2.1, 8.1). `src/crypto/keys.ts` and
`envelope.ts` are copied with their tests for core's refresh token; the `credential` table comes with 11.2, its first use. `process-env.test.ts`
holds `process.env` to `src/config` and `.env.example` to the declarations, and failed when a setting was taken out of it. The built server, given
four wrong settings, named all four, printed no value and exited 1; given good ones, `/api/health` answered 200. **Left out:** `/api/health` asks
nothing yet; 1.5 makes it answer 200 only when the database does.

#### ✅ 1.5 — The database layer

**Goal:** three forms, two dialects, migrations at start-up. **Design:** §19.1, §19.2. **Depends on:** 1.4.

**Technical:** copy Tusk's `src/db/` (config, clients, provision, migrate, boot with retries and `DB_CONNECT_TIMEOUT_MS`, `exec.ts`, the column
vocabulary, `test-support.ts` reading `TALLY_TEST_*`); add a `money` column (64-bit minor units, checked safe on read), as Ledger's; the two stores
`tally` and `tally_auth`; `pnpm db:generate`, `pnpm db:dev`; the parity test; CI legs on sqld, a file and PostgreSQL.

**Accepts when:** an empty database of each form is provisioned and migrated at start-up, twice safely; CI fails if generating would write anything.

**Done as:** copied from Ledger's same task (itself Tusk's) and renamed: `src/db/` (config, client, provision, migrate, boot with retries and
`DB_CONNECT_TIMEOUT_MS`, `exec.ts`, the sqld namespaces, `test-support.ts` reading `TALLY_TEST_*`), the drizzle configs, `scripts/db-generate.mjs`,
`dev-db.mjs`, `boot-check.mjs`, `serve-standalone.mjs`, and CI's `tests` legs for the three forms with the check that generating writes nothing;
`/api/health` now answers 200 only when the database does, and the server will not start without one. The column vocabulary is `id`, `ref`,
`epochMs`, `counter`, `money` (a 64-bit integer, `bigint` on PostgreSQL), `bool`, `isoDate` and `json`: Ledger's without its `month` and `decimal`,
which Tally does not use. The app store has `rate_bucket` so far; **the migrations were generated anew** from Tally's schemas (`0000_init` in each
of the four sets) rather than copied, so better-auth's tables are one migration here, not Ledger's two. Run here: the tests on sqld, a `file:`
database and PostgreSQL (125 passed on the first two, 124 and one more skipped on PostgreSQL), `pnpm boot-check` from empty and again on the migrated
database for each form, and a planted schema change that made generating write a migration. **Left out:** CI has not run on GitHub (the account's
billing stopped the last run).

#### ✅ 1.6 — The job runner

**Goal:** background work in the web process, safe across processes. **Design:** §5. **Depends on:** 1.5.

**Technical:** copy Tusk's `src/jobs/` (runner, `claim.ts`, `index.ts`) and `job_claim`; `TALLY_WORKER=off`; stopped on SIGTERM.

**Accepts when:** a job's work is done once when two processes run it; SIGTERM stops the runner and the server cleanly.

**Done as:** `src/jobs/` (`runner.ts`, `claim.ts`, `index.ts`) and their tests copied from Ledger's same task (itself Tusk's) and renamed; the list
of jobs is empty, and the tasks that have one add it (6.5, 8.1, 9.1). The runner starts from `instrumentation-node.ts` after the database, is off
with `TALLY_WORKER=off`, and stops on SIGTERM and SIGINT. **No `job_claim` table**, as Ledger decided: a claim is a conditional `UPDATE … RETURNING`
on the table whose work it is, and `DESIGN.md` §19.3 says so. Run here: the job tests on sqld, a file and PostgreSQL (22 each, the claim racing two
handles); two Node processes racing the claim over 300 rows, as the app opens each database, came to exactly 300 on PostgreSQL (94 and 206) and on a
SQLite file three times over; the built server answered SIGTERM within a second with nothing left listening, and ran no job with `TALLY_WORKER=off`.
**Found here, and fixed after it:** on the SQLite file form, after a write waits out the 5-second busy timeout and fails, libSQL's client (0.18)
answers the next write on that connection as done and never saves it. `src/db/busy.ts` guards the file client (`createFileClient` in
`client.ts`): a busy failure from any call or any statement of a transaction makes it replace its connections before the error goes on. Two
regression tests in `busy.test.ts`, with a second process holding the lock, failed without the guard and pass with it. Tusk and Ledger have the
same database layer and the same exposure.

#### ✅ 1.7 — Security headers

**Goal:** the CSP and headers every response has. **Design:** §20 Security. **Depends on:** 1.4.

**Technical:** copy Tusk's `proxy.ts` and `src/security/` (nonce CSP, `connect-src 'self'`, no `'unsafe-inline'`, HSTS over https, Edge discipline).

**Accepts when:** every response, including errors and redirects, carries the policy; a test fails if `'unsafe-inline'` appears in `script-src`.

**Done as:** copied from Ledger's same task (Tusk's `src/security/csp.ts` and its tests, `proxy.ts` written for Ledger) and renamed: a nonce per
request, `script-src 'self' 'nonce-…' 'strict-dynamic'` and never `'unsafe-inline'`, `connect-src 'self'`, HSTS over https only, the static headers
from `next.config.ts`, any nonce or policy the client sent replaced, `/api/` treated as data (no policy, no nonce). The policy's comment says why it
matters more here: a page holds the keys that open a group's sealed text (§5.3). **A change from Ledger:** Next's own trailing-slash redirect is
answered before the proxy and the configured headers, so it went out with none; `skipTrailingSlashRedirect` turns it off and the proxy makes the
same 308 with every header, tested. Seen on the built server: a page, a 404, an API, a page's and an API's redirect, and https, each with the headers
it should have; in the browser pane under the production policy, the theme script ran, the font loaded, a client navigation worked, and the console
was empty. A planted `'unsafe-inline'` in `script-src` failed four tests. **Left out:** `'wasm-unsafe-eval'`, which 15.1 adds if its Argon2id is
WebAssembly.

#### ✅ 1.8 — Design system boundary and shell

**Goal:** `@sovereignfs/ui` wired in, with the app's frame. **Design:** §15.1, §15.2. **Depends on:** 1.2.

**Technical:** tokens and Hanken Grotesk served by the app; `src/theme/` sets `data-theme` before paint; `AppShell` with the header (wordmark, a place
for the bell, the avatar menu) and the sidebar's frame (_Add expense_, the four places, the Groups section left empty), full or a rail, remembered on
the device; `MobileFooter` at a phone's width; the app's CSS check (only `--sv-*` colours); Tally's mark in `public/icons/`; not-found and error pages.
The places are filled by epic 7.

**Accepts when:** the shell renders in light and dark at desktop and phone widths, with no literal colour anywhere.

**Done as:** from Ledger's same task (itself Tusk's) and renamed: the root layout (`@sovereignfs/ui` tokens, Hanken Grotesk from the package, the
theme script with the proxy's nonce once 1.7 makes one, `ToastProvider`), `globals.css`, `src/theme/`, `src/ui/design-tokens.ts` and its test (no
literal colour, no undefined token; seen to fail on a planted `#ff0000`), `no-fork.test.ts`, the not-found, error and loading pages; `@dnd-kit/core`
and `sortable` added as the design system's peers. Tally's own: `src/ui/nav.ts`, the one list of places (Home, Groups, People, Activity, Insights,
tested), and `AppShell` with the header (the sidebar's ☰, the wordmark _tally._, slots for the bell and the avatar menu), the sidebar (Add expense,
Home, People, Activity, Insights, then Groups with _New group_), and on a phone `MobileFooter` with Home and Groups left, People and Activity right,
its middle button opening a drawer with Add expense and Insights. **The sidebar is full or a rail of icons**, chosen with ☰ and kept in this browser
(`tally.sidebar`), put on the page as `data-sidebar` by the theme script before first paint; its rows are the app's own, as Tusk's are, since
`NavList` has no rail. `TallyMark` and `public/icons/icon.svg` are a tally of five. A placeholder page for each place. Seen in the browser pane: light
and dark, at 1280px and 375px, the rail kept across a reload, the drawer open, the not-found page; no console error but that page's own 404.
**Left out:** Add expense and New group are drawn disabled until 7.2 and 7.1; the design system has no chart icon, so Insights uses
`layout-dashboard` until the charts (14.1) bring one; the PNG icons come with the PWA (1.11).

#### 📋 1.9 — Browser tests

**Goal:** Playwright on the built app. **Design:** §20 Testing. **Depends on:** 1.5.

**Technical:** Tusk's Playwright setup copied: Chromium and WebKit, the database form from the environment, shards in CI; a helper for a second
browser context (for sync tests) and for going offline (`context.setOffline`).

**Accepts when:** a smoke test opens the built app on each database form in CI.

#### 📋 1.10 — The image and deployment setups

**Goal:** one image, three Compose setups. **Design:** §14.4, §20 Deployment. **Depends on:** 1.5, 1.6.

**Technical:** `sovereign.manifest.json` (§14.4) with `pnpm manifest:check` and a test holding it to the code (port 3004 everywhere); Tusk's Dockerfile
(Debian, `USER node`, `ARG PORT`, migrations beside the server, licences) built with `sovereign-manifest docker-args`; `deploy/` for sqld, a file and
PostgreSQL; `scripts/deploy-check.sh`; `publish.yml` on a `vX.Y.Z` tag.

**Accepts when:** `scripts/deploy-check.sh` boots every setup from nothing and as an instance would host it, answering `/api/health` with `200`.

#### 📋 1.11 — The PWA

**Goal:** installable, with a service worker that keeps the shell only. **Design:** §15.11. **Depends on:** 1.8.

**Technical:** copy Tusk's `src/sw/` and `app/manifest.ts` (name Tally, icons with a maskable one, `display: standalone`); an allow-list of build
files and icons; the public shell page holding nothing of a person; an offline page for every other address. Answering signed-in addresses offline is
6.4.

**Accepts when:** the app installs in Chromium; a test of the worker's source shows it caches nothing outside the allow-list.
