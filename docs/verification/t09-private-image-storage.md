# T09 Private Image Storage Verification

Date: 2026-10-25. Implementation began 2026-10-24.

Change: [Specification 0012](../specs/0012-t09-private-image-storage.md). Sources: [controller](../../apps/api/src/assets/assets.controller.ts), [service](../../apps/api/src/assets/assets.service.ts), [decoder/body reader](../../apps/api/src/assets/image-input.ts), [filesystem](../../apps/api/src/assets/asset-storage.ts), [configuration](../../apps/api/src/config/environment.ts), [migration](../../apps/api/prisma/migrations/20261024000400_private_assets/migration.sql) and [contracts](../../packages/contracts/src/index.ts).

## 1. Environment and automated checks

Windows PowerShell used portable Node 22.22.3 and pnpm 11.25.0, with both pnpm host/child commands on that runtime. Docker Desktop Engine 28.5.1 ran PostgreSQL 18.6. Docker was initially stopped after the resumed turn; it was started, then the existing PostgreSQL container/volume was started without resetting data. Sharp 0.35.5 is pinned with its platform dependencies in the updated lockfile; no paid service was used.

Final Windows `pnpm check` passed lint, typecheck, Prisma generation, API/browser builds and 118 reported database-free cases: 117 passed, one skipped, zero failed. Groups: fifteen configuration/startup/local-target, fourteen registration, 31 auth/access/bootstrap, 24 image/storage and 34 web. The skipped file-symlink test requires Windows link-creation privileges; directory-junction protections passed. Log: ignored `.local/t09-verification/check-final.log`.

The thirteen [image tests](../../apps/api/test/image-input.test.mjs) generate actual PNG/JPEG/WebP/APNG/animated-WebP fixtures and cover strict MIME/signatures, full-raster corruption despite readable metadata, truncation, orientation/metadata stripping, exact sRGB PNG pixel/alpha preservation, input/output byte expansion, side/pixel bounds, content encoding, declared/chunked lengths, interruption/premature close and an absolute body deadline using controlled timers. The native decoder's ten-second cancellation was configured and inspected, not artificially forced in a timing test.

The eleven [filesystem tests](../../apps/api/test/asset-storage.test.mjs) cover reinitialization without leftovers, exact quota boundaries/orphans, absent/partial/complete pending reservations, overgrown physical files, exclusive no-overwrite creation, path traversal, missing/size-mismatched/nonregular reads, symlink/junction/ancestor redirection and insufficient free-space reserve. Recursive cleanup checks the exact generated temp directory's resolved containment before removal.

## 2. Real HTTP and PostgreSQL

`pnpm test:database` passed 61/61 reported cases without skips, including the prior 44 account/administrator/readiness cases and seventeen new [asset cases](../../apps/api/test/assets.integration.test.mjs) (sixteen child scenarios plus parent). Log: ignored `.local/t09-verification/database.log`. A focused asset run also passed 17/17 before the full run. Suites use checked random loopback databases, apply migrations twice and remove only their own databases/temp directories.

Asset scenarios verified:

- Actual static PNG/JPEG/WebP uploads return safe metadata matching persisted rows, generated UUID files and exact returned-byte length/SHA-256. All three normalized images decode; EXIF/XMP/IPTC are absent. Metadata has no path, original filename or internal readiness flag.
- A replacement application retains sessions, metadata and exact image bytes from the same directory. Unknown/malformed/traversal IDs cannot read filesystem paths.
- Header-only oversized requests receive anonymous/player/Origin/marker/CSRF rejection before image-body consumption. Image metadata/content reads reject anonymous/player/foreign-origin/missing-marker requests. Live demotion/revocation applies to both uploads and reads, including changes while a valid body is still arriving.
- Mismatched MIME, SVG/GIF, malformed/truncated PNG/JPEG/WebP, real animated WebP and byte/side/pixel limits fail without creating metadata/files. EXIF orientation becomes physical image dimensions without resizing; JPEG colors remain within the fixture's rounding tolerance.
- Chunked overflow and disconnected uploads release capacity and create no partial file. A competing upload receives 429; interruption releases its processing slot.
- Physical orphans consume quota; full storage still serves existing ready files. Two API instances sharing a root/database cannot both consume its final capacity. Pending rows with absent/partial files reserve their full size and return 404 for metadata/content.
- Missing/nonregular files return sanitized 503 while metadata can remain readable. A controlled Asset-table outage returns no SQL, paths, credentials or native diagnostics.

Main `pnpm db:migrate`, repeat application and `pnpm db:status` passed: all five migrations current. Only the new Asset migration was added; prior migration files were unchanged. No real account was promoted or created in the main database.

## 3. Clean Linux installation and container persistence

A credential-free maintained-source snapshot under ignored `.local/t09-verification/linux-source` used the already available `node:22.22.3-bookworm-slim` image. Frozen installation was its first dependency operation and completed with pnpm 11.25.0; the lockfile SHA-256 remained equal to the working copy. The first full check used a Windows bind mount: lint/types/build passed, but both existing fifteen-second API-startup tests timed out during slow module loading (13/15 configuration cases passed). This failed run is retained in `.local/t09-verification/linux-check.log`; it is not a passing Linux claim. The slim image also emitted Prisma's OpenSSL-detection warning.

