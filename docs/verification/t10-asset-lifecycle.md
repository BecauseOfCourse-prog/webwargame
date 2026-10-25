# T10 Asset Lifecycle Verification

Date: 2026-10-25

Change: [Specification 0013](../specs/0013-t10-asset-lifecycle.md). Sources: [reference service](../../apps/api/src/assets/asset-references.service.ts), [lifecycle/upload service](../../apps/api/src/assets/assets.service.ts), [controller](../../apps/api/src/assets/assets.controller.ts), [activity guard](../../apps/api/src/assets/asset-activity.ts), [filesystem](../../apps/api/src/assets/asset-storage.ts), [cleanup service](../../apps/api/src/assets/asset-cleanup.service.ts), [operator CLI](../../apps/api/scripts/cleanup-assets.mjs) and [migration](../../apps/api/prisma/migrations/20261025000100_asset_lifecycle/migration.sql).

## 1. Environment and scope

Windows PowerShell used the existing portable Node 22.22.3/pnpm 11.25.0 wrapper and PostgreSQL 18.6 in Docker. No dependency, lockfile, paid-service or browser-interface change was needed. The sixth migration was applied locally after checking that no default API listener occupied port 3000; repeat migration application and status passed. Previous migrations were not edited. No main account, image or reference was created by verification.

## 2. Database-free checks

Final Windows `pnpm check` passed lint, types, Prisma generation, API/browser builds and 142 reported database-free cases: 141 passed, one Windows file-symlink privilege skip, zero failures. Groups: fifteen configuration/startup/local-target, fourteen registration, 31 authentication/access/bootstrap, 48 asset cases and 34 web. Final log: ignored `.local/t10-verification/check-with-removal.log`. Earlier passing runs before the last filesystem-removal case remain in `check.log` and `check-final.log` and are not the final 142-case claim.

The asset group retains T09's thirteen image and eleven filesystem cases, adds one [actual removal/retry filesystem case](../../apps/api/test/asset-storage.test.mjs), twelve [activity tests](../../apps/api/test/asset-activity.test.mjs), eight [reference-helper tests](../../apps/api/test/asset-references.test.mjs) and three [CLI tests](../../apps/api/test/cleanup-assets.test.mjs). These cover:

- Writer/maintenance mutual exclusion, thirty concurrent admission races, old/incomplete markers remaining blocking, idempotent release, ownership/token/inode validation, nonregular/oversized controls and ancestor/junction refusal.
- Binding validation, transaction ownership, shared-lock ordering, validation before replacement, preserving an unchanged archived binding, scoped detach/release and sanitized failures.
- Preview by default, explicit `--apply`, bounded argument validation, help/invalid arguments without database loading or secret reflection.
- Generated-file-only removal, repeat removal of absent files, path/directory/symlink refusal and preservation of outside sentinels. Linux exercises directory fsync after unlink; the Windows file-symlink privilege case remains explicitly skipped there.

Initial lint found two direct throws in `finally`; release-error sanitization was moved to explicit helpers while preserving marker cleanup and upload-slot release. The later final root run above includes this correction. The existing T09 held-upload test now excludes the expected live control marker when asserting no generated image files; its image/metadata assertion remains intact.

## 3. Actual HTTP, PostgreSQL and CLI

`pnpm test:database` passed all 76 reported cases without skips: prior 62 plus fourteen new lifecycle cases (thirteen child scenarios and parent). Log: ignored `.local/t10-verification/database.log`. [Lifecycle tests](../../apps/api/test/asset-lifecycle.integration.test.mjs) use only checked random `t10_assets_<24 hex>` loopback databases, migrate twice and remove their exact owned database/canonical temp directory in `finally`. Existing suites retain their own separate fixtures.

Verified behavior:

- Actual administrator archive/restore/lifecycle reads enforce session/role/Origin/request-marker/CSRF. Existing metadata/content shapes remain compatible. Archive and restore repeats are idempotent; archived bytes retain the exact digest and existing bindings.
- Internal UNIT/MAP/RULES bindings reject missing/pending/archived new targets, preserve unchanged archived bindings and replace atomically with caller rollback. Last detach sets a fresh unreferenced timestamp. Ordinary direct reference inserts update lifecycle state, invalid targets are rejected and FK RESTRICT refuses deleting used metadata.
- Exact seven-day boundaries for archive and last detach are independently checked. Active, fresh and referenced images survive. Dry-run changes no image or metadata; bounded batches and repeat runs finish eligible ready files.
- Old pending rows with complete/absent files and generated UUID orphan files are cleaned; fresh pending/orphans and unknown filename sentinels survive. The maintenance gate refuses both preview/apply with any writer marker, rejects a competing cleaner and blocks new uploads with sanitized `ASSET_MAINTENANCE`.
- A controlled restore/reference transaction holds the common advisory lock. Cleanup actually waits in `pg_locks`, then rechecks after commit and preserves the restored/used file and binding.
- A real child CLI, pointed only at the disposable fixture, refuses a writer marker, previews by default and applies only with `--apply --limit 1`. It returns bounded JSON counts without exposing paths/passwords/URLs.
- Controlled EACCES unlink failures leave ready/pending bytes as accounted orphans. A quota check still counts those bytes, and a later run removes them without stale metadata or duplicate deletion.

## 4. Corrected pending-finalization race

