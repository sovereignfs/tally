# Tally

Split shared expenses with the people you share them with, and see who owes whom. Tally runs on its own or on a
[Sovereign](https://github.com/sovereignfs/sovereign) instance.

A trip, a flat, a dinner club: people record what they spent for the group, Tally keeps everyone's balance in each currency, and payments made outside
the app are recorded to settle up. Expenses can be recorded offline and sync in the background, and what people write in a group is sealed in their
browsers so that only its members can read it. It is a web app that installs like any other (a PWA), with its own database (an sqld service, a SQLite
file or PostgreSQL), and people sign in with a password, a passkey and an authenticator app, through a Sovereign instance, or both. It replaces the
Sovereign tally plugin; none of its code is carried over.

## What is here

- **Groups** in any currency, with people who have an account and people who are **not on Tally yet** (a name, and an invitation link to take their
  place). Owners rename, close, reopen and delete; anyone leaves once settled up.
- **Expenses** split equally, by amounts, by percentages or by shares, paid by one person or several, with a category, a note and comments; every
  change kept in its history, and an edit that crossed another kept so that it can be restored.
- **Balances** per currency, never converted, pairwise or with debts simplified; **payments** to settle up, suggested or by hand; a **reminder** to
  someone who owes you, once a day.
- **Working offline:** what you record is on your device at once and sent when you are back online.
- **Sealed:** a group's name, descriptions, notes and comments are sealed in the browser under the group's key; the server never holds a key that opens
  them. A new device unlocks with the password or passkey that signs it in, or by another of your devices; a recovery key is offered, never required.
- **Notices** in the bell and, as you choose, by email; on a Sovereign instance, in its bell and through its email too.
- **Insights:** what you spent, by category, by month and by group, as your share of each expense; a group's spending by member.
- **Your data:** download everything as one file, import a file as new groups, delete your account.

[`ROADMAP.md`](ROADMAP.md) has what comes next, and [`DESIGN.md`](DESIGN.md) says how all of it works. What changed in each release is in
[`CHANGELOG.md`](CHANGELOG.md); [`RELEASING.md`](RELEASING.md) says how a release is made.

## Run it

You need Docker, a domain with TLS in front of it, and three values: the address people use, a secret to sign sessions, and a key for stored
credentials. The smallest setup is one container and one SQLite file:

```bash
docker run -d -p 127.0.0.1:3004:3004 -v tally:/data \
  -e TALLY_DB_DIALECT=sqlite -e TALLY_SQLITE_URL=file:/data/tally.db \
  -e TALLY_URL=https://tally.example.com -e TALLY_AUTH_LOCAL=1 \
  -e TALLY_AUTH_SECRET="$(openssl rand -base64 48)" -e TALLY_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ghcr.io/sovereignfs/tally
```

Keep the two generated values: they are in no file. The first account to sign up is the instance's; after it, accounts are made only for someone
holding an invitation (`TALLY_AUTH_SIGNUP=invite`, the default), or by nobody (`closed`), or by anyone (`open`).

**[`deploy/README.md`](deploy/README.md) is the guide** to the three forms of database, each with its Compose file: an **sqld** service (the default),
**a file**, or **PostgreSQL** (yours, or one Compose runs):

```bash
cd deploy && cp .env.example .env    # then set TALLY_URL, TALLY_AUTH_SECRET and TALLY_ENCRYPTION_KEY
docker compose up -d --build                                            # sqld
docker compose -f compose.file.yaml up -d --build                       # a file
docker compose -f compose.yaml -f compose.postgres.yaml up -d --build   # PostgreSQL
```

It also says what the server does when it starts, how to back it up and update it, and what the operator can and cannot read.

### On a Sovereign instance

`sv app add` hosts Tally from [`sovereign.manifest.json`](sovereign.manifest.json), which is also the image's label: the instance gives it a database,
its address, the sign-in client, a secret and the instance key, and people sign in through the instance. Anyone the instance signs in gets an account;
its bell and its email carry Tally's notices for them, and the Add people field searches its directory. With `TALLY_AUTH_LOCAL=1` as well, local
accounts sign in beside it. [`deploy/README.md`](deploy/README.md#on-a-sovereign-instance) has the detail.

## Every setting

Every setting has the prefix `TALLY_`. A secret may be given as `NAME_FILE=/path` instead, so that it is never in the process list. The server checks
them all when it starts and refuses to start on a wrong one, naming it and never its value. [`.env.example`](.env.example) has each with what it is for.

| Setting                                                              | What it is                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALLY_URL`                                                          | The address people use: https, except on localhost, with no path. Passkeys, emailed links and the sign-in redirect are made from it. Required.                                                  |
| `TALLY_AUTH_LOCAL`                                                   | `1` turns on email and password, passkeys and an authenticator app. At least one way to sign in must be on.                                                                                     |
| `TALLY_AUTH_SECRET`                                                  | Signs sessions: 32 characters or more. Required with a way to sign in. Secret.                                                                                                                  |
| `TALLY_AUTH_SIGNUP`                                                  | Who may make a local account after the first: `invite` (the default), `closed` or `open`. Someone a Sovereign instance signs in always gets one.                                                |
| `TALLY_AUTH_PASSWORD_MIN_LENGTH`                                     | The shortest password, 8 to 128; 10 by default.                                                                                                                                                 |
| `TALLY_CORE_URL`, `TALLY_CORE_CLIENT_ID`, `TALLY_CORE_CLIENT_SECRET` | Sign-in through a Sovereign instance: its address, and the client registered there with the redirect `<TALLY_URL>/api/auth/callback/sovereign`. All three or none. The last is secret.          |
| `TALLY_DB_DIALECT`                                                   | `sqld` (the default), `sqlite` or `postgres`.                                                                                                                                                   |
| `TALLY_SQLD_URL`, `TALLY_SQLD_ADMIN_URL`                             | The sqld service, and the address that makes its namespaces.                                                                                                                                    |
| `TALLY_SQLITE_URL`                                                   | The file, as `file:/data/tally.db`. One container; never on a network filesystem.                                                                                                               |
| `TALLY_POSTGRES_URL`, `TALLY_POSTGRES_POOL_MAX`                      | PostgreSQL's address (secret), and the most connections the app may hold (10 by default). `PGSSLROOTCERT` gives a root certificate for TLS.                                                     |
| `TALLY_DB_CONNECT_TIMEOUT_MS`, `TALLY_MIGRATIONS_DIR`                | How long to wait for a database that is starting (30,000 ms), and where the migrations are if not beside the server.                                                                            |
| `TALLY_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM`            | Mail, optional: addresses verified and passwords reset by email, invitations and notices emailed. Without it, an invitation is a link to copy. The password is secret.                          |
| `TALLY_ENCRYPTION_KEY`, `TALLY_ENCRYPTION_KEY_PREVIOUS`              | 32 random bytes that seal credentials Tally keeps for another service (a Sovereign instance's refresh token). Not the key to anything people write. The previous one while changing it. Secret. |
| `TALLY_WORKER`                                                       | `off` on all but one process when several share a database, so that one runs the background jobs (mail, pruning).                                                                               |
| `PORT`                                                               | The port to listen on, 3004 by default; a Sovereign instance sets it.                                                                                                                           |

## Using it

[`docs/`](docs/README.md) is the user's documentation: [what works offline and what needs a connection](docs/working-offline.md),
[what is sealed and what cannot be hidden](docs/privacy.md), and [taking your data with you](docs/your-data.md).

## Working on it

You need Node 24.15 or newer and [pnpm](https://pnpm.io) (the version is `packageManager` in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm dev               # http://localhost:3004, on a SQLite file under ./data, its settings made for you in .env.local
pnpm seed              # in another terminal: three accounts and three groups to look at; the password is in scripts/seed.ts
```

`pnpm db:dev sqld` or `pnpm db:dev postgres` runs the other forms of database in Docker, for trying them.

How to work here, every command and what "verified" means are in [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).

## Licence

AGPL-3.0-or-later. Bundling `@sovereignfs/ui` makes it so, and every dependency's licence must be compatible.
