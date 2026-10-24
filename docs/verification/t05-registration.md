# T05 Registration Verification

Date: 2026-10-24

Task: T05 / B03. Change: [Specification 0008](../specs/0008-t05-registration.md).

Sources: [application HTTP setup](../../apps/api/src/application.ts), [registration service](../../apps/api/src/registration/registration.service.ts), [password hashing](../../apps/api/src/registration/password-hasher.ts), [attempt limiter](../../apps/api/src/registration/registration-limiter.ts), [database integration test](../../apps/api/test/registration.integration.test.mjs) and [unit tests](../../apps/api/test/registration.test.mjs).

## 1. Environment and isolation

Windows checks used the existing portable Node 22.22.3 in ignored `.local/t03-runtime-fix-20261023/node-v22.22.3-win-x64` and pnpm 11.25.0 hosted by that same runtime. PATH was scoped to verification commands; the system Node installation was not replaced. `pnpm exec node --version` and `process.env.npm_config_user_agent` both confirmed 22.22.3.

Docker Desktop was initially stopped. A normal launch through the Windows shell restored Engine 28.5.1; the existing Compose PostgreSQL 18.6 service became healthy. No Docker settings, runtime directory, existing image or volume was deleted. Integration checks used a generated `t05_registration_<24 hex characters>` database, never registration rows in the owner's database. The test accepts only canonical loopback PostgreSQL URLs without query/fragment overrides and drops only the identifier it generated. Every API/client is closed and the temporary database is dropped in cleanup.

## 2. Installation and database-free checks

| Check | Actual result |
| --- | --- |
| Exact dependency | Added `argon2` 0.45.1 and six locked packages including it; explicitly permitted its native install in pnpm workspace policy. Installation completed using its shipped Windows binary. |
| Main root suite | `pnpm check` passed ESLint, workspace type checking, Prisma generation, API/frontend/shared builds and all 24 database-free tests (ten existing configuration/startup/local-target and fourteen registration/hash/limiter tests). |
| Fresh Windows source | Created a separate ignored source-only directory with no `.env`, `node_modules`, generated client or builds. Its first dependency operation was `pnpm install --frozen-lockfile`, which installed 467 packages without changing the lockfile. Both actual runtimes were confirmed and `pnpm check` passed all 24 tests without database credentials. |
| Fresh Linux source | Read-only mounted a separate source-only copy into disposable `node:22.22.3-bookworm-slim`, image digest `sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752`. Copied into the container's temporary filesystem; installed pnpm 11.25.0, then performed `pnpm install --frozen-lockfile` as the first project dependency operation. Full `pnpm check` and all 24 tests, including actual Argon2id hashing/verification, passed on Linux x64. No project credentials were mounted; container was automatically removed. Registry metadata requests briefly timed out and recovered; no configuration bypass was used. |
| Password semantics and capacity | Verified independent salts, algorithm/version/costs, correct/wrong passwords, retained spaces, Unicode code-point bounds, control/unpaired-surrogate rejection, admission of two concurrent hashes, prompt 503 for the third and reuse after completion. |
| Limiter | Nine fake-clock tests cover address/global budgets, exact expiration, independent windows, retry timing, bounded capacity/no live-entry eviction, denials not spending/extending budgets and invalid internal settings. |

The initial offline fresh-copy attempt could not obtain a cached `@eslint/js` tarball from its available store. It stopped before verification; a separate new copy with normal store access passed the frozen installation above. The first hashing assertion expected a specific PHC parameter order; the library encodes identical costs in a different order. Tests now parse the parameters rather than treating ordering as an API guarantee.

## 3. Real HTTP and PostgreSQL

`pnpm test:database` passed twelve reported Node test cases: ten registration scenarios, their parent test and the existing readiness network-interruption test. This runs against actual PostgreSQL and HTTP listeners, without replacing the database container.

