# Review 0005: T04 Code and Documentation

Date: 2026-10-24

Scope: Uncommitted T04 changes against `0fe683ec6f31e2eca62979b57c31b36cb2a180a4`: README, `.env.example`, [Specification 0007](../specs/0007-t04-local-workflow.md), [verification evidence](../verification/t04-local-workflow.md), current context and both backlogs. Read the existing application/configuration/tooling code to verify the newly documented workflow. T04 changes documentation and one commented environment example; it does not change application source, schema, dependency graph or runtime versions.

## 1. Findings

No actionable defect was confirmed in the reviewed scope. Two independent read-only reviews and the parent review reached the same result. T04/B02/M0 completion remains supported; no implementation correction is required by this review.

## 2. Code and command consistency

- Root/workspace scripts match the documented installation, environment initialization, database, development, check/build and compiled-preview commands. Standalone configuration tests require compiled output, as stated in README.
- The environment initializer uses exclusive file creation and preserves an existing `.env`. API/Prisma load the root file with existing process variables taking precedence; startup validation and connection-failure handling avoid logging credentials. The API validates database availability before listening and separates liveness from database readiness.
- Vite binds the documented strict loopback ports and uses `API_PORT` for both development and preview proxy targets. The browser checks the health response at runtime, handles a five-second timeout and supports retry; its status does not claim database readiness.
- Compose retains the named PostgreSQL volume on ordinary shutdown. The second-checkout recipe changes both project identity and published database/URL ports, explains stable settings and inherited overrides, and explicitly excludes `db:verify`, whose implementation fixes the default project name. That documented utility limitation is not a newly fixed capability.
- The installed pnpm 11.25.0 source was inspected for the parallel-command error path. Lifecycle children are tracked; scheduler error propagation does not wait indefinitely for other watchers; the top-level error handler cleans tracked Windows process trees. No concrete orphan-process counterexample was found. The package-specific negative tests are not presented as an executed root-command failure test.

## 3. Evidence and acceptance consistency

The ignored local summaries and helper sources were read alongside the durable English report:

| Evidence inspected | Review result |
| --- | --- |
| `manual-observation.json` and manual wrapper/observer | Two owner-operated cycles reached readiness, captured 18/19 processes with PID/creation identities, and recorded zero survivors/listeners after stop. The observer did not automate terminal keystrokes. |
| `operational-negative-summary.json` and bounded-check helper | Occupied frontend/API ports and incorrect database credentials failed usefully without forced cleanup or credential output. |
| `built-preview-ready.json` / `built-preview-stop.json` | Direct/proxied readiness and health succeeded with temporary API port 3014; preview cleanup is correctly distinguished from Ctrl+C verification. |
| `database-stop-start.json` and helper | The isolated container changed while its migration record was retained; readiness changed 200 → 503 → 200 without an API restart, and the main database remained unchanged. |
| Clean-install log and recorded build/browser outcomes | Consistent with cached frozen installation, full root checks/ten tests and the demonstrated browser. Fresh internet installation and a full supported-runtime matrix are not claimed. |

The owner ultimately confirmed the working development page on 5173 after the stopped preview tab on 4173 was corrected. Earlier path-entry, early-request and scratch-harness failures remain accurately separated from application failures and successful counted checks. Runtime checks are dated 2026-10-23; documentation completion/review is dated 2026-10-24.

The specification, current context and both backlogs distinguish implemented foundations from planned account/game/deployment work. Remote CI success is not claimed. No missing acceptance evidence requiring T04 to be reopened was identified.

## 4. Review verification and limits

Read-only source/configuration inspection and verification-artifact inspection were performed. After adding review/navigation links, all 197 local file/heading links across 23 Markdown files passed; `git diff --check` passed. No full runtime/build suite, browser session, database migration, container replacement or owner-terminal check was repeated during this review. The 2026-10-23 outcomes remain historical evidence rather than new executions.

This is a review of T04 and directly related existing code, not a complete dependency-security audit, all-version/platform execution matrix or production-readiness assessment. Review reporting updates the existing T04 specification and context; no application behavior was changed.