The same installed snapshot was copied to disposable Linux volume `webwargame-t09-workspace-20261025` for a check without Windows-mounted dependency I/O. Root `pnpm check` then passed lint, types, generation/builds and all 118 cases, without failures/skips, including file-symlink and existing API-startup cases. No application test timeout was relaxed. Log: ignored `.local/t09-verification/linux-native-check.log`. Installation was not repeated over the already installed snapshot. Its lockfile SHA-256 matched the working copy (`3F5B1FC50F6BE97030C34A0CA345241C2B21DBE4E1830E6B22BBEC4582388898`). The image's Prisma/OpenSSL warning remains an image-preparation limitation; a production image must select/install its supported system dependencies in T36.

A separate actual Linux API container used only a random checked `t09_container_<24 hex>` database and synthetic administrator, with source at `/workspace`, private upload bind mount at `/private-images` and loopback-only host port 3119. The host's main `.env` was not changed. Initial container start overlapped the snapshot's build and found a temporarily absent compiled file; it was restarted after build completion. A later request before readiness also failed; the successful checks followed actual startup.

After readiness, a real administrator login/upload stored a synthetic 32×24 PNG. Protected metadata and exact content digest were verified. The first API container was gracefully stopped and removed; a new container with a different ID used the same private bind mount/database. Its retained session retrieved identical metadata and exact image length/SHA-256. No re-upload occurred after replacement. This validates the mount boundary and API persistence, not a production container image or backup/restore drill. Logs: ignored `.local/t09-verification/container-first.log` and `container-second.log`.

## 4. Review correction, cleanup and limits

Independent source review found that the initial transaction-held lock could expire before a slow filesystem write ended. It was corrected before completion: a short transaction now durably reserves full bytes in a pending row before any write; readiness is set only after complete write/sync. The reviewer rechecked absent/partial/growing-file accounting and the ready transition and found no additional actionable concurrency issue. Dedicated storage and real HTTP tests cover the corrected invariant. This is an implementation review within T09, not a separately owner-requested publication review.

Both temporary API containers were stopped/removed after checking; the exact disposable container database was dropped. Temporary environment/session/password state and uploaded fixture file were removed only after resolving/checking containment under `.local/t09-verification`. The native-check container exited/removed itself and its dedicated Linux workspace volume was removed. The main PostgreSQL container/volume remains healthy and retained.

Final read-only probes confirmed zero main users/sessions/assets, one administrator guard, five completed migrations and no T05–T09 disposable databases. A scan of 216 maintained/built files found no actual local database URL/password; no secret values were printed. All 390 local file/heading links across 37 Markdown files and `git diff --check` passed after the final context/backlog update. Test port 3119 and temporary containers were checked closed/absent.

T10 still owns reference protection and safe cleanup of pending/orphaned content; there is no deletion API or player-content visibility. No new browser UI, full device/browser matrix, remote CI success, production deployment or off-host backup is claimed. Default limits have not been measured against the owner's real map collection or a selected production host. Windows file permissions require an appropriate ACL, and its Node API does not provide directory fsync. At implementation completion, no commit/push had been requested; the subsequent owner-requested review follows below.

## 5. Owner-requested review and publication

The owner explicitly requested review, corrections and commit/push. [Review 0010](../reviews/0010-t09-code-review.md) found one P2 correctness issue: the quota transaction inherited PostgreSQL isolation, so a default Repeatable Read snapshot could miss the preceding writer's pending reservation after waiting for its advisory lock. An owned disposable PostgreSQL probe first reproduced zero visible rows despite one committed reservation. A new controlled HTTP regression then configured only its random suite database to Repeatable Read, held the first transaction until the second actually waited in `pg_locks`, and kept the first committed file absent until the second quota decision. Before the fix, the second upload incorrectly returned 201 instead of 507; log: ignored `.local/t09-verification/review-isolation-before.log`.

The service now explicitly requests `isolationLevel: 'ReadCommitted'` for reservation transactions. The test restores the fixture database default and releases all controlled operations in `finally`, including on the reproduced pre-fix failure. Documentation review also removed a stale assertion that uploads did not exist and added Asset to README's migration overview. No new dependency/schema/migration was required by review corrections.

The new controlled regression failed before the fix (201 instead of 507), then the focused asset suite passed 18/18 after rebuilding with explicit Read Committed; log: ignored `.local/t09-verification/review-isolation-after.log`. Both runs restored the disposable database's default and removed their owned fixtures.

Focused independent review checks also passed thirteen image/body, ten configuration and ten filesystem cases with one Windows file-symlink privilege skip. Initial review root and complete database runs passed 117/one skip and 61/61 before the isolation regression was added; logs: ignored `.local/t09-verification/review-check-before-isolation.log` and `review-database-before-isolation.log`. The earlier Linux/container flows above were not repeated or relabeled as new review runs.

Fresh post-fix root `pnpm check` passed lint, types, Prisma generation/builds and 118 reported cases: 117 passed, one Windows file-symlink privilege skip, zero failures. Fresh `pnpm test:database` passed all 62 reported cases, including eighteen asset cases (seventeen children plus parent). Logs: ignored `.local/t09-verification/review-check.log` and `review-database.log`. No test timeout was loosened; the correction adds one controlled isolation regression.

Final read-only probes again confirmed zero main users/sessions/assets, one administrator guard, five completed migrations and no T05–T09 disposable databases, including the independent review probe. A scan of 217 maintained/built files found no actual local database password/URL. All 411 local file/heading links across 38 Markdown files and whitespace checks passed after the final documentation update. The lockfile is unchanged by review corrections.

Fetched `origin/master` matched the reviewed T08 base. The authorized publication excludes all private configuration, generated output, installed dependencies, fixture data and logs. Exact pushed SHA is verified against remote and reported to the owner; remote CI success and deployment remain separate outcomes.
