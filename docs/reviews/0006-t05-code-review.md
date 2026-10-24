# Review 0006: T05 Registration

Date: 2026-10-24

Scope: T05's uncommitted implementation against `6d3d6e47831170525f6837369695eaff575188db`: API setup/registration, contracts, schema/migration, hashing dependency/lockfile, tests, CI and related documentation. See [Specification 0008](../specs/0008-t05-registration.md) and [verification](../verification/t05-registration.md). Two independent source reviews covered HTTP/password handling and persistence/dependencies; the parent reviewed the combined change and reran checks.

## 1. Finding and correction

One P2 defect was confirmed and corrected before publication. No unresolved actionable finding remains in the reviewed scope.

**P2 — Validate raw UTF-8 before decoding password-bearing JSON.** The original [JSON parser setup](../../apps/api/src/application.ts) inherited body-parser's permissive Unicode decoding. An HTTP request containing byte `FF` inside an otherwise valid password was accepted with 201, and the password reaching validation contained U+FFFD instead. Byte `FE` produced the same replacement; UTF-16LE JSON was also accepted despite the documented UTF-8 contract. The reproduction used the real application factory and a validation stub without database writes. Zod correctly rejected malformed JavaScript strings, but it could not recover invalid bytes already replaced by the transport decoder.

The parser's `verify` callback now enforces `utf-8` and calls Node's `isUtf8` on the bounded raw buffer before body-parser decodes it. Unsupported charsets return sanitized 415; malformed UTF-8 returns sanitized 400. The existing attempt limiter still runs first. This uses a built-in API available in the supported runtimes and adds no dependency, configuration, migration or service cost.

The new [integration regression](../../apps/api/test/registration.integration.test.mjs) rejects `FF`, `FE` and UTF-8-encoded surrogate bytes, rejects UTF-16LE and checks that no account is written. A valid UTF-8 password containing a literal U+FFFD and an astral character still registers and verifies exactly, so the correction does not reject valid password characters indiscriminately.

## 2. Other reviewed behavior

- Strict request validation, explicit `PLAYER` writes and public response selection reject role/ID/hash injection without leaking input, stored hashes or database diagnostics.
- Argon2id parameters, random salts and bounded asynchronous hashing match the specification. The encoded hash retains verification parameters; passwords are not trimmed or normalized.
- Actual socket addresses, pre-parser attempt counting, global/address limits, expiration and capacity handling do not trust forwarding headers or evict live budgets.
- The additive migration retains the baseline. The normalized unique index decides concurrent duplicates; the service recognizes the installed Prisma adapter's exact username-constraint metadata.
- Integration tests create/drop only a generated loopback database and close their applications/connections. Root checks remain database-free; CI runs database checks after migrations. Dependency versions, native build permission and engine constraints remain consistent.
- Documentation distinguishes T05's registration API from future forms, sessions, administrator bootstrap and game permissions. Process-local counters, proxy-shared quotas and host-specific hashing measurements remain documented limitations rather than newly discovered defects.

## 3. Verification and limits

After the correction, `pnpm check` passed lint, workspace type checks, Prisma/client generation, all builds and 24 database-free tests under Node 22.22.3/pnpm 11.25.0. `pnpm test:database` passed 13 reported Node test cases: eleven registration scenarios, their parent and the existing readiness network-failure scenario. Migration status reported both migrations applied. The regression exercised the real HTTP parser and PostgreSQL. The temporary database was removed by successful cleanup.

Earlier fresh Windows/Linux installation and hashing results remain separately recorded in [T05 evidence](../verification/t05-registration.md); they were not rerun as part of this review. This is not a complete security audit, all-runtime execution matrix, production host measurement or remote CI success claim. All 235 local file/heading links across 26 Markdown documents and staged/working diff checks passed. The 26 staged files contain only T05 implementation/tests/documentation; scanning 82 maintained files and built browser assets found no actual local database password or URL. Final database reads showed zero project users and zero leftover test databases. An independent review of the raw-byte correction found no remaining issue. The owner explicitly authorized commit/push once review corrections were verified; publication itself does not deploy the application.
