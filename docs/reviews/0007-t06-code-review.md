# Review 0007: T06 Login and Sessions

Date: 2026-10-24

Scope: Uncommitted T06 against `25cc824e5a663c9dee0d1dfd464812c3d449ba9d`: HTTP boundaries, authentication/session services, token/cookie helpers, configuration, schema/migration, tests, CI and documentation. See [Specification 0009](../specs/0009-t06-sessions.md) and [verification](../verification/t06-sessions.md). The owner requested review, correction, commit and push.

## 1. Confirmed finding and correction

**P2 — Recheck expiry when cleanup deletes a session after waiting for a renewal.** The original [cleanup query](../../apps/api/src/auth/session.service.ts) bounded candidates with an expired-row subquery but checked only their token hashes at deletion. An authenticated renewal admitted before idle expiry could be waiting on a row lock. After its old deadline passed, cleanup selected the old expired row and queued behind the renewal. When renewal committed a new idle deadline, cleanup still deleted the row selected from its earlier snapshot. A successful current-user request was therefore followed by loss of the session.

The [new regression](../../apps/api/test/auth.integration.test.mjs) holds a controlled row lock, queues a real HTTP renewal before its idle deadline, waits until the old deadline passes, then queues cleanup. It observes both waits through `pg_stat_activity` before releasing the lock. The old query failed with `Cleanup must retain the newly renewed session.` The corrected query adds the expiry condition to the outer DELETE, so PostgreSQL rechecks it on the updated target row after the lock wait. The renewed row remains usable; the 1000-candidate bound remains unchanged. No migration, dependency or service is added.

The first post-correction harness run used a whitespace-sensitive activity-query fragment that no longer matched the reformatted DELETE; this synchronization failure was corrected to match the stable DELETE prefix. It is not counted as a passing run. The subsequent full database suite passed the controlled race and all existing cases.

## 2. Other reviewed behavior

- Strict UTF-8/JSON parsing, exact trusted Origin/custom headers before parsing, session-bound CSRF and no CORS/forwarded-address trust align with the API contract.
- Bearers use 32 random bytes, only their SHA-256 digest is persisted, and CSRF is purpose-separated HMAC. Cookie names/flags, duplicate handling and malformed credential rejection match the HTTP/HTTPS policy.
- Unknown/wrong login uses generic errors and comparable Argon2 work; registration and verification share bounded capacity. Session responses contain public user/deadline data only and storage failures are sanitized.
- Rotation is transactional, reads obtain current user data, expiry/idle extension are conditional and monotonic, and current-user never writes cookies. Logout/current races cannot upsert deleted sessions.
- The additive migration retains previous history and constrains token/deadline data. Bounded cleanup, timer shutdown and test-database cleanup retain their documented behavior.

Independent persistence and HTTP reviews found no additional actionable defect after the correction. Explicit overlapping login/logout can deliver cookie mutations in response order: logout revokes the presented session, not a concurrently created session. T07 must serialize browser login/logout intents and reconcile session state. Retaining a revoked cookie or introducing versioned cookie names would change the current API policy or add complexity without a present UI requirement; this coordination limit is recorded rather than claiming cross-request ordering.

## 3. Verification and limits

After the correction, root `pnpm check` passed lint, types, client generation, all builds and 41 database-free tests under Node 22.22.3/pnpm 11.25.0. The full PostgreSQL/HTTP suite passed 31 reported cases: seventeen auth scenarios, eleven registration scenarios, their two parents and readiness. Earlier fresh-copy frozen installation and 41-test results remain separately recorded rather than relabeled as a new run.

The final test-harness safety edit was followed by another successful lint and complete 31-case database run. An independent HTTP reviewer also exercised twelve diagnostic HTTP probes with stubbed services and no database access on system Node 22.22.0; these do not replace the reference-runtime checks above.

Final checks passed: three migrations current, all 276 local links across 29 Markdown files, whitespace checks, unchanged lockfile and no actual local database credentials in 94 maintained files/built assets. The project database retained zero users/sessions and no T05/T06 disposable database remained. No actionable review finding remains. The staged 28-file scope contains only T06 implementation/tests, additive migration and related documentation/configuration; local credentials, generated code, build output and logs are excluded. This is not a full browser account flow, production deployment, complete security audit, new supported-runtime matrix or remote CI success claim. Publishing the reviewed code is explicitly authorized by the owner; deploying it is not part of the request.