Independent implementation review raised a concrete race in the initial pending cleanup order: it checked pending state, unlinked, then removed its reservation. A late/ambiguous final database update could set `ready=true` between those steps, leaving ready metadata without a file. A controlled regression reproduced exactly that condition by attempting the late update at unlink: one row became ready instead of the required zero. The failed run is retained in ignored `.local/t10-verification/pending-before.log`.

The final protocol deletes both ready and pending metadata in the revalidation transaction before any unlink. Only a confirmed commit permits file removal; a lost commit result leaves the file alone. The activity gate separately proves no filesystem writer can grow the file. The late update now affects zero rows; focused lifecycle checks passed 13/13 after correction (`pending-after.log`), then the actual CLI scenario was added and the full final 76-case suite passed. Failed unlink leaves physical bytes counted as an orphan rather than a released live writer. No time-based marker expiry or recursive deletion was added.

## 5. Linux, final maintenance and limits

The Linux check used the already available Node 22.22.3 bookworm-slim image, unchanged locked Linux dependencies from the T09 verification snapshot, and current maintained T10 sources copied onto dedicated volume `webwargame-t10-workspace-20261025`. Copying Windows-mounted dependencies took several minutes; tests then ran on the Linux volume rather than the slow Windows mount. Initial root checks passed 141/141, and after adding the real removal/retry case, a final root run passed all 142 without failures/skips, including directory fsync and symlink protection. Logs: ignored `.local/t10-verification/linux-check.log` and `linux-with-removal.log`. This is a fresh T10 check with reused dependencies, not a new clean/frozen installation claim. The prior slim-image OpenSSL-detection warning remains a production-image preparation consideration (T36), not a deployment claim.

Actual root `pnpm assets:cleanup --help` and default `pnpm assets:cleanup` succeeded after migration. Main preview returned zero candidates/removed/failed; no `--apply` was run against the main database. The destructive CLI scenario above applied only to its disposable fixture.

Final read-only probes confirmed zero main users/sessions/assets/references, one administrator guard, six completed migrations, no T05–T10 disposable databases and no control markers in the main upload root. A scan of 236 maintained/built files found no actual local database URL/password; values were never printed. Temporary test containers exited/removed themselves and the dedicated Linux workspace volume was removed. All 439 local file/heading links across 40 Markdown documents and whitespace checks passed after the final context/backlog edit. No actual asset data or credentials were added to maintained files; installed/generated/fixture/log output stays ignored.

Retention and offline crash-marker recovery are documented in [README](../../README.md#image-references-archive-and-cleanup-t10). Old control files are never expired automatically; every owning API/job/container must be verified stopped before deleting its exact stale control file. T10 does not implement content-owner rows, catalog UI, player visibility, automated production process fencing, off-host backup/restore or a full browser/device matrix. No commit/push had been requested at implementation completion; the subsequent owner-requested review follows below.

## 6. Owner-requested review and publication

The owner explicitly requested review, corrections and commit/push. [Review 0011](../reviews/0011-t10-code-review.md) found one P2 authority issue: guards admitted archive/restore before the service waited for the shared lock, but no current session/role check followed that wait. A controlled HTTP/PostgreSQL regression waits for the actual ungranted advisory entry in `pg_locks`, revokes the actor's session or demotes their role, then releases the blocker. Before correction all four archive/restore × session/role cases returned 201 and changed state. Log: ignored `.local/t10-verification/review-authorization-before.log`.

The controller now passes the request into lifecycle mutations. After lock acquisition the transaction rechecks current session/absolute and idle expiry/ADMIN role before touching the asset, using the same helper as upload. After rebuilding, focused lifecycle checks passed 15/15 without skips: role loss returned 403 `ACCESS_DENIED`, session loss returned 401 `UNAUTHENTICATED`, and state stayed unchanged in all four cases. Log: ignored `.local/t10-verification/review-authorization-after.log`. The extra fixture administrator preserves T08's last-administrator invariant; its random database/canonical temp directory is removed in `finally`.

Independent review also passed twelve CLI/access cases and 24 activity/storage cases (23 passed, one Windows file-symlink privilege skip). No other actionable source defect was found. README's database-suite overview was corrected to include T10 fixtures, lifecycle/cleanup and the disposable-only destructive CLI scenarios. No dependency/schema/migration change was required by review corrections. Earlier Linux/removal checks above were not repeated or relabeled as fresh review runs.

Fresh final root `pnpm check` passed lint, types, Prisma generation/builds and 142 reported cases: 141 passed, one Windows file-symlink privilege skip, zero failures. Fresh `pnpm test:database` passed 77/77 reported cases, including fifteen lifecycle cases (fourteen children and parent). Logs: ignored `.local/t10-verification/review-check.log` and `review-database.log`. No test timeout was relaxed.

Final read-only probes again confirmed zero main users/sessions/assets/references, one administrator guard, six completed migrations, no T05–T10 disposable databases and no main-root activity markers. A scan of 237 maintained/built files found no actual local database URL/password, without printing secret values. All 460 local file/heading links across 41 Markdown files and whitespace checks passed after the final context/backlog update. The lockfile and already applied migrations are unchanged by review corrections.

Fetched `origin/master` matched the reviewed T09 base. The authorized publication includes only T10 source, tests, scripts, its new migration and mandatory specification/context/backlog/review/evidence updates. Private settings, generated output, installed dependencies, local fixtures and logs remain excluded. Exact pushed SHA is verified against remote and reported; remote CI success and deployment are separate outcomes.
