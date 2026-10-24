# T04 Local Workflow Verification

Date: 2026-10-23

Documentation finalized: 2026-10-24. Runtime checks below were performed on 2026-10-23.

Status: Passed. Specification: [0007](../specs/0007-t04-local-workflow.md).

## 1. Environment and isolation

The walkthrough used a real source-only Git clone of commit `0fe683ec6f31e2eca62979b57c31b36cb2a180a4`, created with `git clone --no-hardlinks`. It initially contained no `.env`, installed dependencies, generated Prisma client or build output. The clone lives under ignored `.local/t04-clean-20261023`; the README changes describe the existing commands and do not change application source or dependency versions.

Windows PowerShell used a portable Node 22.22.3 and a pnpm 11.25.0 wrapper explicitly hosted by that same runtime. After installation, both `pnpm exec node --version` and the `node/v22.22.3` entry in `process.env.npm_config_user_agent` were checked. The machine's system Node installation was not replaced. Docker Compose was 2.40.3-desktop.1; the existing Docker engine was running Linux containers.

The clone generated its own private settings with `pnpm env:init`. Only its ignored file was adjusted to set `COMPOSE_PROJECT_NAME=webwargame-t04-20261023` and matching `POSTGRES_PORT`/`DATABASE_URL` port 55432. Its named volume is `webwargame-t04-20261023_postgres-data`. The existing `webwargame-local` database on 5432 was left running and separate. No credential values were printed or committed.

`db:verify` was deliberately excluded: its existing implementation fixes the Compose project to `webwargame-local`, so it must not be used for this isolated checkout. The README now explicitly states that restriction. T04 instead performed the isolated stop/start and retained migration-state check in section 6; T02's broader temporary-marker test remains historical evidence.

## 2. Clean setup and application demonstration

| Step | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` as the first dependency operation | Passed; 461 cached packages installed, with no download. This proves clean-checkout setup using the existing cache, not a fresh internet download. |
| `pnpm env:init`, repeated | Created private settings; the second invocation preserved the file hash. |
| `pnpm db:up` | Created the isolated container/network/volume and waited for healthy PostgreSQL on loopback 55432. |
| `pnpm db:migrate`, repeated | Applied the committed baseline to the empty database; repeat deployment had no pending migration. |
| `pnpm db:status` | Reported migration history up to date. |
| Unchanged root `pnpm dev` | Built shared packages and started both TypeScript watchers, Nest development server and Vite. |
| Direct `GET :3000/api/health` and `GET :3000/api/ready` | HTTP 200, with expected liveness and database-readiness bodies. |
| Proxied `GET :5173/api/health` | HTTP 200 with the expected API response. |
| Real browser at `http://127.0.0.1:5173` | Russian welcome page displayed `Сервер доступен`; clicking `Проверить соединение` completed successfully. |

The browser check used the in-app browser against the running local application, not a static HTML inspection. A local screenshot was saved as `.local/t04-verification/dev-browser.png`. Browser health reports process liveness; direct readiness separately established the database connection.

## 3. Windows shutdown and restart

The first development run used an automated Windows PTY, not the owner's normal terminal. A snapshot identified 15 processes by PID and creation time, including the shell/wrappers, shared TypeScript watchers, Nest watcher/API and Vite. After Ctrl+C, the wrapper asked `Terminate batch job (Y/N)?`; answering `Y` ended the command. The cancellation exit code was 1. All captured processes had exited and ports 3000/5173 had no listeners; no forced cleanup was required.

The owner then performed two normal PowerShell start/stop cycles with Ctrl+C and `Y` when prompted. A temporary ignored `start-manual.cmd` selected the verified runtime and invoked the unchanged `pnpm dev` in the isolated checkout. A read-only observer followed descendants by PID and creation time, established database readiness and proxied health, and checked survivors/listeners after each stop. It did not send keystrokes or terminate the owner's development processes.

| Owner-terminal cycle, local time UTC+03 | Processes captured | Result after Ctrl+C |
| --- | --- | --- |
| 22:29:58–22:30:22 | 18, including wrappers/watchers/API/Vite | Readiness/proxy health reached success; zero survivors and zero listeners on 3000/5173. |
| 22:32:19–22:32:54 | 19, including wrappers/watchers/API/Vite | Same ports reused successfully; readiness/proxy health reached success; zero survivors and zero listeners. |

No forced cleanup was needed for either cycle. Local evidence is `.local/t04-verification/manual-observation.json`. An initial command-entry path error was corrected. The observer's early proxy request could produce `ECONNREFUSED` before the API finished compiling; later readiness succeeded. README now explains waiting for API startup before retrying.

The owner initially retracted the browser confirmation because the visible tab still targeted stopped preview port 4173. The agent restarted development, opened 5173, observed `Сервер доступен` and saved `.local/t04-verification/dev-browser-live.png`; the owner explicitly confirmed that the page opened. This resolves the browser-address confusion without treating a stopped preview as an application failure. The measured terminal cycles independently establish process shutdown/restart. No supervisor or dependency was added because no orchestration defect was reproduced.

