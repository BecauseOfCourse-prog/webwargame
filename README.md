# Wargame Web Service

A multiplayer, turn-based tabletop wargame service, currently at the local application/database foundation stage.

Built for the owner's group of friends, with no current commercial launch plan. Favor low recurring cost and simple maintenance: one host, local persistent uploads, self-hosted PostgreSQL, and off-host backups. No paid application service is required by the initial design.

## Project documentation

- [Development guidelines](AGENTS.md): explain important technical decisions as the project owner learns alongside development.
- [Mandatory documentation workflow](docs/specs/0005-development-documentation.md): every coherent change requires a change specification and an updated general context before completion.
- [Interface style](docs/design/interface-style.md): owner-approved palette, typography and component direction; reuse the CSS tokens for new UI.
- [Current project context](docs/specs/0002-project-context.md): start here for the implemented stack, architecture, status and open decisions.
- [T01 change specification](docs/specs/0003-t01-workspace.md): workspace, browser/API skeleton, contracts and style follow-up.
- [T02 change specification](docs/specs/0004-t02-local-database.md): local database, configuration, migrations and readiness behavior.
- [T03 change specification](docs/specs/0006-t03-repeatable-checks.md): root checks, ESLint and minimal GitHub Actions CI.
- [Initial project specification](docs/specs/0001-project-specification.md): proposed stack, architecture, domain model, game-state consistency, and decisions requiring clarification.
- [Product backlog](docs/product-backlog.md): traceable requirements, priorities, acceptance criteria, and delivery sequence.
- [Implementation backlog](docs/implementation-backlog.md): actionable tasks, current statuses, open decisions, and the first development iteration.
- [Specification review](docs/reviews/0001-specification-review.md): findings, corrections, and remaining product decisions.
- [Workspace decision](docs/decisions/0001-workspace-foundation.md): the T01 implementation choices and their tradeoffs.
- [T01 verification](docs/verification/t01-workspace.md): installation, build and browser-check evidence.
- [T01 code review](docs/reviews/0002-t01-code-review.md): inspection results, style changes and the outstanding Windows shutdown check.
- [Local database decision](docs/decisions/0002-local-database.md): PostgreSQL, configuration, Prisma and migration choices for T02.
- [T02 verification](docs/verification/t02-local-database.md): database initialization, startup failures and container-replacement persistence checks.
- [Combined T01–T02 code review](docs/reviews/0003-t01-t02-code-review.md): confirmed findings, fixes and regression evidence.
- [T03 verification](docs/verification/t03-repeatable-checks.md): frozen installation, credential-free checks, intentional type failure and CI inspection.
- [T03 code review](docs/reviews/0004-t03-code-review.md): CI Node/dependency mismatch, correction and verification under the selected runtime.

All project documentation is in English. T01 provides a browser shell and a real backend health request; T02 adds PostgreSQL, Prisma, migration history and validated environment configuration; T03 adds repeatable checks and a repository CI workflow. Accounts, board interaction and game rules are not implemented yet. Initial interface copy is Russian for the owner's walkthrough; Q08 still governs the eventual UI language/device scope.

The initial scope includes username/password accounts, administrator and player roles, illustrated rules, a shared interactive battle map, movement validation, turn management, unit inspection, a combat calculator, and administration of content and permissions.

## Run locally

Prerequisites: Node.js 22.22.3+ within the 22.x line (reference version in `.node-version`: 22.22.3), or Node.js 24.15.0+ within the 24.x line; pnpm 11.25.0; Docker with Compose and a running Linux-container engine. Docker Desktop is the verified local Windows setup. No global NestJS/Prisma CLI, separately installed PostgreSQL or paid service is needed.

