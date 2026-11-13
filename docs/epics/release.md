# Epic 13: Release

## Status

📋 Planned.

## Overview

A seed to develop and demonstrate against, a security review, the documents, the first release, and Tally hosted on the live instance.

## Related

[`DESIGN.md`](../../DESIGN.md) §20 · Tusk's `RELEASING.md`

## Tasks

#### 📋 13.1 — Development seed

**Goal:** a realistic set of groups for development and the browser tests. **Design:** §20 Testing. **Depends on:** 8.3, 5.3.

**Technical:** `pnpm seed`, refusing a non-local `TALLY_URL`: a few accounts, a placeholder with a live invitation, a group in two currencies with every
split method and several payers, a conflict in history, comments, payments, a closed group, and simplify debts on in one group and off in another;
written through the one path (5.2), never around it; `--reset`.

**Accepts when:** a fresh database seeded twice gives the same groups; every screen has something to show.

#### 📋 13.2 — Security review

**Goal:** phase 1 reviewed before it is released. **Design:** §20 Security. **Depends on:** 12.2, 9.3, 11.2.

**Technical:** written up in `docs/security-review.md`: access in every statement (§5.2), sync and what the server re-checks (§11.5), invitations and
claiming (§6.3), emails' visibility (§6.1), deletion (§18), encryption (§5.3: granting, the link's fragment, no sealed text in plain text in any
table, log or mail), the CSP, logs, rate limits, the refresh token; findings fixed or recorded with a decision.

**Accepts when:** the review is merged with no open finding of high severity.

#### 📋 13.3 — Documents

**Goal:** what a self-hoster, an operator and a person need to read. **Design:** §11.6, §20 Deployment. **Depends on:** 1.10.

**Technical:** the README (what Tally is, running it alone in each form, every setting, hosting it), the user's documentation with what needs a network
and what cannot be hidden (§11.6), `RELEASING.md` and `scripts/release.sh` copied from Tusk.

**Accepts when:** someone new runs Tally from the README alone, in each database form.

#### 📋 13.4 — Release 0.1.0

**Goal:** the first published image. **Depends on:** 13.2, 13.3.

**Technical:** `scripts/release.sh check | prepare | propose | tag | verify 0.1.0`; the release PR; the tag; amd64 and arm64 to `ghcr.io/sovereignfs/tally`
with provenance; the package made public.

**Accepts when:** `scripts/release.sh verify 0.1.0` passes against the published image.

#### 📋 13.5 — Hosting on an instance

**Goal:** Tally on the live instance. **Depends on:** 13.4.

**Technical:** from `openfs-suite`: `./sv app add tally --image ghcr.io/sovereignfs/tally:0.1.0`; the three app scopes granted; `TALLY_SMTP_*` and
`TALLY_AUTH_LOCAL=1` in `suite.yml` if people outside the instance are to join; `./sv push && ./sv deploy`; `./sv doctor`.

**Accepts when:** a person signs in from the launcher, a notice reaches core's bell, and someone outside the instance joins a group by invitation.
