# Specification 0009: T06 Login and Server-Side Sessions

Date: 2026-10-24

Status: Implemented and verified. Task T06 / parent B04. T05 supplies registered users; T07 owns browser forms.

## 1. Outcome and confirmed policy

Implement login, current-user lookup and logout using revocable PostgreSQL sessions. The owner confirmed on 2026-10-24: a session lasts at most seven days after login and expires after 24 hours without authenticated activity. Activity may extend the idle deadline only up to the fixed absolute deadline. Logout ends the current session immediately. Registration remains player-only and does not log in.

## 2. Decisions and scope

- Use 32 random bytes as an opaque bearer in an HttpOnly cookie; store only its SHA-256 digest, user reference and deadlines in PostgreSQL. Fast hashing is suitable for unpredictable tokens; user passwords continue to require Argon2id. PostgreSQL already exists, so this adds no paid service or Redis. Self-contained JWTs would reduce lookups but require another revocation mechanism for immediate logout.
- Use host-only `SameSite=Lax`, `Path=/` cookies, `Secure` and `__Host-` naming under HTTPS. The explicit local HTTP exception uses a separate name and accepts only configured loopback origins. No browser localStorage or token in URLs/JSON responses.
- Validate the exact configured `PUBLIC_ORIGIN` on login/logout; reject missing/null/foreign origins and never derive trust from Host/forwarding headers. Require a fixed `X-Wargame-Request: 1` header on session endpoints, including current-user, so cross-site GETs cannot silently keep a session active. No CORS permission is added.
- Bind a CSRF token to the bearer using built-in HMAC-SHA256 with a fixed purpose string. Return the derived token after login/current-user; require `X-CSRF-Token` for authenticated mutations. It cannot substitute for the HttpOnly bearer or be reconstructed from the stored bearer digest. No pre-login database session is needed because login requires trusted Origin, JSON and the custom header.
- Normalize login usernames as T05 does and preserve passwords exactly. Use generic invalid-credential responses and one Argon2 verification for both unknown users and wrong passwords. Registration and login share the two-operation hashing capacity. Limit login attempts per actual connection, globally and per normalized account; counters remain bounded/process-local.
- Check expiry and extend idle time atomically in PostgreSQL without upsert; do not refresh cookies from current-user. A concurrent request must never recreate a session deleted by logout. Read current user data rather than copying roles into the session. Expired sessions are removed in bounded periodic batches.

These decisions were explained in Russian to the owner. Relevant guidance: [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). This is a project policy, not a claim of a full security certification.

## 3. Resulting interfaces

All session endpoints require `X-Wargame-Request: 1` and return `Cache-Control: no-store`. Mutations require `Origin` exactly equal to the configured public origin. Current-user allows an absent Origin (normal same-origin GET) but rejects a foreign one. No CORS access is enabled; forwarding headers cannot establish trust. Mutations use uncompressed UTF-8 `application/json`; T05's strict raw-byte/4 KiB parser is preserved.

| Endpoint | Result |
| --- | --- |
| `POST /api/auth/login` | Strict `{username,password}`. 200 with the session view below and a fresh bearer cookie. Valid credentials atomically replace the session presented by this browser; other device sessions remain. Failed login leaves existing sessions/cookies intact. |
| `GET /api/auth/me` | Valid bearer cookie → 200 with current public user data and session view. Atomically extends idle expiry without exceeding absolute expiry or reducing an already later idle deadline. Never writes a cookie, including on 401, so a delayed old response cannot clear a new login. |
| `POST /api/auth/logout` | Valid bearer plus `X-CSRF-Token` → deletes the current session, then returns 204/empty body and an expired cookie. An empty JSON object is sufficient; no body field supplies authentication/CSRF. Invalid/expired sessions return 401 without cookie writes. Invalid CSRF returns 403 without revocation; a database failure cannot claim logout or clear the cookie. |

Session view: `{ "user": { "id": "<UUID>", "username": "Commander", "role": "PLAYER" }, "csrfToken": "<session-bound token>", "expiresAt": "<ISO timestamp>", "idleExpiresAt": "<ISO timestamp>" }`. The role is read from the user record (`PLAYER` or `ADMIN`), not snapshotted in the session. The response never includes the bearer, its digest or password material. Tokens in query/body fields do not authenticate.

| Failure | HTTP / code |
| --- | --- |
| Invalid credential payload, unknown user or wrong password | 401 `INVALID_CREDENTIALS`, identical generic message. Well-formed unknown/wrong attempts each run one Argon2id verification; this is comparable password work, not a guarantee of identical total response times. |
| Missing, malformed, duplicate, unknown or expired cookie | 401 `UNAUTHENTICATED`. |
| Missing/foreign/null Origin, missing custom request header, wrong/missing session CSRF | 403 `CSRF_REJECTED`. |
| Rate budget exhausted | 429 `LOGIN_RATE_LIMITED`, integer `Retry-After` seconds. |
| Hash capacity/corrupt hash/persistence failure | 503 `AUTH_UNAVAILABLE`, sanitized retry message. |
| Parser/media failures | Existing generic 400/413/415 responses; no input fragments. |

