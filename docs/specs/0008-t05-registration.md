# Specification 0008: T05 User Registration

Date: 2026-10-24

Status: Implemented and verified. Task T05 / parent B03. The browser part of B03 remains T07.

## 1. Problem and outcome

M0 has no account model. T05 introduces persisted player accounts and a validated registration API, with password protection, database-enforced username uniqueness and bounded registration work. Login, sessions, browser forms, administrator provisioning and game access remain T06–T08/later tasks.

## 2. Confirmed policy and scope

The owner confirmed on 2026-10-24: public self-registration; usernames use ASCII Latin letters, digits, period, hyphen and underscore, with 3–32 characters. Trim surrounding whitespace, retain spelling for display and use lowercase ASCII as the unique key. A successful registration always creates a player; it grants no game membership and creates no login session. Q07 is resolved only for registration; session lifetime and rules visibility remain open.

Passwords support 15–128 Unicode code points, spaces and passphrases, without composition rules. Preserve password content exactly; do not trim or normalize it. Reject control characters and malformed Unicode. This is a project policy, not a claim of full NIST compliance or a breached-password screening implementation.

## 3. Decisions and resulting behavior

- Reuse NestJS, Prisma/PostgreSQL and Zod. Add a `User` model and one forward migration rather than modifying the T02 baseline. Separate display username and unique normalized key; let the unique index decide concurrent duplicates.
- Use `argon2` 0.45.1 with explicit Argon2id parameters, a library-generated random 16-byte salt and 32-byte hash in an encoded PHC string. This string includes algorithm, version, costs, salt and hash for later verification. The initial budget is 19 MiB, two iterations, parallelism one, with at most two registration hashes in flight. Excess work returns 503 without an unbounded queue of passwords. This follows the [OWASP minimum](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); measure again on the eventual host. The package adds native-binary/build maintenance but no recurring service bill. Node 22 support rules out depending on newer native Node Argon2 APIs; scrypt would avoid a package but consume more memory at recommended settings.
- Strictly validate the request and explicitly construct database writes/public responses. Never accept roles, hashes or IDs supplied by the caller, and never return password material or database diagnostics.
- Limit attempts to ten per actual connection address and 100 globally per 15-minute fixed window in one process. Count attempts before body parsing, including invalid/duplicate submissions. Keep at most 4096 active address entries, prune expired entries and refuse new entries when full rather than evicting live budgets. Denied requests do not extend the windows. No Redis or paid dependency is needed for the confirmed one-instance deployment. Restart resets counters; shared addresses share a quota. Fixed windows permit bursts around their boundary. Revisit before adding proxy trust or backend instances.
- Keep root checks database-free; add real HTTP/PostgreSQL registration integration checks separately and to CI after migrations.

