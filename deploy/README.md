# Running Tally

Tally is one image that runs on its own or hosted by a Sovereign instance. This folder is the first way: three setups, one for each form of
database. They are the same app; only where it keeps its data differs (`DESIGN.md` §19.1).

| Setup                  | Files                                    | The database                                         | For                                                                                                                                                             |
| ---------------------- | ---------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **sqld** (the default) | `compose.yaml`                           | An sqld service (libSQL's server), on its own volume | Most installs. The app holds no state, and operating it is the same as operating Sovereign                                                                      |
| **A file**             | `compose.file.yaml`                      | One SQLite file on a volume                          | The smallest: one container, one person or a small group. A second instance cannot share the file, and it must stay on a local disk, never a network filesystem |
| **PostgreSQL**         | `compose.yaml` + `compose.postgres.yaml` | PostgreSQL, or one you already run                   | An operator who prefers it, or has one                                                                                                                          |

## Start

```bash
cd deploy
cp .env.example .env     # then edit it: at least TALLY_URL, TALLY_AUTH_SECRET and TALLY_ENCRYPTION_KEY
docker compose up -d --build                                                   # sqld
docker compose -f compose.file.yaml up -d --build                              # a file
docker compose -f compose.yaml -f compose.postgres.yaml up -d --build          # PostgreSQL (Compose 2.24 or later)
```

Only the machine itself can reach the port (`127.0.0.1:3004`): put a reverse proxy with TLS in front of it, and set `TALLY_URL` to the address people use.
Passkeys, emailed links and the sign-in redirect are made from it, and the server refuses to start on an address that is not https (localhost aside).

The smallest setup of all is one `docker run`, with no Compose:

```bash
docker run -d -p 127.0.0.1:3004:3004 -v tally:/data \
  -e TALLY_DB_DIALECT=sqlite -e TALLY_SQLITE_URL=file:/data/tally.db \
  -e TALLY_URL=https://tally.example.com -e TALLY_AUTH_LOCAL=1 \
  -e TALLY_AUTH_SECRET="$(openssl rand -base64 48)" -e TALLY_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ghcr.io/sovereignfs/tally
```

(Keep the two generated values: they are in no file, so make them once and put them in your own secrets.)

## What the server does when it starts

It checks its settings and stops, naming the one that is wrong and never its value. It then makes the places its database lives in (an sqld
namespace, a directory, a PostgreSQL schema), waits for a database that is still starting (up to `TALLY_DB_CONNECT_TIMEOUT_MS`, 30 seconds), applies
its own migrations, and starts. It does not start if it cannot, and `GET /api/health` answers 200 only when the database does. Migrations apply once
each, and a second process starting at the same time is safe.

It stops on SIGTERM within seconds and exits 143.

## Your own PostgreSQL

Skip `compose.postgres.yaml` and set, in `.env`:

```
TALLY_DB_DIALECT=postgres
TALLY_POSTGRES_URL=postgres://user:password@host:5432/tally
```

(or `TALLY_POSTGRES_URL_FILE`, a file holding it). The app makes its own schemas, `tally` and `tally_auth`, in that database.

## On a Sovereign instance

`sv app add` hosts Tally from `sovereign.manifest.json`, which is also the image's label: the instance builds nothing of its own, gives the app a database, and
tells it where it is. What it sets is the settings above under Tally's own names: `TALLY_URL`, `TALLY_CORE_URL`, `TALLY_CORE_CLIENT_ID` and
`TALLY_CORE_CLIENT_SECRET` (or `_FILE`), the database (`TALLY_DB_DIALECT` and its address) and `PORT`, and it makes `TALLY_AUTH_SECRET` and `TALLY_ENCRYPTION_KEY`
once and keeps them. With `TALLY_AUTH_LOCAL` unset, people sign in through the instance only: there is no password, sign-up or reset to find.

Sign-up is open there without being set: with the instance as the only way in, it already decides who may sign in, so Tally gives an account to
anyone it signs in (`TALLY_AUTH_SIGNUP=closed` turns that off). Mail (`TALLY_SMTP_*`) is not used when there is no password. The instance can end a person's sessions here, and delete their account, by
signed notices to `/api/sovereign/backchannel-logout` and `/api/sovereign/account-deleted`; both are answered only when they carry a token the instance
signed.

## Keys

- **`TALLY_AUTH_SECRET`** signs sessions and tokens. Changing it signs everyone out. Make it once (`openssl rand -base64 48`) and keep it with your secrets.
- **`TALLY_ENCRYPTION_KEY`** seals any credential the app keeps for another service. Phase 1 keeps none, so nothing is sealed yet, and the key is there
  so that the first release that does (a core's refresh token, for its directory) is not a change of setting. Make it once (`openssl rand -base64 32`) and keep it with your secrets. **To change it**, put
  the new one in `TALLY_ENCRYPTION_KEY` and the old in `TALLY_ENCRYPTION_KEY_PREVIOUS`, start the server once, and then remove the old one.

## What the operator cannot read

What people write in a group (its name, descriptions, notes and comments) is sealed in their browsers, and the database and its backups hold
only ciphertext of it; amounts, dates and people's names and addresses are readable, so that the server can check sums and send reminders
(`DESIGN.md` §5.3). `TALLY_ENCRYPTION_KEY` is not the key to any of it: no key that opens a group is ever on the server.

## Backups

The database is the whole of it.

- **sqld:** a snapshot of the `sqld-data` volume, taken with sqld stopped or by your usual volume backup.
- **A file:** a snapshot of the volume. For a running copy, `sqlite3 /data/tally.db ".backup /backup/tally.db"`, or continuous replication such as Litestream. The
  auth database, `tally_auth.db`, is beside it and is part of it.
- **PostgreSQL:** `pg_dump`, or your usual process.

A person's own export (Settings, Data) is theirs, and is neither a substitute for these nor the reverse.

## Updating

Pull or build the new image and `docker compose up -d`. Migrations apply when the new server starts. A patch release has none and changes no setting; a
minor may, and going back is restoring the backup you took before it.

## Checking a setup

`scripts/deploy-check.sh` brings each setup up from nothing, checks the database it is on, restarts it, and stops it with SIGTERM, and CI runs it. Its last setup, `sovereign`, is an instance hosting the app (secrets as files, a PostgreSQL of its own, a port that is not the image's): it checks that the image's label is the manifest, that sign-in offers Sovereign and no password, that the icon and the addresses of core's notices answer, and that it stops on SIGTERM:

```bash
eval "docker build $(pnpm exec sovereign-manifest docker-args) -t tally:ci ."
TALLY_IMAGE=tally:ci scripts/deploy-check.sh
```
