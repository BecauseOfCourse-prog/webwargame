# Review 0003: T01–T02 Code and Current Specifications

Date: 2026-10-22

Scope: Current workspace, all authored application/shared-package source, configuration, local database/migration utilities and tests. T01 is based on commit `b60e6e3`; T02 and these corrections are reviewed in the uncommitted working tree.

## Confirmed findings and corrections

| Priority | Finding and practical consequence | Correction and evidence |
| --- | --- | --- |
| P2 | The persistence verifier checked `URL.hostname`, but pg connection-string query parameters override the apparent host/port/user. A URL displaying `127.0.0.1` with `?host=...` could bypass its local-only guard and send later operations to a different endpoint. | Verified with the installed parser on a synthetic URL: apparent host was loopback while parsed driver host differed, without contacting that host. Added a reusable local-target guard requiring a matching canonical Compose URL, no query/fragment and matching credentials. Three regression tests cover canonical, override and malformed/mismatched targets. |
| P2 | Database settings bounded connection setup and server-side statement execution, but not an established connection whose query never reaches PostgreSQL. `/api/ready` could hang while the server's statement timeout never starts. | Added pg `query_timeout: 5000`. A real-DB test API behind a local TCP proxy successfully connects, then outbound SQL is silently discarded. Before the fix the request hit the outer eight-second deadline; afterward readiness returned HTTP 503 within the bound and liveness stayed HTTP 200. |

Both confirmed findings are fixed in the reviewed code. No unresolved blocking code finding remains in the inspected T01–T02 scope.

## Additional inspection

- The frontend has a real relative health request, status/body validation, finite timeout, cleanup and retry behavior. It deliberately reports liveness rather than database readiness.
- Shared exports, strict compiler configuration, dependency ordering, pinned versions, generated ESM client imports and local package links are consistent with the current build.
- Root local secrets and generated artifacts are ignored; initialization does not overwrite an existing environment file. API validation and database error responses omit supplied passwords and connection URLs.
- API startup validates configuration, performs an actual database query and closes resources on listener failure. The database client follows NestJS lifecycle hooks. The exact timeout correction is covered above rather than assuming server and client timeouts are equivalent.
- The schema contains no invented account/game models. Migration history is committed as source; local persistence checks use their own random disposable database, retain the volume and clean up their own records/database only.
- The approved UI token system remains unchanged. This review adds no visual redesign, package upgrade, paid service or speculative feature implementation.

## Verification performed for this review

| Check | Outcome |
| --- | --- |
| `pnpm typecheck` | Passed for all four packages. |
| `pnpm build` | Passed, including Prisma generation and browser/API output. |
| `pnpm test:config` | Ten tests passed, including three new local-target regression cases. No live database is required by this command. |
| `pnpm test:database` | One real local PostgreSQL integration test passed after the fix; the pre-fix silent-network request failed at the outer deadline. Temporary proxy/API processes were cleaned up. |
| `pnpm db:verify` | Passed with the stricter local target guard: migration replay was idempotent, container ID changed, marker survived, and the disposable database was removed. |
| `pnpm db:status` | Current project schema up to date. |
| `pnpm install --frozen-lockfile --offline` | Passed; no new dependency was needed for the fixes or regression tests. |

The new TCP test initially had a mutable-port routing mistake in its own setup; that setup was corrected before the meaningful before/after query-timeout reproduction. The earlier setup failure is not counted as evidence of the application defect.

Final documentation checks cover local links and whitespace. Prior clean-source installation and browser evidence remain linked in the original verification reports; they are not presented as newly rerun checks. This is a focused application/configuration review, not an implemented authentication review or a dependency vulnerability audit.

## Open verification item

T04 still needs a normal Windows terminal Ctrl+C shutdown check and a clean restart without orphaned development watchers. Earlier automated terminal shutdown did not reliably stop nested processes. There is insufficient evidence to claim the same issue reproduces in the owner's terminal, so this remains a named verification gap, not an invented confirmed product defect.

## Documentation delivered

- [Current project context](../specs/0002-project-context.md): audience/budget, implemented versus planned stack, architecture, status, interfaces and open decisions.
- [T01 incremental specification](../specs/0003-t01-workspace.md): workspace/browser/API changes, request behavior, visual follow-up and T02 compatibility boundary.
- [T02 incremental specification](../specs/0004-t02-local-database.md): configuration, Prisma/migrations, lifecycle, local storage, test boundaries and both review corrections.

The initial project specification remains the original plan. Current context points to decisions, implementation status and actual verification, so planned registration/gameplay is not confused with shipped behavior. No commit, remote push or production deployment was performed by this review.
