# Review 0011: T10 Asset Lifecycle

Date: 2026-10-25

Scope: Uncommitted T10 against `dbac2967c29069104300f45d3e7b8beb2151a522`, including lifecycle HTTP/service, internal references and SQL protections, activity gates, filesystem cleanup/CLI, contracts, scripts/tests and documentation. The owner explicitly requested review, corrections, commit and push. See [Specification 0013](../specs/0013-t10-asset-lifecycle.md) and [verification](../verification/t10-asset-lifecycle.md).

## 1. Findings and corrections

### P2: Recheck queued lifecycle mutation authority after the asset lock

The initial archive/restore [controller](../../apps/api/src/assets/assets.controller.ts) called `lifecycle(id, archived)` without passing the authenticated request. Session/role guards ran before its [service transaction](../../apps/api/src/assets/assets.service.ts) waited for the global asset lock. A request authenticated before a session deletion or administrator demotion could therefore mutate archive state after that revocation while it was queued. T09 upload already rechecked authority after its own lock/body wait.

A controlled real HTTP/PostgreSQL regression waited until `pg_locks` showed the queued request, then revoked its session or role before releasing the blocker. All four archive/restore × session/role variants incorrectly returned 201 and changed state before the fix. The correction passes the request into lifecycle mutations and rechecks current session existence/expiry and ADMIN role after lock acquisition, before asset reads/updates. A shared helper retains the same post-lock check for uploads. Read-only lifecycle access retains the normal guard boundary.

This adds a local session/role lookup per archive/restore operation and no dependency, schema change or recurring service cost. Checking only at request admission would leave revocation during a lock wait ineffective; the post-lock check follows the existing T09 mutation policy. Exact regression and final verification outcomes are in [the review evidence](../verification/t10-asset-lifecycle.md#6-owner-requested-review-and-publication).

### Documentation: describe the T10 database suite

[README](../../README.md#build-and-inspect) omitted `t10_assets_*` from disposable database names and did not mention lifecycle/cleanup/CLI checks in its database-test overview. It now includes them and clarifies that destructive CLI execution is confined to those owned test fixtures. Lifecycle documentation also records the post-lock authority check.

## 2. Independently reviewed behavior

Three independent reviews covered cleanup/filesystem, references/SQL/transactions and operations/HTTP/docs. The primary review checked integration, the reproduced defect, correction, test isolation and publication scope.

- [Activity](../../apps/api/src/assets/asset-activity.ts) and [filesystem](../../apps/api/src/assets/asset-storage.ts): writer admission double-check, exclusive maintenance gate, non-expiring active/stale markers, ownership/token/inode checks, generated UUID paths, regular-file/symlink refusal and startup-probe integration. Offline recovery depends on verifying every owning process/container stopped; marker age is never used as proof.
- [Cleanup](../../apps/api/src/assets/asset-cleanup.service.ts): independent archive/last-detach retention, active/used-content preservation, shared-lock rechecks, FK protection, metadata-first deletion for ready and pending rows, ambiguous-commit safety, accounted orphan bytes after unlink failure, never-reused UUID assumptions, bounded candidates and repeat-safe removal. The earlier implementation-review pending-finalization correction remains intact.
- [References](../../apps/api/src/assets/asset-references.service.ts) and [migration](../../apps/api/prisma/migrations/20261025000100_asset_lifecycle/migration.sql): internal transaction-taking integration, no arbitrary public owners, unique owner/slot bindings, validation before replacement, current selectable targets, unchanged archived bindings, last-detach timestamps and direct-write/FK safeguards.
- [CLI](../../apps/api/scripts/cleanup-assets.mjs), scripts/contracts and tests: preview default, explicit apply, bounded argument parsing, safe help/errors, root/API forwarding and scoped random-database/temp-directory cleanup.

No other actionable defect was found. This review does not reopen documented limits around manual recovery, real catalog owner/UI integration, production process fencing, off-host backup/restore, native platform measurement or the full browser/device matrix.

## 3. Verification and publication

Focused independent runs passed twelve CLI/access cases and 24 activity/storage cases (23 passed, one Windows file-symlink privilege skip). Post-correction focused lifecycle checks passed 15/15. Fresh root `pnpm check` passed 142 reported cases (141 pass/one Windows file-symlink privilege skip), and the complete PostgreSQL suite passed77/77. Before/after regression results and final private-value/link/cleanup checks are recorded in [verification](../verification/t10-asset-lifecycle.md#6-owner-requested-review-and-publication). Earlier Linux/container checks remain separately scoped and are not relabeled as new review runs.

Fetched `origin/master` matched the reviewed T09 base. The owner-authorized publication includes T10 implementation, correction, tests, the new migration and mandatory context/specification/backlog/review/evidence updates. Existing applied migrations are unchanged; review adds no dependency/schema change. Private environment settings, installed/generated files, fixtures and logs are excluded. The exact resulting remote SHA is verified after push and reported; no force push, deployment or remote CI success is implied.