Login quotas are ten attempts per socket address and 100 globally per 15-minute fixed window, applied before Origin/header/body checks; forwarded addresses cannot bypass them. Valid-shaped inputs additionally consume five attempts per normalized username per 15 minutes, including successful logins. Stored budgets are bounded and expired entries pruned using the existing limiter. Denials do not extend the window. Registration has its own attempt budgets but shares the two-operation Argon2 capacity with login. Revisit limits using real group feedback; shared NAT/proxy users share the address quota.

The HTTPS cookie is `__Host-wargame.sid`; loopback HTTP uses `wargame.sid`. Both are host-only, `Path=/`, `HttpOnly`, `SameSite=Lax`, with seven-day Max-Age and absolute Expires; only HTTPS adds `Secure`. Parsing rejects ambiguous duplicates and malformed credentials and never falls back from one deployment's cookie name to the other. Only a successful login or successful explicit logout writes a cookie.

Explicit login/logout requests are separate mutations of the same browser cookie. If deliberately overlapped, response order can determine the final cookie; logout revokes its presented session rather than a concurrently created one. T07 must serialize those browser actions and reconcile session state. Versioned cookies or retaining revoked cookies would add complexity/change the agreed clear-cookie behavior; revisit only if a real client requires overlapping account changes. Read-only current-user requests remain safe to overlap because they never write cookies.

## 4. Data, configuration and operation

[The forward migration](../../apps/api/prisma/migrations/20261024000200_server_sessions/migration.sql) adds `Session` with a SHA-256 hex primary key, user foreign key (cascade on deletion), creation/absolute/idle timestamps and user/cleanup indexes. SQL checks constrain digest spelling and ordered deadlines. The T02/T05 migrations remain unchanged. Database time sets and checks deadlines; atomic conditional renewal never upserts a missing/deleted row. Activity is a successful authenticated API check, so background authenticated requests can extend idle time; absolute expiry is fixed. A request admitted before a deadline can finish later during a bounded database wait. The existing five-second query/statement limits apply.

The process schedules expiration cleanup every 15 minutes, deleting at most 1000 expired rows per pass. Expiry is checked both when selecting candidates and on the DELETE target, so a concurrent admitted renewal is rechecked after a lock wait and retained. Expired tokens are rejected regardless of cleanup. The timer does not hold the process open and is cleared on shutdown. There is no per-user concurrent-device cap; login quotas and cleanup bound routine creation/retention, and logout affects the current session only.

`PUBLIC_ORIGIN` defaults to `http://127.0.0.1:5173` for existing local configuration. Its URL is normalized to an origin; credentials, non-root paths, query/fragment and non-loopback HTTP are rejected at startup without echoing values. The initializer documents/writes the default for new files and preserves existing `.env`. Preview uses `http://127.0.0.1:4173` before API startup; external origins require HTTPS and thus Secure cookies. No new dependency or lockfile graph change is introduced. Apply the new migration before using authentication. Production proxy/TLS configuration remains T36; API sockets stay on loopback.

API implementation: [controller](../../apps/api/src/auth/auth.controller.ts), [login service](../../apps/api/src/auth/auth.service.ts), [sessions](../../apps/api/src/auth/session.service.ts), [cookie/token helpers](../../apps/api/src/auth/session-security.ts) and [HTTP boundary](../../apps/api/src/application.ts). Shared request/response contracts live in [contracts](../../packages/contracts/src/index.ts). Session rows contain no reusable bearer or CSRF token; HMAC derives CSRF from the presented bearer.

## 5. Actual verification

All T06 acceptance checks passed on 2026-10-24; see [verification evidence](../verification/t06-sessions.md). Main and fresh credential-free Windows sources passed the root suite under Node 22.22.3/pnpm 11.25.0: 41 database-free tests, lint, type checking and builds. Frozen installation in the new copy was its first dependency operation. The final reviewed real HTTP/PostgreSQL suite passed 31 reported cases: seventeen authentication scenarios, eleven registration scenarios, their two parent tests and readiness. It verified exact credentials, hashed-only persistence/restart, cookies/CSRF/origin, dual expiry/monotonic renewal, role refresh, rotation/device retention, logout/cleanup races, malformed input, quotas and 1000-row cleanup batches. Unit checks additionally cover shared hashing capacity and sanitized storage/deletion failures. The main local migration deployed/reapplied safely and all three migrations are current.

Independent design/implementation review found two race corrections during implementation: do not clear cookies on unauthorized old requests, and do not move idle deadlines backwards. Both are implemented and covered by the database suite. No unresolved actionable finding remains. No full browser form flow, new Linux execution or remote CI run is claimed; earlier T05 platform evidence remains separately dated. Documentation/link and credential checks are recorded in the evidence.

The later owner-requested [Review 0007](../reviews/0007-t06-code-review.md) reproduced one P2 cleanup/renewal race against real PostgreSQL. An outer expiry predicate now prevents stale cleanup candidates from deleting a renewed session. The new controlled-lock regression failed before the fix and passed afterward; root/full database checks passed again. This correction adds no schema/configuration/dependency change. Earlier fresh-copy evidence remains historical.

## 6. Deferred scope and limits

No login/registration forms, administrator role guards, suspension/reset UI, game access or socket delivery is implemented here. T08/T11/T28 must reuse session validation and revocation. Counters reset on restart and proxy users share a socket address quota; production trusted-proxy/deployment work remains later. The selected lifetimes favor convenience for friends over short workstation-lock intervals. The owner subsequently authorized review corrections, commit and push; no paid service or production deployment is included.
