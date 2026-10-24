# T06 Login and Sessions Verification

Date: 2026-10-24

Task: T06 / B04. Change: [Specification 0009](../specs/0009-t06-sessions.md).

Sources: [HTTP setup](../../apps/api/src/application.ts), [login service](../../apps/api/src/auth/auth.service.ts), [session service](../../apps/api/src/auth/session.service.ts), [controller](../../apps/api/src/auth/auth.controller.ts), [token/cookie helpers](../../apps/api/src/auth/session-security.ts), [integration tests](../../apps/api/test/auth.integration.test.mjs) and [unit tests](../../apps/api/test/auth.test.mjs).

## 1. Environment and isolation

Windows PowerShell checks used the existing portable Node 22.22.3 and pnpm 11.25.0 wrapper from ignored `.local/t03-runtime-fix-20261023`. Both child Node and pnpm's host user-agent reported 22.22.3. The system runtime was not replaced. Existing local PostgreSQL 18.6 in Docker remained available; no container/volume replacement or data reset was performed.

Authentication integration creates only a generated `t06_auth_<24 hex characters>` database after canonical loopback/no-query/no-fragment validation, applies migrations twice and seeds real password hashes. It closes every application/client and drops only its own checked identifier. Registration's separate disposable database and readiness's temporary API/TCP proxy remain isolated from it. No test user/session is inserted into the local project database.

## 2. Root and clean-install checks

| Check | Result |
| --- | --- |
| Main `pnpm check` | Passed lint, workspace types, Prisma generation, API/frontend/shared builds and all 41 tests: thirteen configuration/startup/local-target tests, fourteen registration/hash/limiter tests and fourteen authentication/token/cookie tests. No skips or failures. |
| Fresh source-only copy | New ignored `.local/t06-sessions-20261024/source-frozen-*` had no `.env`, dependencies, generated client or build output. First dependency operation `pnpm install --frozen-lockfile` passed from the normal shared store; both runtime identities were verified. Full `pnpm check` passed all 41 tests without database credentials. Dependency graph/lockfile was unchanged. |
| Origin configuration | Defaults work for old local settings; HTTPS normalization enables Secure cookies, only loopback HTTP is allowed, and malformed/untrusted origin settings fail without exposing credential-bearing URL values. |
| Password work | Exact password bytes retained, unknown/wrong logins each perform one verification, a matching dummy hash cannot authenticate a missing user, strict invalid input cannot reach database work, and registration/login share the two-operation limit. Corrupt hash/storage failures return sanitized 503. |
| Tokens/cookies/CSRF | Random 32-byte bearer, separate SHA-256 and HMAC domains, strict cookie selection/ambiguity rejection, timing-safe CSRF validation, seven-day cookie attributes and secure/clear variants passed. Failed logout deletion cannot clear a cookie or claim success. |

Main logs are retained in ignored `.local/t06-check.log` and `.local/t06-database.log`; the clean-copy parent contains `frozen-install.log` and `fresh-check.log`.

## 3. Actual HTTP and PostgreSQL

`pnpm test:database` passed all 30 reported Node cases: sixteen authentication scenarios, eleven registration scenarios, their two parent tests and the existing readiness network-failure test. All three migrations applied once in each generated database and reapplication was safe.

| Authentication scenario | Observed result |
| --- | --- |
| Login/storage | Normalized lookup returned only public user/session fields, new cookie and CSRF. Database stores only token digest/deadlines/reference, not bearer or password material; lifetimes are seven days and 24 hours. |
| Restart/current role | New API instance accepted the persisted cookie, returned current database role and extended idle expiry; successful current-user response did not write cookies. |
| Invalid credentials | Unknown, wrong and invalid-shaped credentials returned the same bounded 401 code/message and wrote no session. Password spaces and Unicode composition remained exact. |
| Rotation/device retention | A successful re-login invalidated the presented old token and created a new one; a separate device remained valid. Failed login retained existing access. |
| Forged/ambiguous credentials | Unknown/tampered bearer, stored digest as cookie, duplicate cookie orders and body/query substitutes did not authenticate. |
| Origin/custom header/CSRF | Missing/null/foreign Origin, missing request header and wrong/cross-session CSRF were rejected. Valid logout returned empty 204 and matching expired cookie, then old token failed. Unauthorized responses did not change cookie state. |
| Expiry | Directly prepared valid rows with past absolute or idle deadlines were rejected despite a cookie. Active renewal was monotonic and clamped to unchanged absolute expiry. |
| Logout race | Concurrent current-user and logout requests could not restore the deleted row; later current-user returned 401, with no cookie write from reads. |
| HTTP input | Malformed JSON, oversized data and malformed UTF-8 produced bounded sanitized errors. Existing T05 parsing regressions remained green. |
| HTTPS cookie policy | HTTPS configured origin issued/cleared the `__Host-` cookie with Secure/HttpOnly/Path/SameSite flags. The test inspected actual HTTP headers; it did not create a TLS proxy or claim a real browser HTTPS deployment. |
| Cleanup | 1002 expired rows plus a live session were seeded. First explicit cleanup removed exactly 1000, second removed the remaining two; the live session remained valid. |
| Limits | Five normalized-account attempts across case/whitespace variants exhausted its budget. Socket budget counted bad origins/parser failures; forwarded headers could not bypass 429/Retry-After. |

