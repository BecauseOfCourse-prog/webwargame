# T08 Administrator Access Verification

Date: 2026-10-24

Change: [Specification 0011](../specs/0011-t08-administrator-access.md). Sources: [bootstrap service](../../apps/api/src/admin-provisioning/bootstrap-administrator.ts), [CLI](../../apps/api/scripts/bootstrap-admin.mjs), [session guard](../../apps/api/src/auth/session.guard.ts), [role guard](../../apps/api/src/auth/roles.guard.ts), [overview](../../apps/api/src/admin/admin.controller.ts), [migration](../../apps/api/prisma/migrations/20261024000300_admin_access/migration.sql), [panel](../../apps/web/src/admin/AdminPanel.tsx) and [client](../../apps/web/src/admin/admin-client.ts).

## 1. Environment and scope

Local Windows PowerShell used the existing portable Node 22.22.3 and pnpm 11.25.0 wrapper, PostgreSQL 18.6 and the in-app browser. No dependency, lockfile, paid service or deployment change was needed. Main migration deployment applied the fourth migration; a second application had no pending work and status reported all four current. `pnpm admin:bootstrap --help` verified the root/API command forwarding without provisioning a real account.

## 2. Automated checks

Final root `pnpm check` completed lint, types, Prisma generation, builds and 92 database-free tests with no failures/skips: thirteen configuration/startup/local-target, fourteen registration, 31 authentication/access/bootstrap and 34 browser-client/controller tests. The latter groups include nine new guard, eight bootstrap and eight admin-client cases. Final log: ignored `.local/t08-verification/final-check.log`; the earlier full passing run is `check.log`.

Guard tests cover live role/principal fields, ambiguous/missing/secure cookies, strict origin/request marker, missing/invalid session-bound CSRF without idle renewal, fresh identity after valid mutation authentication, metadata default denial and the minimal overview response. Bootstrap tests cover strict username/arguments, missing target, initial grant/revocation transaction, refusal after initialization, idempotence and sanitized failures. Admin-client tests cover status/shape/public-field validation, bounded streamed UTF-8, safe errors and ten-second timeout without implicit retries.

`pnpm test:database` passed 44 reported cases, no failures/skips: twelve new administrator scenarios plus their parent, seventeen existing authentication scenarios plus their parent, eleven registration scenarios plus their parent and readiness/network interruption. Tests create checked random `t08_admin_<24 hex>`, `t06_auth_*` and `t05_registration_*` databases, apply migrations twice and drop only their own fixtures. Real HTTP and database checks include:

- Public registration cannot set ADMIN. Anonymous, expired, revoked and forged cookies return 401; real players and forged role headers cannot open the overview. Origin/custom-header checks precede protected-prefix body parsing.
- Competing CLI grants to two different players produce exactly one initial administrator. Promotion revokes that player's old sessions; other players' sessions remain. A fresh admin login can access the minimal public overview; an already-admin CLI repeat preserves sessions and refuses another player/missing account.
- Direct fixture role changes are reflected on the next guarded request. Last-admin deletion/demotion is rejected; multi-row removal rolls back the whole statement. A missing guard row fails closed.
- Controlled competing demotions under READ COMMITTED, REPEATABLE READ and SERIALIZABLE retain exactly one administrator. The second writer waits at the shared guard, then fails the invariant or stale-transaction check. Competing deletions also retain one administrator.

The first expanded database run exposed an obsolete T06 fixture: its role-refresh scenario promoted a player and then removed its only administrator. It now creates a separate fixture keeper before that scenario. Protection was retained; the complete rerun passed 44/44. Logs: ignored `.local/t08-verification/database-before-fixture-fix.log` and `database.log`. The final root check followed this fixture correction and the browser CSS adjustment; backend code did not change after the passing database run.

## 3. Actual browser flow

An ignored helper created a random checked `t08_browser_<24 hex>` database, migrated it and ran the actual API on loopback 3108. Vite used process-local API_PORT 3108 and public origin `http://127.0.0.1:5173`; the main `.env` was unchanged. Only disposable synthetic accounts/passwords were used. The helper's overview-failure switch returned a generic 503; successful authorization came from the actual API/guards/database.

