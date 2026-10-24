# Specification 0010: T07 Browser Account Interface

Date: 2026-10-24

Status: Implemented and verified. Task T07 / B03–B04, B22. Uses the implemented T05 registration and T06 session APIs. See [verification](../verification/t07-account-interface.md).

## 1. Outcome and confirmed scope

Provide Russian registration/login forms, a signed-in shell and explicit logout. The owner confirmed Russian copy, current desktop Chrome/Edge/Firefox as primary browsers, and usable account forms on phones. Full phone board play remains undecided for later gameplay tasks. Preserve the approved interface palette, fonts and spacing.

## 2. Decisions

- Use existing React, plain CSS and browser fetch. Two account views on the existing page do not yet require a router, form library or server-state cache. Revisit when real navigation or repeated complex forms justify the maintenance cost. No paid service or new runtime dependency is needed.
- Extend the existing Node test runner with pure client/controller tests. Node 22.22.3 strips erasable TypeScript directly; explicit source imports are enabled in the browser's no-emit TypeScript configuration. This avoids a second test framework; actual DOM/forms still require the recorded browser checks.
- Keep session/public-user/CSRF data in memory. HttpOnly cookie management stays with the browser; never persist passwords, CSRF or account snapshots in browser storage or URLs. On reload, restore from the server before showing an account view. Registration creates a player and returns to login; it does not assume a session.
- Validate server responses at runtime and translate known errors into local Russian messages. Do not render arbitrary response text. Preserve exact password bytes and count Unicode code points rather than HTML UTF-16 length for password policy. Visible labels, hints, inline errors, focus and loading states are required.
- One session controller owns authentication state and ignores obsolete reads. A same-tab guard and a shared exclusive [Web Lock](https://w3c.github.io/web-locks/) serialize cookie-changing login/logout through response and reconciliation. A browser without this capability gets a clear compatibility message rather than unsafe concurrent mutations. Locks add no service/dependency; a custom distributed browser lock or versioned cookie protocol would be more complex.
- Mutations are not automatically retried or timed out into a competing mutation. A lost/invalid login/logout response is reconciled through current-user before further actions. Failure to establish session state is an unavailable state, not successful logout or invented expiry. GET requests have bounded waiting. A marker-only BroadcastChannel and return-to-visible checks reconcile other tabs; markers never carry credentials or confer authentication.
- No authenticated heartbeat. Restore on load, explicit retry and returning to the visible page; a local expiry timer clears stale UI without refreshing the server session. Server expiry and permissions remain authoritative. T08 owns role guards/bootstrap; the shell must not imply existing games or administrator features.

## 3. Interfaces and data

The existing page hosts login/registration and signed-in views. Existing same-origin T05/T06 endpoints, request headers, limits and cookie policy remain unchanged. No database/schema/migration change. The original health request remains available as a small connection indicator.

The API client bounds JSON responses to 16 KiB, validates public user/CSRF/deadline shapes, copies only known public fields and sends same-origin credentials, no-store, a custom request header and logout CSRF. Current-user has a ten-second timeout; cookie-changing mutations stay locked until their original response and reconciliation settle. Errors expose known Russian messages and bounded Retry-After values rather than server diagnostics. Registration explicitly warns about possible creation after a lost response.

The signed-in shell shows current username/role, manual session verification and logout. It does not expose a game list or administrator controls. The forms include confirmation, password visibility, correct autocomplete, inline errors and password clearing after submission/view changes. Read-only focus checks do not disable form controls: otherwise the first click returning to a window could be lost while the check starts. Mutation controls remain guarded synchronously. A status error gets focus after controls are enabled again. The layout stacks at 900 px and does not impose a body minimum wider than the usable viewport when a classic scrollbar is present.

Development-only hot replacement of the session adapter triggers a full page reload and closes its old notification channel. Rebuilding shared contracts previously replaced the singleton while React retained its mount effects, leaving a new controller uninitialized; fresh mounting restores from the actual cookie. Production output contains no hot-reload branch.

## 4. Acceptance and verification

Verify registration validation/duplicate errors, exact-password login, generic failed login, loading/retry/unavailable states, refresh restoration, logout, expiry, stale reads, mutation serialization and unknown-outcome reconciliation. Inspect the actual API flow in a browser, keyboard/focus and narrow layout. Record actual checks and limitations in a verification report before marking Done; do not label older T06 tests as new browser evidence.

Initial implementation checks passed lint, workspace types/builds and 63 tests, including 22 new client/controller tests. The real PostgreSQL suite passed 31 cases. Actual in-app browser checks against a disposable migrated database covered registration, field/duplicate/credential errors, refresh, two-tab logout, server expiry, network loss/recovery and 320 px keyboard registration/login with 128 Unicode code points. Responsive verification used real embedded app viewports; no native phone, separate Firefox/Edge execution or complete browser matrix is claimed. The subsequent review corrections and expanded checks follow below; detailed evidence remains separately scoped in the verification report.

## 5. Deferred scope

No game listing, membership, role enforcement, password reset, content administration, board interaction, deployment or paid infrastructure. Full phone board play and later accessibility/browser matrix remain later tasks.

## 6. Owner-requested review corrections

The owner requested code review, fixes, commit and push on 2026-10-24. [Review 0008](../reviews/0008-t07-code-review.md) found three P2 defects: a queued failed login could discard another tab's session-change marker; an incomplete registration reply suggested checking a session that registration never creates; and a permitted long username overflowed the signed-in heading. Corrections stay in this T07 increment. The controller retains invalidating notifications and reconciles a definite failed login under its existing lock while preserving the credential error. Registration's unknown-outcome message explains possible creation and suggests login. The heading wraps long words. No API, schema, migration or dependency changes are introduced; post-correction checks are recorded separately from the initial evidence.

After the fixes, root `pnpm check` passed 67 database-free tests (41 API, twelve account-client and fourteen controller), lint, types and builds. The real database suite passed 31 cases again. Three controlled-marker regressions and a registration-response regression failed on the original code and passed after correction. A built-page layout fixture verified long-name wrapping at 320 px and desktop widths without database access. No unresolved actionable review finding remains; full native/browser-matrix and production claims remain out of scope.
