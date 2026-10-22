# Decision 0002: Local Database and Runtime Configuration

Date: 2026-10-22

Status: Implemented for T02.

## Context and choices

The hobby service needs persistent relational storage, reproducible schema changes and clear configuration errors. There is no reason to buy a managed database or design account/game tables before their feature requirements are resolved.

- **PostgreSQL 18.6 in local Docker Compose.** Pin the image version and Debian variant; retain one namespaced named volume. PostgreSQL 18 images use `/var/lib/postgresql` as the volume target, with a versioned data subdirectory. Publish only to `127.0.0.1`. A host installation is possible, but Compose makes the local version and lifecycle reproducible. The cost is running Docker locally; no paid database service is required. Major-version upgrades require an explicit data migration, not merely changing the tag.
- **Prisma 7.10.1 and its PostgreSQL adapter.** The chosen stable v7 line supports this project's Node and TypeScript versions. Use the v7 configuration/generator APIs rather than copying newer v8 APIs or older v6 datasource syntax. Generate ESM TypeScript into ignored source output before compiling the API. The adapter supplies a small connection pool, finite connection/driver-query/server-statement timeouts and a shared client managed by NestJS lifecycle hooks. The driver-query timeout handles an established but silent connection that cannot be bounded by a server timeout alone. Direct SQL remains available for technical probes and later explicit locking; no ORM models are invented for T02.
- **An empty-domain baseline migration.** Commit `schema.prisma`, migration SQL and `migration_lock.toml`. The initial SQL ensures `public` exists and establishes history without dummy application tables. Deploying migrations applies committed history; development migrations evolve it. Prefer history over undocumented manual changes or `db push`. The persistence test uses a separate disposable database/schema, not a permanent verification model.
- **Private root settings, one loading rule.** Use Node's built-in environment-file loader, avoiding an extra dotenv dependency. Both the API and Prisma config locate root `.env` relative to their source/compiled files. Existing environment variables take precedence. A native Node script generates a random local password without printing it and refuses to overwrite an existing `.env`. Commit a blank-secret template only. Client generation does not need a datasource URL; runtime and migration operations do.
- **Zod validation before startup.** Validate the PostgreSQL URL and port, then inject an immutable configuration object. This introduces a schema library for actual untrusted configuration rather than hand-writing many checks. Errors name invalid fields/constraints and omit their values. Connection failures close resources and produce a generic diagnostic; credentials are not included in logs or public responses.
- **Separate liveness and readiness.** Preserve `/api/health` for the existing frontend. Add `/api/ready`, which queries PostgreSQL and returns HTTP 503 on failure. Require a successful DB query before the API starts listening. After startup a DB outage changes readiness without falsely declaring the process dead, and a restored connection can recover without restarting the API.
- **Use the pnpm 11 configuration format.** Move `saveExact` and `engineStrict` from `.npmrc` into workspace YAML, where this installed pnpm actually reads them. Explicitly allow required Prisma/engine install scripts with `allowBuilds`, keep the optional Nest notice denied, and preserve strict peer checking. Do not enable all dependency scripts globally.
- **Keep private configuration out of the frontend.** Vite's Node-side config reads only API-prefixed values to configure its target port. It does not inject a connection URL or database password into browser code. Existing UI and its approved theme are unchanged.

## Verification and operational consequences

See [T02 evidence](../verification/t02-local-database.md). A source-only copy without `.env`, installed modules or generated client must build. Tests must exercise actual startup failures and secret-free errors. Persistence verification must apply migrations on a clean disposable database, write through Prisma, replace the container while retaining the volume, then read the same marker and clean up only its own database.

The database is independently started/stopped with `db:up`/`db:down`; stopping the frontend/API does not stop PostgreSQL. Keep volume deletion and migration reset outside the regular workflow. The initialized image does not reapply a changed environment password to existing database data. Separate off-host backups and production role design remain deployment work. No hosting purchase or production deployment is introduced.

## Primary references

- [Official PostgreSQL Docker image and PGDATA](https://hub.docker.com/_/postgres).
- [Docker PostgreSQL persistence guide](https://docs.docker.com/guides/postgresql/immediate-setup-and-data-persistence/).
- [Prisma Client v7 setup and adapters](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/introduction).
- [Prisma v7 generator settings](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators).
- [pnpm configuration](https://pnpm.io/settings) and [explicit install-script approval](https://pnpm.io/settings/build#allowbuilds).
