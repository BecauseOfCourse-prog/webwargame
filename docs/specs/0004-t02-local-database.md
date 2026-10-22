# Specification 0004: T02 Local PostgreSQL, Prisma and Configuration

Date: 2026-10-22

Status: Implemented, including code-review corrections. Parent: B02. Task: T02.

## 1. Problem and boundary

T01 has a process-only server shell. T02 gives it a reproducible local database connection, retained storage, migration history and validated private settings. A missing/bad configuration must fail clearly; database data must survive replacing the container. No speculative account/game schema, asset storage, production deployment or backup system is added.

## 2. Database and migration changes

[compose.yaml](../../compose.yaml) defines project `webwargame-local`, service `postgres`, image `postgres:18.6-bookworm` and named volume `postgres-data` (resolved name `webwargame-local_postgres-data`). The PostgreSQL 18 mount target is `/var/lib/postgresql`. Publish port 5432 only on `127.0.0.1`, configurable through `POSTGRES_PORT`. A `pg_isready` health check gates `db:up`; no automatic restart policy is enabled for this local service.

Prisma 7.10.1 uses a PostgreSQL datasource and `prisma-client` generator with ESM, TypeScript output and `.js` import specifiers. Output is ignored `apps/api/src/generated/prisma`; API dev/build/typecheck regenerate it. The CLI config loads root settings explicitly and only supplies a datasource URL when one exists, allowing generation/build without credentials or a running database.

The committed baseline `20261022000100_initial_baseline` ensures `public` exists. Applying it establishes `_prisma_migrations`; it creates no domain tables. Later feature changes must include schema changes and reviewed, named migrations. Apply existing history with migrate-deploy; use migrate-dev only on development databases when creating changes. Do not modify already applied SQL, use `db push` as history, or reset a database as routine startup.

## 3. Settings and validation

| Variable | Consumer and rule |
| --- | --- |
| `POSTGRES_USER` | Compose initialization; generated local value `webwargame`. |
| `POSTGRES_DB` | Compose initialization; generated local value `webwargame`. |
| `POSTGRES_PASSWORD` | Required nonempty image initialization value; random local secret. |
| `POSTGRES_PORT` | Loopback host database port, default 5432; keep `DATABASE_URL` consistent. |
| `DATABASE_URL` | Required by runtime/migrations. Runtime validation requires a `postgres:`/`postgresql:` URL with host, database path, username and password. |
| `API_PORT` | Runtime port, default 3000; coerced to an integer in 1–65535. Vite validates the same range for its proxy target. |

`scripts/init-local-env.mjs` creates root `.env` with a 32-byte random password encoded as hex and a matching URL, using exclusive file creation. Existing files are left unchanged. It does not print credentials. The committed `.env.example` has blank password/URL values. API and Prisma resolve the same root file independent of working directory; process environment values take precedence. An absent file is permitted when variables are supplied externally. File-read and schema errors provide useful field/constraint messages without values.

The initialized PostgreSQL image does not change an existing role's password when `.env` changes. Keep credentials consistent with the retained volume. This local bootstrap account can manage migrations and test databases; production privileges remain a later decision.

## 4. Backend lifecycle and readiness

`AppModule.register` receives an immutable validated `RuntimeConfiguration` and registers one Prisma service. Dependency injection provides configuration and database access to the controllers. Startup creates the adapter/client, connects and executes `SELECT 1` before the HTTP listener is ready. A failed connection closes resources and produces a generic error; failure to listen also closes the application. Nest shutdown hooks disconnect the client.

The pg pool has maximum size 5, connection acquisition timeout 5000 ms, idle timeout 10000 ms, server `statement_timeout` 5000 ms and driver `query_timeout` 5000 ms. The driver timeout was added during review: a server timeout cannot fire for a query that never reaches the server. These are per-stage budgets, not a guarantee that every end-to-end request takes at most five seconds under all concurrency/network conditions.

| Request | Success | Failure semantics |
| --- | --- | --- |
| `/api/health` | HTTP 200, `status: ok`, `service: wargame-api` | Process liveness remains independent of later DB outages. |
| `/api/ready` | HTTP 200, `status: ready`, `database: ok` after a DB query | HTTP 503 with a generic unavailable message; no URL, password or raw driver error is returned. |

`ReadinessResponse` is shared through contracts. The welcome page still checks health, not readiness. Vite reads only `API_` settings in its Node-side configuration and forwards requests to the configured loopback API port; it never injects database credentials into the browser bundle.

## 5. Commands and local verification boundaries

| Command | Behavior |
| --- | --- |
| `pnpm env:init` | Create private local settings without overwriting existing ones. |
| `pnpm db:up` / `pnpm db:down` | Start/wait for the local database; stop this Compose project without deleting its volume. |
| `pnpm db:generate` | Generate client code without connecting. |
| `pnpm db:migrate` / `pnpm db:status` | Apply committed migrations / inspect history for the configured datasource. |
| `pnpm db:migrate:dev --name describe_change` | Create/apply development changes; may need a shadow database. |
| `pnpm test:config` | After build, run ten configuration/startup/local-target tests without requiring a live database. |
| `pnpm test:database` | After build, with the local DB running, test a silent network interruption through a local TCP proxy and temporary API child. Does not recreate PostgreSQL or write application records. |
| `pnpm db:verify` | After build, with the local DB running, run the explicit migration/container-persistence check described below. |

The persistence verifier requires the canonical local Compose URL: loopback hostname, matching port/user/password/database and no query parameters or fragment. This is stricter than ordinary runtime URL validation. Driver query parameters can override a URL's apparent host/port/user, so checking only `URL.hostname` is insufficient for this local-only utility.

The verifier creates a random `t02_verify_*` database, applies all committed migrations twice and checks that each applied once. It writes a marker via Prisma, closes its client, recreates only this repository's PostgreSQL container with the volume retained, asserts a new container ID and reads the marker through a new client. Cleanup disconnects and removes only its generated database. No volume deletion, migration reset, project-data purge or hosted database is part of this check. Container replacement briefly interrupts other connections; do not run it during a game.

The silent-network test starts an isolated API on a temporary loopback port, forwards a real database connection through a local TCP proxy, then discards outbound query traffic while keeping sockets established. Readiness must return 503 before the test's outer deadline and liveness must still return 200. Cleanup closes the proxy sockets and that API child. No PostgreSQL wire-protocol imitation or new test dependency is needed.

## 6. Verification and limits

Build/type checks, frozen installation, credential-free clean-source build, clean/idempotent migrations, startup failure/redaction tests, retained marker after container replacement and DB outage/recovery were verified. The combined review added the local-target regression checks and the silent-network test, observed failure before the query-timeout correction and success afterward.

See [T02 evidence](../verification/t02-local-database.md), [combined review](../reviews/0003-t01-t02-code-review.md) and [rationale](../decisions/0002-local-database.md). Local data persistence is not off-host backup. Production roles, authenticated endpoints, CI/lint, full browser/device checks and Windows development shutdown validation remain later work. No paid infrastructure is introduced.
