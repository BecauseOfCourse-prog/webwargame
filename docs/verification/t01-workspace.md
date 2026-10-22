# T01 Verification: Workspace and Application Skeleton

Date: 2026-10-22

Result: Passed. T01 is complete; B02 and M0 remain incomplete until T02–T04 are finished.

Follow-up: [T01 code review](../reviews/0002-t01-code-review.md) records the subsequent approved style extraction, repeat checks and the outstanding T04 shutdown verification.

## Delivered artifacts

- [Root workspace commands](../../package.json) and [pnpm workspace](../../pnpm-workspace.yaml).
- [Pinned dependency lockfile](../../pnpm-lock.yaml).
- [Browser connection page](../../apps/web/src/App.tsx) and [development/preview proxy](../../apps/web/vite.config.ts).
- [NestJS entry point](../../apps/api/src/main.ts) and [health controller](../../apps/api/src/health.controller.ts).
- [Shared contract and runtime guard](../../packages/contracts/src/index.ts).
- [Empty, buildable rules-engine entry point](../../packages/game-engine/src/index.ts).
- [Run/build instructions](../../README.md) and [decision rationale](../decisions/0001-workspace-foundation.md).

## Evidence

| Check | Observed result |
| --- | --- |
| Initial `pnpm install` | Installed from an initially empty application workspace and created the lockfile. Network retries occurred but installation completed. |
| `pnpm install --frozen-lockfile --offline` | Passed with no dependency/lockfile changes. |
| Clean source copy | Copied manifests, configuration, lockfile and source files into an isolated ignored `.local/t01-clean-*` directory without existing `node_modules` or `dist`; offline frozen installation reused 204 cached packages with no downloads, then typecheck and build passed. |
| `pnpm typecheck` | All four workspace packages passed. Shared packages build before application type checks. |
| `pnpm build` | Both shared packages, NestJS and the Vite production frontend built successfully; no type errors. |
| `pnpm dev` | Shared watchers, Vite on port 5173 and NestJS on port 3000 started. The browser displayed `Сервер доступен`. |
| Direct and proxied health requests | `/api/health` on ports 3000 and 5173 returned the expected `status: ok` and `service: wargame-api`. |
| Browser retry | Clicking `Проверить соединение` made a fresh request and returned to the connected state. |
| Compiled application | Vite preview on port 4173 loaded built frontend assets; its relative API request succeeded. The compiled API was also independently started using the documented API start command after the development API was stopped. |
| Server unavailable | Stopped the verified local development API processes; retry in the preview page displayed `Не удалось связаться с сервером. Попробуйте ещё раз.` |
| Recovery | Started compiled API, clicked retry in the same preview page, and observed `Сервер доступен` without reloading. |
| Engine entry resolution | Imported the package by its own workspace package name under Node 22.22.0; resolution succeeded and exported no game rules. |
| Visual check | Inspected the page in the in-app browser: heading, explanatory copy, status and retry button displayed without overlap. A local screenshot is saved in ignored `.local/t01-preview.png`. |

## Environment and limits

Verification ran on Windows with the shell's Node.js 22.22.0 and pnpm 11.25.0. The installed standalone pnpm reports its own Node.js 24.19.0 runtime; both supported runtime lines are recorded in the engine policy. This is not a full OS/browser/runtime compatibility matrix.

The Windows shell quoting issue in the initial shared-package filter was fixed using double quotes before successful checks. Development shutdown through the automated terminal did not reliably stop its nested watch processes; verified repository-specific processes were explicitly stopped for the offline-API scenario. Do not terminate unrelated Node processes. This does not affect the health result, but the local walkthrough should check shutdown behavior in the owner's terminal during T04.

No application test suite or CI workflow is claimed by T01. Verification is build/type checks, isolated installation and actual HTTP/browser smoke checks. Database readiness/persistence, authentication, game rules, full responsive/accessibility coverage, production deployment and paid hosting are not included. The health response reports process availability only. No database credentials or production secrets were created, and no remote push was performed.