| Scenario | Observed result |
| --- | --- |
| Anonymous/direct player URL | `/admin` first displayed login. A real player login produced “Доступ закрыт” without administrator content. |
| Initial grant and old session | Local fixture bootstrap promoted the named existing player and revoked its old session. Manual verification returned the login form and session-ended notice. |
| Fresh administrator login/reload | Password entry opened “Панель администратора”, showing only public account/role and the future-content notice. Reload restored it; account navigation showed the administrator link. |
| Overview outage/retry | With `/me` healthy and the overview returning 503, the panel showed “Не удалось открыть панель” and retry. Removing the fixture fault and retrying restored the protected panel. |
| Role removal and logout | A separate fixture administrator allowed the owner fixture to be demoted. Manual session refresh showed PLAYER and removed the admin link. A new direct `/admin` view received denial. Logout returned the login form with its notice. |
| Narrow/style/focus | A same-origin iframe with CSS width 320 px displayed the actual protected page, wrapping text and stacking actions. The heading minimum was reduced from 28 to 26 px so the long Russian word fits. Green/ivory/gold style, focus, denied/error/retry and controls were inspected. |

Screenshots are ignored `.local/t08-verification/admin-interface.jpg` and `admin-320.jpg`. The narrow check is visual inspection of a real iframe, not a phone/touch-keyboard test or a separate Chrome/Edge/Firefox matrix. The DOM adapter did not expose iframe document metrics, so no numeric overflow measurement is claimed. Initial checking was observed; no artificially delayed loading-duration claim is made.

## 4. Review, cleanup and limits

Independent source review covered CLI/bootstrap, guards/origin policy, migration, contracts and browser access. No remaining actionable defect was found. Documentation review corrected two README omissions about the expanded database suite and clarified that the statement guard serializes every User update, not just role updates. The browser read-only restore path keeps controls mounted/enabled to avoid first-click loss on focus restoration; cookie mutations still replace the protected panel.

Browser tabs were closed. A later turn ended the terminal fixture processes before their normal stdin shutdown, so cleanup verified the recorded fixture PID had exited, validated its exact random database name and dropped only that disposable database. It removed the stale fixture state file. Final read-only probes confirmed zero main users/sessions/administrators, one guard row, four completed migrations, no T05–T08 disposable databases and closed loopback ports 3108/5173. A scan of 195 maintained files/built assets found no actual local database password/URL; values were not printed. All 345 local file/heading links across 34 Markdown files passed, as did whitespace validation and the unchanged-lockfile check.

This completes global administrator access and M1, while B05 game-object permissions remain T17. All accounts are currently active; T11 must extend the last-admin invariant for suspension. There is no general role-management UI/API, owner-account appointment, full browser/device matrix, remote CI success or deployment claim. The database-owner ability to alter schema/disable triggers/TRUNCATE remains outside ordinary application writes. At implementation completion, T08 was local and no commit/push had been requested. The subsequent authorized review follows below.

## 5. Owner-requested review and publication

The owner explicitly requested review, fixes and commit/push. [Review 0009](../reviews/0009-t08-code-review.md) found no actionable defect after independent server, persistence and browser-source reviews. No new source, schema, migration or dependency change was required. Focused independent suites passed 9/9 access, 8/8 bootstrap and 34/34 web tests.

Fresh root `pnpm check` passed lint, types, generation/builds and all 92 database-free tests, and `pnpm test:database` passed all 44 reported cases again. Logs are ignored `.local/t08-verification/review-check.log` and `review-database.log`. These are new review runs; the earlier browser checks above were not repeated. Review documentation records the conservative local deadline limit for future pages that perform regular authenticated activity.

Final review checks passed all 362 local file/heading links across 35 Markdown files, whitespace validation and the unchanged-lockfile check. A scan of 196 maintained files/built assets found no actual local database password/URL. Read-only probes again confirmed zero main users/sessions/administrators, one guard row, four completed migrations and zero T05–T08 disposable databases. Test ports 3108/5173 were closed. No real account was selected or promoted during review.

Fetched `origin/master` matched the reviewed T07 base. The authorized publication excludes all private settings, generated output, installed dependencies, fixture data, screenshots and logs. The exact pushed commit is checked against remote and reported to the owner; remote CI success and deployment remain separately unverified.
