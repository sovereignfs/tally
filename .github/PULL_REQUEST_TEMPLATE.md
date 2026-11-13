## What and why

<!-- Describe what changed and why. Focus on the reasoning, not just the mechanics. -->

## Type of change

- [ ] `feat`: new feature or capability
- [ ] `fix`: bug fix
- [ ] `docs`: documentation only
- [ ] `chore`: tooling, scaffolding, dependencies, maintenance

## Design reference

<!-- The DESIGN.md section this implements or changes (e.g. §8.3). Delete if not applicable. -->

## Verification

- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] A regression test was seen to fail against the old code (for a `fix`)
- [ ] A data-layer change was tested on sqld, a `file:` database and PostgreSQL
- [ ] A new route or server action is in `src/access/routes.ts`, with a test calling it as a second person
- [ ] A new table is deleted by `People.deletePerson` and in the export, with a test
- [ ] A write goes through the one path and keeps the arithmetic's invariants (payers and shares add up; a balance is never written)
- [ ] What people write is sealed on the device, and no sealed text reaches a log, a mail or core in plain text
- [ ] `## [Unreleased]` in `CHANGELOG.md` is updated (for a change in behaviour)
- [ ] The task is marked done in `ROADMAP.md` and written up in its epic
- [ ] Relevant docs updated (README, DESIGN, AGENTS)

<!-- Merge with "Rebase and merge" only. Fix commit messages before merging. -->
