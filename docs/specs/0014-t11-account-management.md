# Specification 0014: T11 Account Administration

Started: 2026-10-25; resumed: 2026-11-25

Status: Done for T11 account-management and password-recovery scope. Task T11 / parent B10. Game membership, voter/turn effects and full B10 completion remain T17.

## 1. Problem and scope

Administrators need bounded account listing/search, role changes, suspension/resumption, password recovery and attributed history. Add server APIs and Russian administration forms in the existing approved style. The owner confirmed a 30-minute single-use recovery code on 2026-10-25: an administrator passes the code manually, and the player chooses a new password. The service sends no messages and adds no email/paid infrastructure.

## 2. Account correctness and permissions

User gains `suspendedAt`, `passwordResetRequired` and a monotonic `version`. A working administrator has ADMIN role, no suspension and no pending forced password reset. Extend the existing guard/last-administrator triggers to preserve at least one such administrator under ordinary concurrent/multi-row writes. This includes denying self-reset of the last working administrator, because losing that code would lock out administration.

Account security changes use the existing AdministratorGuard before target rows, recheck current actor session/expiry/active ADMIN status after waiting, validate the target's expected version, change state, revoke all affected sessions and append audit in one Read Committed transaction. No-op role/status repeats do not revoke/audit again. Stale target versions return a conflict and require refresh/reconfirmation. SQL triggers maintain versions and revoke sessions/reset codes on security changes; raw database-owner maintenance is not attributed as a signed-in administrator action.

Login verifies Argon2 outside locks, then creates its session only after taking the same guard and checking the current active/reset state and version of the verified account. This prevents an old-password login from recreating a session after reset/suspension. Session reads and T09/T10 post-lock authority checks reject suspended/reset-required accounts. Existing public session response shape remains compatible. No user-deletion API is introduced.

## 3. Password recovery

An authorized administrator issues a random 32-byte base64url code, shown once and kept only in browser memory. PostgreSQL stores its SHA-256 digest, account/version binding and 30-minute expiry, with at most one current code per account. Issuance marks the account reset-required, invalidates earlier codes and closes all target sessions; old-password login remains blocked until completion. A new issue replaces a lost/expired code. Other role/status security changes invalidate pending codes too; reset-required state remains visible in administration.

Public `POST /api/auth/reset-password` accepts only `{code,password}` with trusted Origin/request marker, bounded attempts/work and the existing 15–128-code-point password policy. The code is single-use and expiry/current active-account/version are rechecked after hashing under AdministratorGuard. Hash replacement, reset-required clearing, code consumption, session revocation and a sanitized completion audit commit together. Success is 204 without a session/cookie; the player explicitly logs in afterward. No secret appears in URLs, logs, lists, history or persistent browser storage. There is no automatic mutation retry.

## 4. Interfaces and UI

- `GET /api/admin/accounts?search=&page=1`: private fixed 20-item pages and bounded ASCII username search, current role/status/reset/version fields, total count and working-administrator count.
- `GET /api/admin/accounts/:id/audit?page=1`: bounded recent attributed history for the selected account, without credential/reset secrets.
- `POST /api/admin/accounts/:id/role` with `{role,version}` and `/:id/suspension` with `{suspended,version}` return the current account.
- `POST /api/admin/accounts/:id/password-reset` with `{version}` returns the current account and one-time `{code,expiresAt}`.
- All administrator endpoints use existing session/role/Origin/request-marker/CSRF protection, no-store/sanitized responses and transactional post-wait authority checks. Public recovery has separate bounded quotas and generic invalid/expired-code responses.
- Existing `/admin` gains account search/pages, selected-account actions, named-target confirmation, explicit effects, one-time code display and audit. A separate `/reset-password` form accepts the manually delivered code/new password/confirmation. Keep green/ivory/gold tokens, readable responsive cards, labels, keyboard focus, loading/empty/error states and written status.

Async private results are keyed to the current administrator identity/session and discarded after identity changes. Actions reconcile the current session and notify other tabs with a marker only, especially on self-demotion/suspension/reset. Lost responses are ambiguous and require refresh/history rather than implicit retry. No router, UI kit or new runtime dependency is required.

## 5. Decisions and tradeoffs

One account guard is simple for this friends-scale service and preserves earlier locking semantics; expensive hashing stays outside it. The version counter also prevents stale administrative forms overwriting newer changes. Revisit lock granularity only after measured contention. A code flow adds a public recovery form/token table versus administrator-chosen replacement passwords, but avoids the administrator knowing the user's lasting password; the owner selected it. Manual delivery/verification is an operator responsibility; external delivery and paid services are excluded. Issuance temporarily disables password login, so last-working-admin protection includes reset-required state.

## 6. Changes, verification and limits

Add one numbered migration without changing applied migrations: account state/version, recovery tokens, immutable attributed audit and extended invariants/revocation. Update auth/bootstrap/assets integration, shared contracts, server/client/forms/tests and documentation. Root `pnpm check` passed; PostgreSQL suite passed 92/92, covering anonymous/player/wrong-origin/CSRF denial, actor/target races, last-working-admin concurrency, audit/revocation atomicity, stale-login prevention, reset expiry/single-use/replacement/quota/secrecy, and disposable migration reapplication. Browser review verified authenticated administration workflows and the 390 × 844 responsive layout using disposable test data. Local reset-form visual and empty-input validation passed. The browser did not submit a valid replacement password; successful redemption is verified by the API integration suite. See [T11 verification](../verification/t11-account-management.md) for evidence and limits.

No real account is selected or modified for verification. Use disposable data. Game pause/membership/vote effects, sockets, real catalog owners, deployment and off-host backup remain later tasks. No T11 commit/push has been requested.
