# Tally

Split shared expenses with the people you share them with, and see who owes whom. Tally runs on its own or on a
[Sovereign](https://github.com/sovereignfs/sovereign) instance.

A trip, a flat, a dinner club: people record what they spent for the group, Tally keeps everyone's balance in each currency, and payments made outside
the app are recorded to settle up. Expenses can be recorded offline and sync in the background, and what people write in a group is sealed so that
only its members can read it. It replaces the Sovereign tally plugin; none of its code is carried over.

**Status: being built.** Nothing runs yet. [`DESIGN.md`](DESIGN.md) says what Tally is and how it is built, [`ROADMAP.md`](ROADMAP.md) puts the work
in order, and [`docs/epics/`](docs/epics/) holds each task. How to work on it is in [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).

## Develop

You need Node 24.15 or newer and [pnpm](https://pnpm.io) (the version is `packageManager` in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm dev   # http://localhost:3004
```

## Licence

AGPL-3.0-or-later. Bundling `@sovereignfs/ui` makes it so, and every dependency's licence must be compatible.
