# T07 Account Interface Verification

Date: 2026-10-24

Change: [Specification 0010](../specs/0010-t07-account-interface.md). Sources: [UI](../../apps/web/src/App.tsx), [client](../../apps/web/src/auth/account-client.ts), [controller](../../apps/web/src/auth/account-session.ts), [browser adapter](../../apps/web/src/auth/browser-session.ts) and [styles](../../apps/web/src/styles.css).

## 1. Environment and isolation

Windows PowerShell used the existing portable Node 22.22.3/pnpm 11.25.0 wrapper. No dependency, lockfile, API contract or database migration was added. The available in-app browser exercised the actual React/Vite page through the same-origin proxy.

An ignored helper created a random checked `t07_browser_<24 hex>` database on the existing local PostgreSQL, deployed committed migrations and served the actual API on loopback 3107 with public origin `http://127.0.0.1:5173`. Vite used a process-local API_PORT override; no local `.env` or main API/database setting changed. Browser fixtures created only disposable test accounts. No real user credentials were used or logged. The helper accepts only expiry/stop commands and removes only its checked database on shutdown.

## 2. Automated checks

Root `pnpm check` passed lint, type checking, Prisma generation, all workspace builds and 63 tests: thirteen configuration/startup/local-target, fourteen registration/hash/limiter, fourteen API auth/token/cookie and 22 browser-client/controller tests. No skips/failures. `pnpm test:database` also passed all 31 cases covering seventeen authentication scenarios, eleven registration scenarios, their parent tests and readiness. These are new local runs, separate from historical T06 evidence. Logs remain in ignored `.local/t07-verification/check.log` and `database.log`.

The eleven client cases exercise same-origin/custom headers, JSON, CSRF, exact credentials, public-field copying, response shape/size/UTF-8 checks, safe field/generic errors, Retry-After, ambiguous cookie mutations and bounded reads without automatic mutation retries. The eleven controller cases use deferred promises to exercise duplicate mount reads, obsolete 401/200 responses, marker invalidation, duplicate mutations, lock retention through reconciliation, lost login/logout replies, unavailable recovery, fresh CSRF after acquiring a lock, and local expiry without a keepalive request.

## 3. Actual browser results

| Scenario | Observed result |
| --- | --- |
| Initial/load and registration | Initial restore completed before forms appeared. Empty/invalid fields showed local hints and focused the first invalid field; mismatched confirmation was rejected. Valid registration created a player and returned to login with username retained and passwords cleared. |
| Duplicate and bad credentials | Duplicate registration showed a Russian username error and, after controls were enabled, focused username; wrong password showed a generic credential error. Neither form displayed raw server messages or password material. |
| Login/reload | Correct credentials displayed the actual username and PLAYER role. Lowercase login found the original display name. Reload restored from the HttpOnly cookie without password entry. |
| Two tabs | Both tabs restored the same server session. Explicit logout in one returned its login form and the other reconciled to anonymous. |
| Server expiry | The helper changed only its disposable session deadlines to valid ordered past values. Explicit session verification returned the login form and the expired-session notice. |
| Network loss/recovery | Stopping only the test Vite process while the page was loaded made session verification unavailable; it did not claim successful logout. Restarting Vite restored the same valid cookie/session on page restoration. |
| Keyboard and Unicode | In a 320 px real app frame, registration/login succeeded using Enter and a password of 128 emoji code points (256 UTF-16 units). The field was not truncated by an HTML length limit. Registration cleared the password and focused the login heading. |
| Responsive layout | Real app frames at 320, 390 and 768 px showed forms without horizontal content overflow. At 320 with a classic vertical scrollbar, layout client width and scroll width were both 305 px. The tablet layout stacks rather than squeezing the introductory column. |
| Style and controls | Existing green/ivory/gold/system/serif tokens retained. Input borders use the higher-contrast muted token; clear labels, 44 px controls, visible focus, errors, loading and password visibility were inspected. |

The documented browser viewport override did not change the observed page width, so it was reset. Responsive evidence instead uses a local ignored harness with same-origin iframes, whose actual inner/client/scroll widths were read from their DOM. This verifies CSS layout and form behavior, not real touch keyboards, native phones or separate Firefox/Edge execution. Screenshots remain in ignored `.local/t07-verification/`.

## 4. Review corrections and limits