Use the reference Node version before installation; the old 22.22.0 reference is rejected by locked development dependencies. A pnpm wrapper can use a different Node runtime from the shell. For troubleshooting, compare `node --version` with `pnpm exec node -p "process.env.npm_config_user_agent"` (whose `node/v...` entry identifies pnpm's host runtime). The corrected 22.22.3 reference passed clean frozen installation and all root checks with both runtimes explicitly verified. See [the review correction](docs/reviews/0004-t03-code-review.md#4-correction-and-verification--2026-10-23). This verification used a portable runtime; it did not replace the owner's system Node installation.

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm env:init
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open [the local application](http://127.0.0.1:5173). The page should report that the server is available. Use the connection button to repeat the check. Stop the development processes with Ctrl+C in the terminal running `pnpm dev`. PostgreSQL runs separately in the background; `pnpm db:down` stops this project's database/network and retains its named data volume. The Windows terminal's complete development-child shutdown remains a T04 check.

The backend listens on `127.0.0.1:3000`; [GET /api/health](http://127.0.0.1:3000/api/health) returns:

```json
{ "status": "ok", "service": "wargame-api" }
```

The browser requests `/api/health` on the frontend origin. Vite proxies it to the API; there is no cross-origin browser request. This endpoint reports process availability only, not database readiness or game functionality. If the API is unavailable or returns an invalid response, the page displays an error and allows a retry. Requests time out after five seconds.

The API validates settings and connects to PostgreSQL before listening. [GET /api/ready](http://127.0.0.1:3000/api/ready) additionally queries the database and returns `{ "status": "ready", "database": "ok" }`. A later database outage produces HTTP 503 from readiness while liveness remains HTTP 200; readiness recovers after the database returns. Startup failures identify configuration fields or a connection problem without printing credentials.

Default ports are 5432 (database), 3000 (API), 5173 (development frontend) and 4173 (preview). Local servers and the published database port bind only to loopback. `API_PORT` configures the API and Vite's proxy target; restart both after changing it. When changing `POSTGRES_PORT`, update the port in `DATABASE_URL` as well and recreate the database container without deleting its volume. Production hosting remains separate work.

## Local settings and database

`pnpm env:init` creates root `.env` with a cryptographically random local database password and matching connection URL. It never overwrites an existing file or prints the password. `.env.example` documents variable names with blank secret values; do not use the blank template unchanged. The root `.env` is ignored by Git. API and Prisma commands load that same file regardless of their workspace working directory; existing process environment variables take precedence. Build/client generation works without credentials or a running database.

Do not delete or regenerate an initialized database's password just to fix a connection error: PostgreSQL's image applies initialization credentials only when its volume is empty. Keep the existing `.env` or deliberately change the database role's password. This local bootstrap user can manage migrations and disposable verification databases; production roles are a later deployment decision.

| Command | Purpose |
| --- | --- |
| `pnpm db:up` | Start PostgreSQL and wait for its health check. |
| `pnpm db:down` | Stop the Compose project while retaining database data. |
| `pnpm db:generate` | Generate the ignored Prisma client from the committed schema; no DB connection. |
| `pnpm db:migrate` | Apply committed migrations to the configured database. |
| `pnpm db:status` | Check migration history against the configured database. |
| `pnpm db:migrate:dev --name describe_change` | Create/apply a reviewed development migration after editing the schema. |
| `pnpm test:config` | After building, run configuration and real startup-failure tests. |
| `pnpm test:database` | After building, with local PostgreSQL running, test readiness during a silent network interruption using a temporary API and local TCP proxy. |
| `pnpm db:verify` | After building, verify clean migrations and persistence in a temporary database; recreates the local PostgreSQL container, retaining the volume. |

The named volume is `webwargame-local_postgres-data`, mounted at `/var/lib/postgresql` as required by the PostgreSQL 18 image. It is managed by Docker, outside the source tree. `db:down` does not remove it. Commands such as `docker compose down --volumes`, volume pruning and migration resets can destroy data and are not part of the normal workflow. A volume is not an off-host backup; backup/restore work remains in B21.

The baseline migration only establishes the `public` schema and migration history. There are no user/game tables or dummy domain models yet. Edit `apps/api/prisma/schema.prisma` with the corresponding feature; create a named development migration, inspect its SQL and commit the schema plus the migration. Never edit an already applied migration or use `db push` as the project history. Local migrate-dev may use a shadow database; use it only against development databases.

`db:verify` is an explicit local-only integration check. It requires the canonical loopback URL matching the Compose user/password/port/database, with no query parameters or fragment; query parameters can override a URL's apparent endpoint in the driver. It creates a random `t02_verify_*` database, applies migrations twice, writes a marker through Prisma, recreates only this repository's database container, checks the marker and removes only that temporary database. Do not run it during a game: container replacement briefly disconnects the API. It does not clear the project database, delete the volume or contact a hosted database.

## Build and inspect

Run the complete database-independent check sequence from the root:

```powershell
pnpm check
```

| Command | Purpose |
| --- | --- |
| `pnpm lint` | ESLint correctness rules for maintained JS/TS, including React Hooks; any warning fails. |
| `pnpm typecheck` | Build shared packages and check all workspace TypeScript, including Prisma client generation. |
| `pnpm build` | Build shared packages, compiled API and browser assets. |
| `pnpm test` | Run the ten existing configuration/startup/local-target tests against compiled API output; build first when running separately. |
| `pnpm check` | Run lint, typecheck, build and `test` in that order; no `.env`, production secrets or running database required. |

After building, `pnpm test:database` additionally checks readiness during a real PostgreSQL network interruption. It requires the local database and configuration described above. `pnpm db:verify` remains a separate, opt-in container-replacement persistence check.

[GitHub Actions CI](.github/workflows/ci.yml) runs on pushes, pull requests and manual dispatch. It installs with the frozen lockfile, reads Node from `.node-version` and pnpm from `packageManager`, and runs the same `pnpm check`. A disposable PostgreSQL service then receives committed migrations twice (the second run must be safe), migration status and `pnpm test:database`. Its declared test credentials are confined to the job; no production secrets or owner's `.env` are needed. The workflow does not deploy or recreate the owner's local containers. Action references are pinned to reviewed commit SHAs. No paid runner or plan is selected; available hosted-runner minutes depend on the repository/account. Local checks and configuration inspection passed; no remote CI success is claimed in T03 evidence.

ESLint excludes installed dependencies, compiled output, the generated Prisma client, coverage and `.local` scratch files. Its scope is JavaScript/TypeScript correctness and the fundamental React Hooks rules; it does not enforce CSS/Markdown formatting or validate game rules. Meaningful feature tests should extend the existing commands as features arrive.

Shared packages build before their consumers. Build artifacts go into each package's ignored `dist` directory. To inspect the compiled application, run these commands in two terminals, after building:

```powershell
# Terminal 1: compiled API
pnpm --filter @webwargame/api start
```

```powershell
# Terminal 2: static build preview with a local API proxy
pnpm --filter @webwargame/web preview
```

Open [the built frontend preview](http://127.0.0.1:4173). The API requires local settings and PostgreSQL to be running. Vite preview is a local build inspection tool; production deployment will use the reverse proxy described in the specification. The full onboarding walkthrough and Windows development-child shutdown check remain T04.

## Workspace layout

| Path | Responsibility |
| --- | --- |
| `apps/web` | React/Vite browser shell and connection status. |
| `apps/api` | NestJS server, configuration validation, Prisma service, liveness/readiness and migrations. |
| `packages/contracts` | Shared health/readiness types, health route and runtime response guard. |
| `packages/game-engine` | Buildable entry point reserved for approved movement/combat rules; currently exports no rules. |

`pnpm dev` first builds the shared packages, then starts their TypeScript watchers, the NestJS development server and Vite together. API dev/build/typecheck regenerate the ignored Prisma client. Shared packages use `workspace:*` links, so they resolve from this repository rather than a public registry. Konva, routing, sockets and form/editor libraries remain deferred to their feature tasks.
