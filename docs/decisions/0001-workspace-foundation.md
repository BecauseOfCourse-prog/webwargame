# Decision 0001: Workspace Foundation

Date: 2026-10-22

Status: Implemented for T01; broader gameplay and hosting decisions remain open.

Runtime follow-up (2026-10-23): the original runtime range/reference below is superseded by [the verified T03 correction](../specs/0006-t03-repeatable-checks.md#8-runtime-correction--2026-10-23): Node `^22.22.3 || ^24.15.0`, reference 22.22.3. The original rationale and verification remain historical.

## Context

The first task needs a reproducible frontend/backend skeleton, resolvable shared packages, and a real browser-to-server request. It must remain small and inexpensive, and leave database and game-rule design to their own tasks.

## Decisions and tradeoffs

- **One pnpm workspace, four packages.** Keep browser code, authoritative server code, API contracts and the future rules engine together. Use explicit `workspace:*` links. Separate repositories would add contract synchronization and release overhead; Nx/Turborepo caching is unnecessary for four small packages. The cost is a dependency-aware build order, handled by pnpm.
- **React/Vite and NestJS as proposed.** Vite serves and bundles the browser application; NestJS serves HTTP. Nest's local CLI handles compilation/watch/restart using TypeScript so its decorator metadata is emitted correctly. Avoid a custom process runner and ad hoc TypeScript transforms. The CLI adds development dependencies but no extra deployed service.
- **ES modules throughout.** Node-targeted packages use TypeScript `NodeNext` and `.js` relative import specifiers; the frontend uses bundler resolution. Published shared entry points resolve to built JavaScript plus declaration files. This avoids TypeScript path aliases that work in an editor but fail in plain Node. Shared packages must build before application startup; watch mode keeps them current.
- **Conservative compiler baseline and explicit versions.** Use TypeScript 5.9.3 with the verified React 19.3.1, Vite 8.3.5 and NestJS 12.2.0 releases. There is no need to introduce a newer compiler major solely because it exists. Pin direct versions, the package-manager version and the transitive dependency lockfile. Support Node 22.13+ in the 22.x line and 24.x; reference Node 22.22.0 locally. The installed standalone pnpm can use its own Node 24 runtime. Check both compatibility and actual verification evidence rather than assuming every allowed runtime was tested equally.
- **Minimal health contract with a runtime guard.** `GET /api/health` returns a literal status/service object. The API shares its return type; the browser treats JSON as unknown and validates it before displaying success. TypeScript alone cannot prove network data is valid. A small guard suffices for this small contract; a schema library can be introduced with richer input contracts. Do not build a generic validation framework now.
- **One browser origin in development.** The page requests a relative `/api/health`; Vite forwards it to the loopback API port. Avoid broad CORS configuration. The production design will use a reverse proxy with the same URL boundary. The local health endpoint is process liveness only; database readiness belongs to T02 and operational readiness to later work.
- **Buildable but empty game engine.** Reserve the package and verify that it builds/resolves. Export no invented movement or combat behavior. Consumers should add a dependency on it when real rules exist.
- **No unused feature libraries.** Konva remains the confirmed board choice, but T01 has no board. Defer its installation, as well as database, Socket.IO, router and editor libraries, until their feature tasks. Skip the optional NestJS core postinstall notice through an explicit pnpm ignored-build setting; no application code depends on that notice.

## Consequences and revisit triggers

No paid service, database or network-facing deployment is required to run this skeleton. The developer must run builds/checks when shared contracts change. Revisit build orchestration only if real workspace size or watch performance warrants it. Introduce richer validation when contracts grow, and environment-configured ports/readiness with T02. Russian shell copy is provisional and does not close Q08.

## References

- [pnpm workspaces and workspace protocol](https://pnpm.io/workspaces).
- [Vite getting started](https://vite.dev/guide/).
- [NestJS first steps](https://docs.nestjs.com/first-steps).
- [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html).
