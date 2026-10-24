# Wargame Web Service

A multiplayer, turn-based tabletop wargame service, with local foundations and a working registration/login/session interface.

Built for the owner's group of friends, with no current commercial launch plan. Favor low recurring cost and simple maintenance: one host, local persistent uploads, self-hosted PostgreSQL, and off-host backups. No paid application service is required by the initial design.

## Project documentation

- [Development guidelines](AGENTS.md): explain important technical decisions as the project owner learns alongside development.
- [Mandatory documentation workflow](docs/specs/0005-development-documentation.md): every coherent change requires a change specification and an updated general context before completion.
- [Interface style](docs/design/interface-style.md): owner-approved palette, typography and component direction; reuse the CSS tokens for new UI.
- [Current project context](docs/specs/0002-project-context.md): start here for the implemented stack, architecture, status and open decisions.
- [T01 change specification](docs/specs/0003-t01-workspace.md): workspace, browser/API skeleton, contracts and style follow-up.
- [T02 change specification](docs/specs/0004-t02-local-database.md): local database, configuration, migrations and readiness behavior.
- [T03 change specification](docs/specs/0006-t03-repeatable-checks.md): root checks, ESLint and minimal GitHub Actions CI.
- [T04 change specification](docs/specs/0007-t04-local-workflow.md): local setup, shutdown, migration and troubleshooting workflow.
- [T05 change specification](docs/specs/0008-t05-registration.md): player accounts, password protection and registration API.
- [T06 change specification](docs/specs/0009-t06-sessions.md): login, server-side sessions, expiry and CSRF/origin protection.
- [T07 change specification](docs/specs/0010-t07-account-interface.md): Russian account forms, signed-in shell and coordinated browser session state.
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
- [T04 verification](docs/verification/t04-local-workflow.md): clean-checkout walkthrough, browser/API checks, Windows stop/restart and retained database state.
- [T04 code/documentation review](docs/reviews/0005-t04-code-documentation-review.md): source/command consistency, evidence assessment and review limits.
- [T05 verification](docs/verification/t05-registration.md): Windows/Linux frozen checks and real registration/database integration.
- [T05 code review](docs/reviews/0006-t05-code-review.md): corrected UTF-8 decoding defect and post-correction checks.
- [T06 verification](docs/verification/t06-sessions.md): clean root checks, real session/expiry/CSRF/race/cleanup tests and local migration.
- [T06 code review](docs/reviews/0007-t06-code-review.md): corrected cleanup/renewal race and controlled PostgreSQL regression.
- [T07 verification](docs/verification/t07-account-interface.md): client/controller tests, real account flow, expiry/recovery and narrow-layout checks.
- [T07 code review](docs/reviews/0008-t07-code-review.md): corrected queued-login synchronization, registration recovery guidance and long-name overflow.

All project documentation is in English. T01 provides a browser shell and a real backend health request; T02 adds PostgreSQL, Prisma, migration history and validated environment configuration; T03 adds repeatable checks/CI; T04 verifies the local workflow. T05/T06 add player registration and revocable sessions; T07 supplies registration/login forms, a signed-in shell and logout. The owner confirmed Russian UI, current desktop Chrome/Edge/Firefox as primary browsers and usable account forms on phones. Full phone board play remains open under Q08. Role enforcement, board interaction and game rules remain future tasks.

The initial scope includes username/password accounts, administrator and player roles, illustrated rules, a shared interactive battle map, movement validation, turn management, unit inspection, a combat calculator, and administration of content and permissions.

## Run locally

### Prerequisites and runtime selection

Use PowerShell commands below from the repository root, the directory containing `package.json` and `compose.yaml`. Obtain the source with Git or a source archive, then install or select these local tools:

