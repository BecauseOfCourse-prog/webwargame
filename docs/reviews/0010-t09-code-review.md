# Review 0010: T09 Private Image Storage

Date: 2026-10-25

Scope: Uncommitted T09 against `cbb5e0be8414ec0f0e51a56b72513e9d2cfc8bea`, including image/body decoding, private filesystem and persistence services, administrator HTTP boundaries, schema/migration, configuration, dependencies, tests, CI and documentation. The owner explicitly requested review, corrections, commit and push. See [Specification 0012](../specs/0012-t09-private-image-storage.md) and [verification](../verification/t09-private-image-storage.md).

## 1. Findings and corrections

### P2: Pin reservation isolation to Read Committed

The initial [reservation transaction](../../apps/api/src/assets/assets.service.ts) inherited PostgreSQL's configured default isolation. Under Repeatable Read, a writer can establish its snapshot while waiting for the advisory lock. After the preceding writer commits a pending reservation and releases that lock, the waiting writer can still see the older snapshot without that reservation. If its file has not appeared yet, capacity can be over-reserved. The current Compose default is Read Committed, so this condition requires a nondefault database setting.

An isolated real PostgreSQL probe reproduced zero pending rows observed after lock acquisition despite one committed row. The correction explicitly selects `isolationLevel: 'ReadCommitted'` for this transaction so the capacity query sees commits after lock acquisition. This makes the operation's locking protocol independent of the server default without adding a dependency, schema change or recurring cost. A controlled HTTP/PostgreSQL regression exercises two actual API instances against a disposable database configured to Repeatable Read; its before/after result is recorded in the verification evidence.

### Documentation: stale storage and migration overview

[README](../../README.md#where-local-data-lives) still said persistent uploads did not exist, and its migration overview stopped at T08. Both now describe T09 Asset metadata and the separate persistent image directory, including coordinated retention/backup with PostgreSQL. These corrections stay within the T09 specification.

## 2. Reviewed behavior and limits

Three independent reviews covered storage/concurrency, input/authorization and operations/configuration/dependencies. Primary review checked their integration, reproduction, regression coverage and publication scope.

- [Image input](../../apps/api/src/assets/image-input.ts) and [HTTP setup](../../apps/api/src/application.ts): exact supported MIME/signatures, PNG/WebP animation containers, full strict raster decoding, byte/side/pixel bounds, metadata removal and orientation/sRGB normalization, raw-upload JSON-parser bypass, pre-body Origin/session/role/CSRF checks and post-body authority reconciliation. Documented JPEG rounding and native timeout/metadata-queue limits remain explicit.
- [Filesystem](../../apps/api/src/assets/asset-storage.ts) and [service](../../apps/api/src/assets/assets.service.ts): generated UUID namespace, exclusive creation, regular-file/size/inode read checks, counted orphan files, durable absent/partial pending reservations, readiness only after complete write/sync and bounded processing work. The earlier implementation-review lock-lifetime correction remains intact. No cleanup/delete protocol is introduced; T10 must never release capacity while an old writer can still finish.
- [Controller](../../apps/api/src/assets/assets.controller.ts): current administrator reads, private/no-store/nosniff, fixed format-derived filenames and streamed content. The installed Nest adapter destroys streams on client disconnect and handles HEAD; native stream errors do not log private paths.
- [Configuration](../../apps/api/src/config/environment.ts), [migration](../../apps/api/prisma/migrations/20261024000400_private_assets/migration.sql), manifests/lockfile/CI and test fixtures: validated paths/limits, sanitized failures, constrained metadata and uploader reference, pinned Sharp native packages, no new service and scoped random-database/temp-directory cleanup.

No other actionable source defect was found. This review does not claim a production deployment, off-host recovery drill, full browser/device matrix, real-map performance measurement or remote CI success. The earlier Linux installation/container checks remain separately dated; documentation-only review corrections do not relabel those checks as freshly executed.

## 3. Verification and publication

Fresh root and PostgreSQL results after the correction, final documentation/private-value checks and cleanup are recorded in [verification](../verification/t09-private-image-storage.md#5-owner-requested-review-and-publication). Focused independent runs also passed thirteen image/body cases, ten configuration cases and ten filesystem cases with one Windows file-symlink privilege skip.

Fetched `origin/master` matched the reviewed T08 base. Publication includes T09 source/tests/configuration, the new migration and lockfile, and mandatory specification/context/backlog/review/evidence updates. Private environment settings, generated output, installed dependencies, local fixtures and logs are excluded. Commit/push is explicitly owner-authorized; the exact resulting remote SHA is verified after push and reported to the owner. No force push or deployment is part of the request.