The final suite also reran T05's eleven registration scenarios and the real silent database-network timeout/readiness regression. Successful cleanup removed both generated test databases and closed listeners/connections.

## 4. Main schema, internal review and limits

`pnpm db:migrate` applied `20261024000200_server_sessions` to the existing local database. A second deploy found no pending migration; `pnpm db:status` reported three migrations and up-to-date schema. Earlier migrations were unchanged.

Independent design/source review identified two race improvements before final acceptance: a stale unauthorized current-user response must not clear a newer login cookie, and a delayed renewal must not shorten an already later idle deadline. The implementation now avoids cookie writes on unauthorized responses and uses monotonic bounded renewal. Both regressions are exercised by the real database suite; no actionable review issue remains.

Final checks passed after documentation corrections: all 265 local file/heading links across 28 Markdown files, `git diff --check`, unchanged maintained/clean-copy lockfile and a scan of 93 maintained files plus built browser assets for the actual local database password/URL. No actual credentials were found or printed. Final read-only database queries confirmed zero project users, zero project sessions and zero remaining T05/T06 disposable databases.

An independent final source/document audit found no material inconsistency. Its minor wording corrections clarified that the new frozen install was performed in the fresh copy and updated README's workspace responsibilities for account/session APIs. No runtime rerun was needed for these documentation-only corrections.

This implementation-stage evidence covers APIs/integration, not a registration/login browser form flow, complete security audit, production load measurement, new Linux runtime matrix or remote CI success. At this stage no T06 commit, push or deployment had been performed; the later owner-requested review follows below.

## 5. Owner-requested review correction

On 2026-10-24 the owner authorized code review, fixes, commit and push. [Review 0007](../reviews/0007-t06-code-review.md) found a P2 cleanup race: a DELETE candidate selected while an admitted renewal was blocked could still be deleted after that renewal committed. The deterministic PostgreSQL/HTTP regression controls the row lock, confirms the blocked UPDATE and DELETE, crosses the old idle deadline, then releases the renewal first. The original code failed with `Cleanup must retain the newly renewed session.`

The corrected outer DELETE rechecks expiry on the updated row after any lock wait. The 1000-row candidate limit, schema, configuration and dependencies are unchanged. After correction, `pnpm check` passed all 41 database-free tests; the expanded `pnpm test:database` passed 31 reported cases (seventeen auth scenarios, eleven registration scenarios, two parent tests and readiness). The renewed session survived cleanup and remained usable. Logs are in ignored `.local/t06-review-cleanup-before.log`, `.local/t06-review-check.log` and `.local/t06-review-database.log`. An intermediate harness failure caused by whitespace-sensitive SQL matching was fixed; only the subsequent complete run counts as passing.

The final test-harness safety edit was followed by another successful `pnpm lint` and full 31-case database suite. Independent persistence/HTTP source reviews found no remaining actionable defect. The HTTP reviewer additionally ran twelve diagnostic HTTP probes with stubbed services and no database connection under system Node 22.22.0; these are separate from the reference-runtime suite. The explicit login/logout cookie response-order limitation is recorded in the specification and T07 coordination criteria.

Final `pnpm db:status` again reported all three migrations current. All 276 local file/heading links across 29 Markdown files and `git diff --check` passed; the maintained lockfile was unchanged. A scan of 94 maintained files plus built browser assets found no actual local database URL/password. Read-only database queries again confirmed zero project users, zero project sessions and zero remaining T05/T06 disposable databases. Credential values were neither printed nor added to evidence.

The staged 28-file scope contains only T06 source/tests, its new migration and related documentation/configuration. No local `.env`, generated/build output, temporary database files or verification logs are staged. The fetched `origin/master` still matched the T05 base before publication, so the reviewed change requires no integration or force push.

Earlier fresh-copy and implementation-stage results above remain historical. The owner authorized commit/push of this reviewed snapshot; publication is checked against the exact remote SHA after pushing and reported to the owner. Remote CI and production deployment are separate outcomes.
