# Wargame Web Service

A multiplayer, turn-based tabletop wargame service, currently at the application skeleton stage.

Built for the owner's group of friends, with no current commercial launch plan. Favor low recurring cost and simple maintenance: one host, local persistent uploads, self-hosted PostgreSQL, and off-host backups. No paid application service is required by the initial design.

## Project documentation

- [Development guidelines](AGENTS.md): explain important technical decisions as the project owner learns alongside development.
- [Interface style](docs/design/interface-style.md): owner-approved palette, typography and component direction; reuse the CSS tokens for new UI.
- [Initial project specification](docs/specs/0001-project-specification.md): proposed stack, architecture, domain model, game-state consistency, and decisions requiring clarification.
- [Product backlog](docs/product-backlog.md): traceable requirements, priorities, acceptance criteria, and delivery sequence.
- [Implementation backlog](docs/implementation-backlog.md): actionable tasks, current statuses, open decisions, and the first development iteration.
- [Specification review](docs/reviews/0001-specification-review.md): findings, corrections, and remaining product decisions.
- [Workspace decision](docs/decisions/0001-workspace-foundation.md): the T01 implementation choices and their tradeoffs.
- [T01 verification](docs/verification/t01-workspace.md): installation, build and browser-check evidence.
- [T01 code review](docs/reviews/0002-t01-code-review.md): inspection results, style changes and the outstanding Windows shutdown check.

All project documentation is in English. T01 provides a browser shell and a real backend health request. Accounts, database integration, board interaction and game rules are not implemented yet. Initial interface copy is Russian for the owner's walkthrough; Q08 still governs the eventual UI language/device scope.

The initial scope includes username/password accounts, administrator and player roles, illustrated rules, a shared interactive battle map, movement validation, turn management, unit inspection, a combat calculator, and administration of content and permissions.

## Run locally

Prerequisites: Node.js 22.13+ within the 22.x line (reference version in `.node-version`: 22.22.0), or Node.js 24.x; pnpm 11.25.0. Install Node.js and pnpm using their official installation instructions. No global NestJS CLI, database, Docker or paid account is needed for T01.

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open [the local application](http://127.0.0.1:5173). The page should report that the server is available. Use the connection button to repeat the check. Stop the development processes with Ctrl+C in the terminal running `pnpm dev`.

The backend listens on `127.0.0.1:3000`; [GET /api/health](http://127.0.0.1:3000/api/health) returns:

```json
{ "status": "ok", "service": "wargame-api" }
```

The browser requests `/api/health` on the frontend origin. Vite proxies it to the API; there is no cross-origin browser request. This endpoint reports process availability only, not database readiness or game functionality. If the API is unavailable or returns an invalid response, the page displays an error and allows a retry. Requests time out after five seconds.

Ports 3000, 5173 and 4173 (preview only) must be available. Startup fails visibly on port conflicts rather than silently choosing a different frontend port. Local servers bind only to loopback. Network exposure, environment configuration and production hosting are separate tasks.

## Build and inspect

```powershell
pnpm typecheck
pnpm build
```

Shared packages build before their consumers. Build artifacts go into each package's ignored `dist` directory. To inspect the compiled application, run these commands in two terminals, after building:

```powershell
# Terminal 1: compiled API
pnpm --filter @webwargame/api start
```

```powershell
# Terminal 2: static build preview with a local API proxy
pnpm --filter @webwargame/web preview
```

Open [the built frontend preview](http://127.0.0.1:4173). Vite preview is a local build inspection tool; production deployment will use the reverse proxy described in the specification. This is the minimal T01 workflow; database setup, lint/CI and a full onboarding walkthrough remain T02–T04.

## Workspace layout

| Path | Responsibility |
| --- | --- |
| `apps/web` | React/Vite browser shell and connection status. |
| `apps/api` | NestJS HTTP server with the health endpoint. |
| `packages/contracts` | Shared health response type, route constant and runtime response guard. |
| `packages/game-engine` | Buildable entry point reserved for approved movement/combat rules; currently exports no rules. |

`pnpm dev` first builds the shared packages, then starts their TypeScript watchers, the NestJS development server and Vite together. Shared packages use `workspace:*` links, so they resolve from this repository rather than a public registry. Runtime dependencies are introduced with their feature: Konva, database access, routing, sockets and form/editor libraries are intentionally not installed by T01.