Independent client/state/source reviews found no remaining actionable defect. Browser review corrected disabled-field focus timing and first-click loss when a focus-triggered read disabled the account controls. Only mutations now disable form/logout controls; generations invalidate earlier reads. Narrow review removed the fixed body minimum width that overflowed alongside a classic scrollbar. A shared-package rebuild exposed a development-only singleton replacement issue; adapter hot replacement now reloads and closes its old channel, preserving server-backed restoration.

The final full root check passed all 63 tests after these source corrections. While Vite was running, its shared-package rebuild triggered the corrected adapter reload; the actual browser returned to the valid signed-in identity, rather than remaining in initial checking. The 31-case database run preceded the final browser-only hot-reload correction; backend source/migrations did not change afterward.

No heartbeat keeps idle sessions alive. Foreground return/manual verification is authenticated activity and can renew idle expiry. A local deadline clears stale display without a request; server deadlines remain authoritative if clocks differ. Mutations have no artificial client abort timer and may wait for browser transport completion; the UI stays locked and explains page refresh recovery. Unsupported Web Locks browsers cannot start cookie mutations; missing notification support falls back to foreground/manual reconciliation. Web Locks coordinate cooperating tabs in the same browser origin/profile, not other devices or direct API clients.

Final source/build credential scan examined 101 maintained files and built assets without finding the actual local database password/URL. Read-only queries confirmed zero main project users, zero main sessions and zero T05/T06/T07 disposable databases. The fixture shut down successfully and removed its state file; test API 3107 and Vite 5173 no longer listened. Browser tabs were closed and viewport override reset. The lockfile remained unchanged and whitespace checks passed. After overview/backlog updates, all 297 local file/heading links across 31 Markdown files passed.

This implementation-stage evidence is not a full browser matrix, new Linux verification, role guard, game UI, production deployment or remote CI success claim. At that point T07 had not been committed or pushed; the later owner-requested review follows below.

## 5. Owner-requested review and correction

The owner subsequently authorized code review, corrections, commit and push. [Review 0008](../reviews/0008-t07-code-review.md) records three reproduced P2 findings: lost cross-tab invalidation during failed queued login, incorrect recovery guidance after an unconfirmed registration response, and signed-in long-name overflow. Focused regressions/layout probes demonstrate the original failures and corrected behavior. Final test counts, layout measurements and publication-scope checks are recorded after the corrections; earlier implementation results above remain separately scoped.

The old controller failed three new deferred-marker regressions (11/14 controller tests passed). The fix preserves invalidation until it reconciles a definite 401/429/503 login failure under the shared lock, covering both lock wait and active request. Original login errors still reject; recovered identity is explicitly identified as the actual current session. Tests also cover failed reconciliation, flag consumption and obsolete reads. The original registration message failed a new regression for an unconfirmed result; the corrected message passes truncated `201`, invalid accepted shape and HTML error cases without disclosing response details.

After all source corrections, root `pnpm check` passed lint, types, generation/builds and 67 tests: 41 API plus twelve client and fourteen controller tests. The full PostgreSQL suite passed 31 cases again. Logs: ignored `.local/t07-verification/review-check.log`, `review-database.log`, `state-marker-before.log` and `state-marker-after.log`. The backend and migrations were unchanged by this review.

A real built-page fixture supplied only a deterministic public `/me` response with a permitted 32-`W` username; it did not access PostgreSQL. Before wrapping, the 320 px frame had document client/scroll widths 305/791 and heading widths 215/746. After wrapping, those were 305/305 and 215/215; desktop was 1265/1265 and 382/382. The screenshot is ignored `.local/t07-verification/review-long-username.jpg`. The temporary browser tab and loopback 3117 listener were closed. This is new layout evidence, not a repeat of the entire initial API/browser flow.

Final local checks passed all 310 file/heading links across 32 Markdown files, whitespace validation and unchanged lockfile. A scan of 102 maintained files/built assets found no actual local database password/URL; values were never printed. Read-only queries again confirmed zero project users, zero sessions and zero T05/T06/T07 disposable databases. Temporary ports 3107, 3117 and 5173 were closed. Fetched `origin/master` matched the reviewed T06 base; no integration or force push is needed. Publication scope contains only T07 source/tests, related configuration and mandatory documentation, excluding private local settings, generated files, screenshots/fixtures and logs. Commit/push is explicitly authorized; the exact pushed SHA is checked against remote and reported to the owner. Remote CI and deployment remain separate outcomes.