| Scenario | Observed result |
| --- | --- |
| Clean/idempotent migrations | Both committed migrations applied to the random clean database, a second deploy was safe, and applied migration names matched the committed directories exactly once. |
| Registration and storage | HTTP 201, public UUID/display name/`PLAYER`/timestamp only; no session cookie. Database retains lowercase normalized key and independently salted Argon2id hash. Equal passwords have different hashes; exact passwords verify and trimmed variants fail. |
| Restart and duplicate | New API instance saw the existing account; case/whitespace collision returned 409 without adding rows. |
| Concurrent collision | Two simultaneous normalized-equivalent requests returned one 201 and one 409; exactly one matching database row exists. |
| Supported boundaries | Three- and 32-character usernames, 15/128 astral-code-point passwords, a space-only 15-character password and decomposed Unicode were accepted as specified. Canonically composed password variants did not verify against different supplied bytes. |
| Invalid input / privilege injection | Invalid names/passwords/types, control/unpaired-surrogate input, unknown fields and caller-supplied role/ID/hash all returned useful bounded 400 responses; user count did not change. |
| HTTP parsing | Malformed JSON and null/primitives returned 400, oversized JSON 413, text/form media 415. No private input or configuration appeared in errors. |
| Attempts and spoofed addresses | Ten malformed requests spent the socket address's budget despite differing forwarding headers. The oversized eleventh request returned 429 before parsing, with positive `Retry-After` at most 900 seconds. A following valid request still returned 429; no user was created. |
| Existing readiness regression | Established connection silently stopped forwarding SQL; readiness returned bounded 503 and health stayed 200. |
| Cleanup | All app/client connections closed and the test's own random database was dropped successfully. |

The first integration harness attempt resolved Prisma's package root to its unused declaration path; changing resolution to the exported `prisma/build/index.js` CLI fixed the harness. Final full execution passed. An independent source review identified Prisma 7's nested adapter conflict metadata; the implementation handles the exact username constraint and the passing duplicate/race checks exercise that path.

## 4. Existing local schema and documentation

`pnpm db:migrate` applied `20261024000100_user_registration` to the owner's existing baseline database. A second deployment reported no pending migrations; `pnpm db:status` reported two migrations and an up-to-date schema. No test accounts were inserted there. The T02 migration was retained unchanged.

Independent source/document consistency review identified three stale README descriptions of account/schema/test scope; these were corrected. All 223 local file/heading links across 25 Markdown documents and `git diff --check` passed after corrections. A scan of all 81 maintained files and built browser assets found neither the actual local database password nor its connection URL; no secret values were printed. The fresh Windows lockfile remained identical to the main lockfile. A final read-only query confirmed zero users in the local project database and zero remaining `t05_registration_*` databases.

No commit, push, remote GitHub Actions run, browser registration UI, login, role guard or production deployment is part of this evidence. Linux database integration was not run; real database tests were executed from Windows against Linux PostgreSQL. Production host performance and the full Node/platform matrix remain unmeasured.

## 5. Owner-requested review and UTF-8 correction

The owner requested code review and authorized commit/push after a clean result on 2026-10-24. [Review 0006](../reviews/0006-t05-code-review.md) found one P2 defect in raw JSON decoding: invalid UTF-8 password bytes became U+FFFD and non-UTF-8 Unicode JSON charsets were accepted. The correction validates the raw buffer with Node's built-in `isUtf8` and permits only UTF-8 before body-parser decodes the request. No schema, configuration or dependency changed for this correction.

After correction, main `pnpm check` passed all 24 database-free tests and `pnpm test:database` passed 13 reported cases (eleven registration scenarios, their parent and readiness). New actual HTTP/PostgreSQL checks rejected `FF`, `FE`, encoded-surrogate bytes and UTF-16LE without writes; valid UTF-8 with literal U+FFFD and an astral character registered and verified exactly. Both migrations remained applied and current. Logs are retained in ignored `.local/t05-review-check.log` and `.local/t05-review-database.log`; no secrets were printed.

The earlier installation/Linux results above were not rerun during this review. Final review/publication checks passed: 235 local links across 26 Markdown files, working/staged diff, the 26-file T05 publication scope and actual-credential scan across 82 maintained files plus built browser assets. Final read-only queries confirmed zero project users and zero leftover T05 databases. Independent review accepted the UTF-8 correction with no remaining issue. Remote CI is a separate result; no production deployment is included.
