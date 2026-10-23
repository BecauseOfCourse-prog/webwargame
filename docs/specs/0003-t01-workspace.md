# Specification 0003: T01 Workspace and Browser/API Skeleton

Date: 2026-10-22

Status: Implemented; includes the approved style follow-up. Parent: B02. Task: T01.

## 1. Problem and boundary

Before T01 the repository held planning documents only. T01 establishes a locally runnable frontend/backend, resolvable shared packages and a real browser-to-API request. It adds no registration, database models, board, movement, turns or combat formulas. [T02](0004-t02-local-database.md) subsequently adds database-dependent API startup; do not use T01's historical database-free startup as the current run instructions.

Runtime follow-up (2026-10-23): [the T03 review correction](0006-t03-repeatable-checks.md#8-runtime-correction--2026-10-23) supersedes the original runtime reference with Node 22.22.3 and narrows supported ranges to `^22.22.3 || ^24.15.0`, matching locked development dependencies. T01 verification remains historical; current instructions live in README/current context.

## 2. Structural changes

| Artifact | Responsibility |
| --- | --- |
| Root `package.json`, `pnpm-workspace.yaml`, lockfile | Private workspace, exact package-manager/direct versions, scripts and dependency graph. |
| `tsconfig.base.json`, `.node-version`, `.gitignore` | Strict compiler defaults, reference runtime and exclusion of local/generated outputs. |
| `apps/web` | React/Vite entry point, welcome page, connection request and stylesheet. |
| `apps/api` | Nest module, bootstrap and liveness controller. |
| `packages/contracts` | ESM entry point, health route, health type and runtime guard. |
| `packages/game-engine` | Empty ESM entry point that builds and resolves without invented rules. |

Shared packages expose built JavaScript and declarations. Root build commands respect dependency ordering. `pnpm dev` builds shared packages before starting package watchers, Nest's compiler/restart loop and Vite. TypeScript checks alone do not produce browser assets; Vite produces the browser bundle. Installed modules and `dist` are ignored. T02 moved pnpm non-auth settings from the original `.npmrc` into workspace YAML.

## 3. Browser behavior and request contract

The welcome page renders the project identity, introductory copy, connection status and a retry button. Initial Russian text supports the owner's walkthrough; final language/device scope remains Q08.

The page requests the shared `HEALTH_PATH` (`/api/health`) using `fetch` with `cache: no-store`. HTTP success and `isHealthResponse` must both pass before displaying `Сервер доступен`. The response must be a non-null object whose `status` is `ok` and `service` is `wargame-api`; additional properties are not rejected by this small guard.

| State | UI behavior |
| --- | --- |
| Checking | Displays a checking message and disables retry. |
| Connected | Displays a positive text/dot status; retry is enabled. |
| Unavailable | HTTP error, invalid body, JSON error, network failure or timeout gives an error message and enables retry. |

The effect aborts after five seconds, clears its timer on completion/cleanup and ignores updates after disposal. Cleanup also aborts an obsolete request, including React StrictMode's development cleanup cycle. Clicking retry starts a new attempt. Status has an accessible live region and is expressed in text as well as color. It is a point-in-time check, not continuous connection monitoring.

## 4. HTTP and proxy boundary

`HealthController` returns HTTP 200 with `{ "status": "ok", "service": "wargame-api" }`. The route reports API process availability; it does not prove database access, account availability or a playable game.

Vite development and preview servers forward `/api` requests to the loopback API. The browser uses one origin, so no broad CORS exception is added. Development/preview use fixed loopback ports 5173/4173 and fail on conflicts. T02 makes the proxy target's API port configurable through root settings while keeping this relative-request contract.

## 5. Visual decision

The owner approved the T01 appearance as the direction for subsequent UI. Follow [interface style](../design/interface-style.md), [CSS tokens](../../apps/web/src/styles.css) and AGENTS.md. The style follow-up extracted token values without changing appearance and scoped the welcome heading/footer rules to their layout. Forms and board/admin screens should reuse the palette and component direction while adapting density and heading sizes.

No paid fonts, UI kit, graphical assets, router, Socket.IO or Konva dependency was introduced by this increment. Konva remains confirmed for the board task, not part of this shell.

## 6. Acceptance and verification

| Acceptance condition | Evidence |
| --- | --- |
| Clean dependency install and working package links | Isolated source-only installation, lockfile and engine package-resolution check. |
| Real frontend/backend startup | `pnpm dev` launched both applications and shared watchers. |
| Browser-to-API request through one origin | Browser displayed success from the proxy; direct/proxied responses matched. |
| Rejected/unavailable requests and retry | Disconnected API displayed an error; restarted API and retry restored success. |
| Typed, buildable packages | All four type checks and builds passed. |
| Style preservation after token extraction | Compared computed colors/fonts/sizes/radii/widths before and after reload; desktop values matched. |

See [T01 verification](../verification/t01-workspace.md), [initial code review](../reviews/0002-t01-code-review.md) and [combined review](../reviews/0003-t01-t02-code-review.md). These reports distinguish actual checks from planned coverage. The source implementation starts at [App.tsx](../../apps/web/src/App.tsx), [main.ts](../../apps/api/src/main.ts) and [contracts](../../packages/contracts/src/index.ts).

## 7. Remaining scope and compatibility

The first increment used shared health types and a minimal guard rather than a generic API schema framework. T02 introduces Zod for actual runtime configuration. No UI design change or fabricated game algorithm is required for that evolution. Full accessibility/device coverage, CI/lint and complete Windows development shutdown validation remain later tasks. Production hosting does not use Vite preview.