| Tool | Requirement and verified reference |
| --- | --- |
| Node.js | `^22.22.3` or `^24.15.0`: at least 22.22.3 within 22.x, or at least 24.15.0 within 24.x. The reference in [`.node-version`](.node-version) is 22.22.3. |
| pnpm | Exactly 11.25.0, as declared in `packageManager`. |
| Docker | Docker with the Compose v2 plugin and a running Linux-container engine. Docker Desktop is the verified Windows setup; recorded checks used Engine 28.5.1 and Compose 2.40.3. |

No global NestJS/Prisma CLI, separate PostgreSQL installation or paid account is required. `.node-version` records the reference version; it does not switch the current terminal's Node. Select a compatible installed or portable Node before installation, then check:

```powershell
node --version
pnpm --version
Get-Command node,pnpm | Select-Object Name,Source
docker compose version
docker info
```

On Windows, open Docker Desktop from the normal Windows Start menu or user shell and wait until its Linux engine is running before `docker info` and `pnpm db:up`. A Desktop window alone does not prove engine readiness. If the engine cannot start, see [troubleshooting](#troubleshooting); the machine-specific T03 recovery is historical evidence, not a required setup step.

### First setup

In a new checkout, make frozen installation the first dependency operation. Do not use `pnpm exec` as a pre-install probe: it can trigger automatic installation before the intended frozen command.

```powershell
pnpm install --frozen-lockfile
```

A pnpm wrapper can use a different Node runtime from the shell. After installation, verify both the child Node and pnpm's host runtime:

```powershell
pnpm exec node --version
pnpm exec node -p "process.env.npm_config_user_agent"
```

The second command's `node/v...` entry identifies the runtime hosting pnpm; the first command alone does not. Both must satisfy the supported Node range. The old 22.22.0 reference is rejected by locked dependencies. Keep strict engine validation enabled; select compatible executables if versions disagree. The corrected reference passed clean frozen installation and all checks with both runtimes on 22.22.3. See [the T03 review correction](docs/reviews/0004-t03-code-review.md#4-correction-and-verification--2026-10-23). That verification used a portable runtime and did not replace the owner's system Node installation; execution of the full supported version range is not claimed.

Continue in the same checkout. If another checkout already uses this Docker engine, follow the [second-checkout isolation recipe](#optional-second-checkout) after `env:init` and before the first `db:up`:

```powershell
pnpm env:init
pnpm db:up
pnpm db:migrate
pnpm db:status
pnpm dev
```

`env:init` creates private local settings; `db:up` starts PostgreSQL and waits for its health check; `db:migrate` applies committed database changes; `db:status` should report up to date. Wait for the API and Vite startup messages, then open [the local application](http://127.0.0.1:5173). The page should report `Сервер доступен`. Use its connection button to repeat the request.

Vite can become ready before the API finishes compiling. An early request may produce `ECONNREFUSED 127.0.0.1:3000`; wait for `Nest application successfully started`, then retry. If the error continues after that message, follow database/port troubleshooting below.

### Browser request and database readiness

The backend listens on `127.0.0.1:3000`; [GET /api/health](http://127.0.0.1:3000/api/health) returns:

```json
{ "status": "ok", "service": "wargame-api" }
```

The browser sends `/api/health` to the frontend origin on port 5173. Vite forwards that request to the API on port 3000 and returns the response to the page. The browser does not connect to PostgreSQL. This health endpoint reports process availability. If the API is unavailable or returns an invalid response, the page displays an error and allows a retry; requests time out after five seconds.

The API validates settings and connects to PostgreSQL before listening. [GET /api/ready](http://127.0.0.1:3000/api/ready) additionally queries the database and returns `{ "status": "ready", "database": "ok" }`. A later database outage produces HTTP 503 from readiness while liveness remains HTTP 200; readiness recovers after the database returns. Startup failures identify configuration fields or a connection problem without printing credentials.

These checks can also be made from another PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-RestMethod http://127.0.0.1:3000/api/ready
```

These probes verify process/database availability; registration and sessions are checked separately. Gameplay remains future work. Default ports are 5432 (database), 3000 (API), 5173 (development frontend) and 4173 (preview). All published local listeners bind to loopback. See [occupied ports](#occupied-ports) before changing them. This is a local development workflow; production hosting, HTTPS and backups remain separate tasks.

### Daily start and stop

Keep the existing private `.env` and database volume. Start the engine if necessary, then run:

```powershell
pnpm db:up
pnpm dev
```

Stop `pnpm dev` with Ctrl+C in its terminal. Windows command wrappers may ask `Terminate batch job (Y/N)?`; answer `Y` and wait for the PowerShell prompt. Check that the API/frontend listeners have disappeared before restarting:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 3000,5173 } |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

With the default ports and no other application using them, this should print no rows. If rows remain, inspect their owners as described under [occupied ports](#occupied-ports). Watchers without listeners must exit too. T04 tracked the full development trees across two owner-operated Windows terminal start/stop cycles; all captured processes exited and the same ports were reusable. See [T04 verification](docs/verification/t04-local-workflow.md). Do not infer complete shutdown from the browser becoming unavailable alone.

After stopping the frontend, its page is expected to become unavailable. Development uses port 5173; port 4173 works only while the separate built-preview command is running. Reopen the address printed by the command you actually started.

PostgreSQL runs independently in the background. To stop this checkout's Compose project while retaining database data, run:

```powershell
pnpm db:down
```

To restart, repeat the daily start commands; an existing database does not need a new password or reinitialization.

### After updating an existing checkout

Stop the development processes, preserve `.env`, and check whether the updated runtime requirement has changed. After obtaining the new source, run:

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm db:status
pnpm check
pnpm dev
```

`db:migrate` applies committed migration history and is safe to repeat when nothing is pending. It does not create a migration for your own schema edits. If installation or migration fails, resolve that error before starting the application.

## Local settings and database

`pnpm env:init` creates root `.env` with a cryptographically random local database password and matching connection URL. It never overwrites an existing file or prints the password. `.env.example` documents variable names with blank secret values; do not use the blank template unchanged. The root `.env` is ignored by Git. API and Prisma commands load that same file regardless of their workspace working directory; existing process environment variables take precedence. Build/client generation works without credentials or a running database.

PostgreSQL's image applies initialization credentials only when its volume is empty. Keep the existing `.env` when restarting or updating; regenerating a password does not update the role in an existing database. See [database connection errors](#database-connection-errors) for diagnosis. This local bootstrap user can manage migrations and disposable verification databases; production roles are a later deployment decision.

| Command | Purpose |
| --- | --- |
| `pnpm db:up` | Start PostgreSQL and wait for its health check. |
| `pnpm db:down` | Stop this checkout's Compose project while retaining database data. |
| `pnpm db:generate` | Generate the ignored Prisma client from the committed schema; no DB connection. |
| `pnpm db:migrate` | Apply committed migrations to the configured database. |
| `pnpm db:status` | Check migration history against the configured database. |
| `pnpm db:migrate:dev --name describe_change` | Create/apply a reviewed development migration after editing the schema. |
| `pnpm test:config` | After building, run configuration and real startup-failure tests. |
| `pnpm test:database` | After building, test registration/sessions in disposable local databases and readiness during a silent network interruption; the local/CI role needs create/drop-database permission. |
| `pnpm db:verify` | Default `webwargame-local` project only: after building, verify clean migrations and persistence in a temporary database; recreates its PostgreSQL container, retaining the volume. |

The T02 baseline migration establishes `public` and migration history; T05 introduces `User`/`UserRole`, and T06 adds `Session`. Game tables remain future work. When a feature requires a schema change, edit `apps/api/prisma/schema.prisma`, run `pnpm db:migrate:dev --name describe_change`, inspect its SQL and commit the schema plus the migration. Never edit an already applied migration or use `db push` as the project history. Local migrate-dev may use a shadow database; use it only against development databases.

### Where local data lives

The default named volume is `webwargame-local_postgres-data`, mounted at `/var/lib/postgresql` as required by the PostgreSQL 18 image. Docker manages it outside the source tree; `db:down` and container replacement retain it. Volume deletion/pruning and migration resets can destroy data and are not troubleshooting steps. A volume is not an off-host backup; backup/restore work remains in B21. Persistent uploaded assets are planned and do not yet exist.

Git tracks source, schemas, migrations and the lockfile. It does not track `.env`, installed `node_modules`, generated Prisma code or package `dist` output. pnpm's shared dependency store is a package cache, not game data or a database backup.

### Optional second checkout

A fresh checkout normally uses the same Compose project name as the first one, so a different directory alone does not isolate PostgreSQL. Before its first `db:up`, run `pnpm env:init` there and edit that checkout's private `.env`:

| Setting | Isolated-checkout example |
| --- | --- |
| `COMPOSE_PROJECT_NAME` | Add a stable, unique name such as `webwargame-t04-local`. |
| `POSTGRES_PORT` | Change to an unused port such as `55432`. |
| `DATABASE_URL` | Change only its port to the same `55432`; keep the generated user, password and database components intact. |

Keep the project name in that `.env` for every subsequent Compose command, including `db:down`. A temporary command-line override that is later forgotten can target the default project instead. Ensure shell variables do not override these file settings. The isolated named volume becomes `<COMPOSE_PROJECT_NAME>_postgres-data`; `db:up`, `db:down`, migrations and status then address the isolated database. Stop the first checkout's application processes before using the same API/frontend ports in the second one. The isolated T04 walkthrough used database port 55432 and left the main project database intact; see [its evidence](docs/verification/t04-local-workflow.md).

Do not run `pnpm db:verify` from this isolated setup: that optional utility currently fixes the Compose project name to `webwargame-local`. It is documented for the default project only.

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
| `pnpm test` | Run 67 database-free tests: 41 API configuration/startup/local-target, registration and authentication/security tests plus 26 account-client/controller tests; build first when running separately. |
| `pnpm test:registration` | Run the fourteen database-free registration/hash/limiter tests after building. |
| `pnpm test:auth` | Run the fourteen database-free login/token/cookie/CSRF/capacity/failure tests after building. |
| `pnpm test:web` | Run twelve browser account-client and fourteen session-controller tests with Node's built-in runner; build shared contracts first when running separately. No browser installation or database required. |
| `pnpm check` | Run lint, typecheck, build and `test` in that order; no `.env`, production secrets or running database required. |

After building, `pnpm test:database` additionally checks real HTTP registration/authentication and readiness during a PostgreSQL network interruption. It requires local configuration and a running loopback database, with a URL without query parameters or a fragment. The local bootstrap/CI user must be able to create/drop databases: registration/authentication tests create separate random `t05_registration_*` / `t06_auth_*` databases, apply migrations twice and drop only their own database during cleanup. They start temporary API listeners/proxy and do not replace the database container or insert test accounts into the project database.

`pnpm db:verify` is a separate, opt-in persistence check for the default `webwargame-local` Compose project only. It requires the canonical loopback URL matching the Compose user/password/port/database, with no query parameters or fragment; driver query parameters can override a URL's apparent endpoint. It creates a random `t02_verify_*` database, applies migrations twice, writes a marker through Prisma, recreates the default project's PostgreSQL container, checks the marker and removes that temporary database. Container replacement briefly disconnects other API connections, so stop normal development first. The utility retains the project database and volume, but its fixed Compose project name makes it unsuitable for the [isolated second-checkout setup](#optional-second-checkout).

[GitHub Actions CI](.github/workflows/ci.yml) runs on pushes, pull requests and manual dispatch. It installs with the frozen lockfile, reads Node from `.node-version` and pnpm from `packageManager`, and runs the same `pnpm check`. A disposable PostgreSQL service then receives committed migrations twice (the second run must be safe), migration status and `pnpm test:database`. Its declared test credentials are confined to the job; no production secrets or owner's `.env` are needed. The workflow does not deploy or recreate the owner's local containers. Action references are pinned to reviewed commit SHAs. No paid runner or plan is selected; available hosted-runner minutes depend on the repository/account. Local checks and configuration inspection passed; no remote CI success is claimed in T03 evidence.

ESLint excludes installed dependencies, compiled output, the generated Prisma client, coverage and `.local` scratch files. Its scope is JavaScript/TypeScript correctness and the fundamental React Hooks rules; it does not enforce CSS/Markdown formatting or validate game rules. Meaningful feature tests should extend the existing commands as features arrive.

### Registration API (T05)

After `pnpm db:migrate`, `POST /api/auth/register` accepts uncompressed UTF-8 `application/json` with only `username` and `password`. Username: 3–32 ASCII Latin letters, digits or `._-`; surrounding whitespace is trimmed, display case retained and uniqueness is case-insensitive. Password: 15–128 Unicode code points, spaces allowed, no control characters; its content is neither trimmed nor normalized. Example request shape: `{ "username": "Commander", "password": "<your private passphrase>" }`. Use an HTTP client that keeps the real password out of saved shell history and logs.

Success returns 201 with `user` containing only `id`, `username`, `role: PLAYER` and `createdAt`. Invalid fields return 400 with field errors; duplicates 409; bodies over 4 KiB 413; unsupported media/encoding 415. Attempts are limited to ten per socket address and 100 globally per 15-minute fixed window; 429 includes `Retry-After`. All requests through Vite share its loopback address. Forwarding headers are ignored; counters are process-local and reset on API restart. Two concurrent registration hashes are allowed; exhausted hashing capacity/database failure returns generic 503. See [the full contract and tradeoffs](docs/specs/0008-t05-registration.md).

Registration creates a player account without a session or game membership. The T07 browser form returns to explicit login after success; administrator provisioning remains T08. Registration and login share a maximum of two concurrent Argon2 operations. The account interface preserves the approved visual style.

### Login and sessions API (T06)

`PUBLIC_ORIGIN` is the exact trusted browser origin. It defaults to `http://127.0.0.1:5173`, so existing `.env` files keep working. Use only one origin without a path/query/fragment; external addresses require HTTPS. HTTP is allowed only for loopback development. The initializer preserves existing settings and includes the default in new files.

All session requests send `X-Wargame-Request: 1`. Login/logout also send `Origin` equal to `PUBLIC_ORIGIN` and uncompressed UTF-8 `application/json`. CORS and forwarding-header trust are not enabled.

| Endpoint | Usage |
| --- | --- |
| `POST /api/auth/login` | JSON `{username,password}` → 200 with public `user` (`id`, `username`, `role`), `csrfToken`, `expiresAt`, `idleExpiresAt` and an HttpOnly cookie. New login rotates the presented browser session; other devices remain logged in. |
| `GET /api/auth/me` | Browser cookie + custom header → 200 with the same session view. Optional Origin must match if supplied. No cookie is written even on 401. |
| `POST /api/auth/logout` | Browser cookie + trusted Origin/custom header + `X-CSRF-Token` from login/current-user; JSON `{}` is sufficient → 204 and an expired cookie. |

Cookies are host-only, Path `/`, HttpOnly and SameSite Lax. HTTPS uses Secure `__Host-wargame.sid`; local HTTP uses `wargame.sid`. PostgreSQL stores only the digest of the random bearer. Sessions expire after seven days or 24 hours without authenticated API activity; activity cannot extend the absolute limit. Logout revokes the current token immediately. Expired rows are cleaned every 15 minutes, at most 1000 per pass; expired access is refused regardless of cleanup.

Unknown/wrong/invalid credentials use generic 401; session failure uses 401, Origin/CSRF failure 403, and capacity/database failures sanitized 503. Login limits count ten attempts per socket address and 100 globally per 15 minutes, plus five per normalized account, including successful attempts. 429 includes `Retry-After`. Counters are process-local; Vite/proxy users share an address quota. Keep passwords and bearer/CSRF tokens out of logs/history. See [the full contract and limits](docs/specs/0009-t06-sessions.md).

### Browser account interface (T07)

Open the development frontend at [127.0.0.1:5173](http://127.0.0.1:5173) after starting the API and Vite. Use **Регистрация** to create a player, then **Вход** with the chosen password. Registration asks for confirmation and shows field errors; it does not grant access to a game. A successful login displays the current username and role. **Выйти** revokes the current session. Roles are displayed only; server role guards and administrator bootstrap remain T08.

The browser restores a valid session on reload and checks again when the page becomes visible or focused. Session/CSRF data stay in memory; the bearer remains in the HttpOnly cookie. Same-origin Web Locks serialize login/logout across tabs and a marker-only BroadcastChannel prompts session refresh. Current desktop Chrome/Edge/Firefox are the agreed targets; a browser without the required session coordination receives an explicit compatibility message. Account layouts were inspected at phone widths in the in-app browser; the full browser/native-phone matrix remains later verification.

There is no automatic authenticated heartbeat, so leaving a page open does not keep the server session alive. Local expiry clears the signed-in view. Current-user reads time out after ten seconds; login/logout wait for the response and reconcile an uncertain result before allowing another cookie-changing action. They are not automatically retried. If a mutation appears stuck, refresh the page and check the server session rather than assuming success. See [T07 behavior and tradeoffs](docs/specs/0010-t07-account-interface.md) and [verification](docs/verification/t07-account-interface.md).

### Compiled application preview

Stop `pnpm dev` first so it releases API port 3000. Shared packages build before their consumers, and build artifacts go into each package's ignored `dist` directory. With local settings and PostgreSQL available, build once:

```powershell
pnpm build
```

Then run these commands in two terminals from the same repository root:

```powershell
# Terminal 1: compiled API
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:4173'
pnpm --filter @webwargame/api start
```

```powershell
# Terminal 2: static build preview with a local API proxy
pnpm --filter @webwargame/web preview
```

Open [the built frontend preview](http://127.0.0.1:4173), inspect the account interface and connection check, then stop both terminal commands with Ctrl+C, answering `Y` if prompted. Its login/logout requests require the API's matching preview `PUBLIC_ORIGIN`. Before returning to `pnpm dev` in Terminal 1, remove its preview override with `Remove-Item Env:PUBLIC_ORIGIN` (or use a new terminal), so development uses its configured/default origin. Vite preview is a local build inspection tool; production deployment remains separate work.

## Troubleshooting

### Tool versions or installation

If a command is missing, install/select the prerequisite and open a terminal with the correct PATH. If frozen installation reports `ERR_PNPM_UNSUPPORTED_ENGINE`, compare the Node requirement with `node --version` and the actual executables from `Get-Command node,pnpm`. After a successful installation, compare pnpm's host runtime using the user-agent command above as well. A compatible child `node` does not prove that pnpm itself runs under that version. Do not disable strict engine checks or regenerate the lockfile to bypass the error.

### Docker engine unavailable

Check `docker compose version`, then `docker info`. A missing `dockerDesktopLinuxEngine` pipe or connection failure means the engine is unavailable before PostgreSQL or Prisma can work. Start/restart Docker Desktop through the normal Windows user shell, select Linux containers and wait for engine readiness, then retry `docker info` and `pnpm db:up`. The [T03 recovery record](docs/verification/t03-repeatable-checks.md#5-postgresql-retry-and-runtime-recovery--2026-10-22) describes a particular observed Desktop/socket failure; it does not establish a permanent fix or require changing Docker runtime directories on another machine. Do not reset Docker data to resolve an ordinary connection failure.

### Occupied ports

API port 3000, frontend port 5173, preview port 4173 and PostgreSQL port 5432 must be available for the default setup. Vite uses strict ports and fails instead of silently selecting another one. List current listeners:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 3000,5173,4173,5432 } |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

Inspect a reported PID before stopping anything; replace the example with the actual PID:

```powershell
$listenerProcessId = 12345
Get-CimInstance Win32_Process -Filter "ProcessId = $listenerProcessId" |
  Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine
```

Stop a recognized application from its own terminal. If an abandoned development tree belongs to this checkout, inspect its parent PIDs too and stop only that identified project tree through Task Manager. Do not terminate all Node processes. Check listeners again, then restart `pnpm dev`; watchers can exist without listening ports, so inspect the identified tree when investigating incomplete shutdown.

To use a different API port, edit `API_PORT` in `.env` and restart both API and Vite; it configures the proxy target too. To use a different PostgreSQL port, edit both `POSTGRES_PORT` and the port component of `DATABASE_URL`, then run `pnpm db:up` to apply the changed container mapping while retaining the volume. The frontend and preview keep their documented strict default ports. Use the isolated-checkout recipe when a second database project is needed.

### Database connection errors

Work through these checks in order:

1. Confirm `docker info` succeeds and `pnpm db:up` completes. `docker compose ps` should show this checkout's PostgreSQL as healthy.
2. Confirm the private root `.env` exists. `pnpm env:init` preserves an existing file; it does not repair its values. Use an editor to inspect settings locally without pasting credentials into logs or chat.
3. Check for process environment overrides. These take precedence over `.env` for the API/Prisma and Compose, so an old terminal value can make commands disagree with the file. This prints only whether a variable is set, not its value:

   ```powershell
   'DATABASE_URL','POSTGRES_USER','POSTGRES_DB','POSTGRES_PASSWORD','POSTGRES_PORT','API_PORT','COMPOSE_PROJECT_NAME' |
     ForEach-Object {
       [pscustomobject]@{ Name = $_; SetInThisTerminal = (Test-Path -LiteralPath "Env:$_") }
     }
   ```

   Remove only unintended overrides from the terminal, for example `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue`, then rerun the command. Avoid dumping the environment or `docker compose config`, which can expose credentials.
4. Check that `DATABASE_URL` uses the intended loopback host, database, user, password and published `POSTGRES_PORT`. A healthy container's `pg_isready` check does not prove that the API's credentials authenticate. `pnpm db:status` checks through the configured application connection.
5. If authentication fails after `.env` was replaced, restore the settings that initialized the retained volume. Changing `POSTGRES_PASSWORD` in `.env` does not change an existing database role's password. A deliberate role-password change must also update the matching connection settings; deleting the volume is not a password-repair step.
6. Once the connection works, run `pnpm db:migrate` and `pnpm db:status`, then restart `pnpm dev` and check `/api/ready`.

If the browser reports a connection error while direct API health works, check the configured `API_PORT` and restart Vite to reload its proxy target. If health succeeds but readiness fails, continue database diagnosis: the footer connection indicator reports liveness only. An unavailable account check has its own retry state and does not prove that the session has expired. If login/logout is rejected by Origin protection, use the exact frontend address matching `PUBLIC_ORIGIN`, including the port.

## Workspace layout

| Path | Responsibility |
| --- | --- |
| `apps/web` | React/Vite account forms, signed-in shell, in-memory session coordination and connection status. |
| `apps/api` | NestJS server, validated settings, Prisma/migrations, health/readiness, registration and protected session APIs. |
| `packages/contracts` | Shared health/readiness, registration and session types/routes, plus the health response guard. |
| `packages/game-engine` | Buildable entry point reserved for approved movement/combat rules; currently exports no rules. |

`pnpm dev` first builds the shared packages, then starts their TypeScript watchers, the NestJS development server and Vite together. API dev/build/typecheck regenerate the ignored Prisma client. Shared packages use `workspace:*` links, so they resolve from this repository rather than a public registry. Konva, routing, sockets and form/editor libraries remain deferred to their feature tasks.
