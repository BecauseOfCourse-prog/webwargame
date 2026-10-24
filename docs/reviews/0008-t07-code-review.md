# Review 0008: T07 Account Interface

Date: 2026-10-24

Scope: Uncommitted T07 against `896c677626dff989d1e87f06d8a2119fef6e04f3`, including forms/styles, API client, browser session controller/adapter, tests, configuration/scripts and current documentation. The owner requested review, corrections, commit and push. See [Specification 0010](../specs/0010-t07-account-interface.md) and [verification](../verification/t07-account-interface.md).

## 1. Confirmed findings

**P2 — Preserve another tab's session change across a failed queued login.** [The controller](../../apps/web/src/auth/account-session.ts) ignored `restore(true)` while a mutation was waiting/running. With two visible tabs, one tab could wait for the shared lock while the other completed a valid login. Its marker was discarded; the queued tab's subsequent wrong credentials/limit failure then restored its obsolete anonymous snapshot even though the shared cookie represented the other tab's valid session. A deferred-lock probe reproduced the mismatch. The correction remembers invalidating notifications and reconciles under the mutation lock after a definite failed login; the original login error remains a failure, with any actual restored identity shown explicitly.

**P2 — Explain an unconfirmed registration result without directing users to a nonexistent session.** A truncated/malformed accepted registration response used the generic unexpected-response text advising a session check. Registration never logs in, and the account can already exist. [The client](../../apps/web/src/auth/account-client.ts) now warns that creation may have occurred and suggests login with the same data. A regression covering truncated JSON, an invalid `201` shape and an unrecognized error response failed before the fix and passed afterward. Messages do not expose server details; cookie-ambiguity flags retain their original meaning.

**P2 — Wrap the permitted username in the signed-in heading.** [The heading](../../apps/web/src/App.tsx) includes a permitted unbroken 32-character username, while [its CSS](../../apps/web/src/styles.css) did not wrap long words. A 320 px real app viewport with a 32-`W` username had 305 px usable width but 791 px document scroll width; the heading's 215 px box required 746 px. The correction allows wrapping in the signed-in heading without changing usernames or the approved visual direction. A local fixture supplies a public session response for layout measurement only; it does not authenticate against or modify the project database.

## 2. Other reviewed behavior

The independent reviews covered password handling/code-point validation, form labels/autocomplete/focus and clearing, stale read generations, lock scope through response/reconciliation, fresh logout CSRF, expiry without a heartbeat, safe bounded responses, same-origin headers/cookies, privacy, scripts/TypeScript/CI integration and documented compatibility limits. Hypothetical proxy error semantics and an optional Retry-After countdown were not promoted to findings without a current failing requirement/scenario.

No API contract, migration, schema, dependency or paid service change is needed for these corrections. Earlier implementation-stage browser and 63/31-test results remain historical; post-correction tests and layout measurements are recorded separately in the verification report. This is not a complete security audit, native-phone/three-browser matrix, remote CI success or production deployment.

## 3. Post-correction verification

Under the selected Node 22.22.3/pnpm 11.25.0, root `pnpm check` passed lint, workspace types/builds and 67 database-free tests: 41 API, twelve client and fourteen controller. The full PostgreSQL suite also passed all 31 cases. The three marker regressions failed on the old controller (11/14 passed), then all fourteen passed. The new registration-response regression failed on the old message, then all twelve client tests passed. Logs remain under ignored `.local/t07-verification/`.

The actual built-page fixture now measures document usable/scroll width 305/305 in a 320 px frame (previously 305/791); the heading is 215/215 (previously 215/746). Desktop measurements are document 1265/1265 and heading 382/382. A screenshot is retained in ignored `.local/t07-verification/review-long-username.jpg`. The fixture made no database requests, and its temporary tab/server on 3117 were closed afterward. No actionable review finding remains.

Final checks passed all 310 local file/heading links across 32 Markdown files, whitespace checks and unchanged lockfile. No actual local database credentials were found in 102 maintained files/built assets. Read-only queries confirmed zero project users/sessions and no T05/T06/T07 disposable databases; temporary listeners 3107/3117/5173 were closed. Fetched `origin/master` still matched the reviewed base. Only the T07 source/tests, related configuration and mandatory documentation are included in publication; local settings, generated output, fixture data and logs are excluded. The exact remote SHA is verified after the owner-authorized push.