The password length recommendation is informed by [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html). The library API and platform support are documented by [node-argon2](https://github.com/ranisalt/node-argon2). Important choices were explained in Russian in the owner conversation before implementation.

### API contract

`POST /api/auth/register` accepts an uncompressed UTF-8 JSON object with only `username` and `password`. Request body parsing is limited to 4 KiB. Requests without JSON content type are rejected. A pre-decoding verifier rejects non-UTF-8 charsets and malformed UTF-8 bytes so the decoder cannot silently replace password content. The new shared request/response types and path live in [contracts](../../packages/contracts/src/index.ts); the API independently validates runtime data with Zod.

| Outcome | HTTP / response |
| --- | --- |
| Created | 201: `{ "user": { "id": "<UUID>", "username": "Commander", "role": "PLAYER", "createdAt": "<ISO timestamp>" } }`. No cookie or session is created. |
| Field/body validation | 400, `code: INVALID_REGISTRATION`, generic message and `fields` arrays keyed by `username`, `password` or `body`. Unknown property names and supplied values are not echoed. |
| Username collision | 409, `code: USERNAME_TAKEN`. Case/trim collisions and concurrent requests use the same result. |
| Malformed JSON / oversized JSON | 400 `INVALID_JSON` / 413 `BODY_TOO_LARGE`. Parser diagnostics are replaced so fragments of password-bearing input cannot escape. |
| Wrong media type / unsupported parser encoding | 415, `JSON_REQUIRED` / `UNSUPPORTED_ENCODING`, with a generic message. |
| Attempt limit | 429, `REGISTRATION_RATE_LIMITED`, integer `Retry-After` seconds. |
| Hashing capacity/failure or persistence failure | 503, `REGISTRATION_UNAVAILABLE`, generic retry message without driver diagnostics. |

Registration responses use `Cache-Control: no-store`. The connection's socket address is authoritative for the limiter; `X-Forwarded-For`, `Forwarded` and `X-Real-IP` supplied by callers cannot restore their quota. Proxy trust is not enabled. Through Vite or a future reverse proxy, users share the proxy address and therefore its quota until a carefully restricted proxy-address policy is implemented.

### Storage, compatibility and operations

[The Prisma schema](../../apps/api/prisma/schema.prisma) adds `UserRole` (`PLAYER`, `ADMIN`) and `User`: database-generated UUID, display `username`, unique `normalizedUsername`, `passwordHash`, role defaulting to `PLAYER`, and creation timestamp. SQL checks constrain username spelling and its lowercase key. `ADMIN` supports the later bootstrap task; no administrator provisioning or role-change API exists. Public registration explicitly writes `PLAYER` and never spreads input into a database write.

[Migration 20261024000100](../../apps/api/prisma/migrations/20261024000100_user_registration/migration.sql) adds the enum/table/index without changing the T02 baseline or existing tables. Apply with `pnpm db:migrate`; rebuilding alone does not migrate. The database constraint decides uniqueness even when registrations race. Prisma 7's adapter can report its name under `meta.driverAdapterError.cause.constraint.index`; translate only the known username conflict (or the older expected field metadata), not every database failure, to 409.

No new environment variable or paid service is required. The exact package/lockfile and `pnpm-workspace.yaml` explicitly permit argon2's native-module install step. Windows x64 and Linux x64 Node 22.22.3 frozen installations and hashing were verified. Other supported runtimes/platforms have not all been executed. `createApplication` centralizes HTTP setup for the executable and real integration tests; health/readiness semantics are preserved. The current 4 KiB JSON parser limit must be reconsidered for future content endpoints; uploads need their own limits.

Preserve the new migration in history. Reverting application code need not remove the additive table; removing it after users exist would destroy accounts and is not a rollback command provided by T05.

## 4. Acceptance and actual verification

All T05 acceptance conditions passed on 2026-10-24; see [verification evidence](../verification/t05-registration.md). Main and fresh credential-free Windows copies passed frozen installation/root checks with 24 database-free tests. A fresh Linux container passed frozen installation/the same root suite and real Argon2id operations. The final reviewed database suite passed eleven registration scenarios plus the existing readiness network-failure scenario; registration's parent test makes thirteen reported Node test cases. It created and removed its own random database, deployed both migrations twice, checked persistence across API restart, raced normalized duplicates, verified exact password content/salts and proved invalid/role-injected/limited requests make no writes. Main local migration deployment, safe reapplication and current status also passed.

An independent implementation review identified the Prisma adapter metadata issue before final integration verification; it is corrected and real duplicate/race checks pass. A brittle initial test assumed PHC parameter order and was corrected to compare parsed parameters. The first offline clean-install attempt lacked access to a cached tarball; a separate new source copy passed a frozen installation from the normal store. These initial attempts are not counted as passing runs. Documentation link/diff and secret checks are recorded in the evidence.

The later owner-requested [Review 0006](../reviews/0006-t05-code-review.md) found one P2 transport-decoding defect: body-parser accepted UTF-16 and replaced malformed UTF-8 bytes before field validation. The raw-byte verifier fixes it without a new dependency. The root suite and expanded real database suite passed after the correction; no unresolved review finding remains. Earlier fresh-install/Linux evidence remains historical and was not rerun during this review.

## 5. Limits and deferred scope

No authentication/session cookie, account management, UI or permission guard is implemented here. Public registration intentionally reveals a username collision through a useful conflict response; login errors in T06 must remain generic. Production proxy/TLS configuration, host-specific hashing measurements and off-host backups remain later deployment work. The owner authorized commit/push after a clean final review; this does not authorize deployment.