## 4. Checks and operational failures

`pnpm check` passed in the clean clone under the selected Node 22.22.3: ESLint, all workspace type checks, all package/API/frontend builds and all ten configuration/startup/local-target tests. The frontend build generated the expected HTML/CSS/JavaScript output; Prisma client generation completed. This run is new T04 evidence, separate from T03's prior checks.

Bounded negative checks ran against the real package commands, with temporary loopback listeners or a synthetic incorrect password supplied only through the process environment:

| Scenario | Actual result |
| --- | --- |
| Frontend port 5173 already occupied, `pnpm --filter @webwargame/web dev` | Exit 1 in about 1.45 seconds; reported `Port 5173 is already in use`. |
| API port 3000 already occupied, compiled `pnpm --filter @webwargame/api start` | Exit 1 in about 2.47 seconds; reported `EADDRINUSE`. |
| Compiled API with a synthetic incorrect database password | Exit 1 in about 2.48 seconds; reported `Database connection failed. Check DATABASE_URL and start PostgreSQL.` |

Each failure run tracked four processes; all exited naturally without timeout or forced cleanup. Output contained neither connection credentials nor the synthetic password. Both the main and clone `.env` hashes remained unchanged. Ports were free afterwards and the isolated PostgreSQL remained healthy. Redacted logs and the machine-readable summary are under ignored `.local/t04-verification/`. An initial process-inventory sandbox denial was resolved before the counted run; that incomplete harness attempt is not recorded as an application failure.

## 5. Compiled application preview

After the successful build, `pnpm --filter @webwargame/api start` and `pnpm --filter @webwargame/web preview` ran with process-only `API_PORT=3014`. Preview remained on 4173; the alternate API port avoided interfering with the owner's 3000/5173 cycles. Direct API and preview-proxied health/readiness all returned HTTP 200 with expected bodies. In the real browser, the compiled page displayed `Сервер доступен` and its retry button succeeded. Screenshot: `.local/t04-verification/built-preview-browser.png`.

Both private environment files remained unchanged. After browser inspection, the eight captured preview/API processes were cleaned up using only their recorded PID/creation identities; ports 3014/4173 were verified free. This bounded cleanup is not claimed as a Ctrl+C test. The scratch helper's closed input prevented its text-stop path; separate cleanup verification passed. Normal-terminal Ctrl+C evidence is in section 3.

## 6. Database stop/start and recovery

Only the isolated `webwargame-t04-20261023` project was stopped with `pnpm db:down` and restarted with `pnpm db:up`; no volume-deletion option was used. The container ID changed while the migration row retained exactly the same ID, checksum, name and completion timestamp. The baseline migration ID remained `9c6796f5-2bd7-4176-83ed-1c49f78c8142`, proving the retained database was reused rather than silently initialized again. `pnpm db:status` reported up to date afterwards.

The running API returned liveness HTTP 200 and readiness HTTP 503 while PostgreSQL was down. After database startup, readiness returned HTTP 200 without restarting the API. The main project's container identity and healthy state remained unchanged. Local summary: `.local/t04-verification/database-stop-start.json`.

The first scratch harness stopped on an `ECONNRESET` in its post-restart HTTP probe. Separate fresh HTTP requests immediately confirmed API health/readiness; the harness was adjusted to use fresh connections around its blocking Docker commands and the complete sequence passed. That incomplete harness run is not counted as an application failure or as a passing full test. No application change was needed.

This demonstrates persistence of the existing migration state across ordinary container replacement. There are no game/account tables yet; no backup restoration or arbitrary future domain-data recovery is implied.

## 7. Documentation and completion

README and `.env.example` were reviewed against actual package scripts, Compose, runtime environment loading, Prisma configuration and local-database utilities. All 16 PowerShell blocks parsed successfully; operational snippets were inspected without printing private values. Final corrections removed an invalid PowerShell placeholder and clarified early startup requests and development/preview addresses.

On 2026-10-24, the final link checker passed all 190 local file/heading links across 22 Markdown files; `git diff --check` passed. An independent read-only audit found no actionable documentation or acceptance gap. Current context, the change specification and both backlogs record T04/B02/M0 completion together. Source code, dependency/lockfile versions, API, schema and approved visual style remain unchanged.

A subsequent owner-requested [code/documentation review](../reviews/0005-t04-code-documentation-review.md) on 2026-10-24 found no actionable defect. It inspected current source, commands and retained verification artifacts; runtime checks were not repeated. Its final documentation-link check includes the added review/navigation links and is recorded separately in the review.

No actual remote CI result, production deployment, account/game behavior, backup recovery or complete browser/device matrix is claimed. No volume was deleted or reset, and the main project's database was not used as a disposable verification target.
