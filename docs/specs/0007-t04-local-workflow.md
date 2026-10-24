# Specification 0007: T04 Local Workflow and Windows Lifecycle

Date: 2026-10-23

Completed: 2026-10-24. Runtime verification: 2026-10-23; documentation completion: 2026-10-24.

Status: Done. Parent: B02 / M0. Task: T04.

## 1. Problem and intended outcome

T01–T03 provide application/database foundations and repeatable checks. T04 turns the existing commands into a complete verified local workflow: prerequisite checks, clean installation, private settings, database/migrations, browser-to-API demonstration, stop/restart, build inspection and concrete troubleshooting. Historical automated-terminal shutdown left development children running; normal Windows Ctrl+C and clean restart required verification at the start of this increment.

## 2. Scope

- Complete README onboarding and troubleshooting without global Nest/Prisma tools or paid accounts.
- Verify from a fresh local Git clone with no dependencies, credentials or generated/build output. Frozen installation must be the first dependency operation.
- Use the selected Node 22.22.3 for both pnpm and child commands; distinguish the reference file from an installed runtime.
- Demonstrate environment initialization, local PostgreSQL startup, committed migrations, development health/readiness and the real browser shell.
- Verify Ctrl+C, disappearance of all project development children/listeners and a clean restart in a normal Windows terminal. If reproduced, correct process orchestration within this increment and document the decision before implementation.
- Verify database stop/start retains data and finish relevant build/checks. Record actual commands/outcomes and update current context/backlog before completion.

Application APIs, schema, approved UI and gameplay scope remain unchanged unless a local-workflow defect requires a focused correction. Authentication/game rules and production deployment are excluded.

## 3. Verification isolation and decisions

Use a fresh local clone under ignored `.local/` and a distinct Compose project name/loopback database port. This prevents replacing the owner's current database credentials or stopping its existing service. `COMPOSE_PROJECT_NAME` takes precedence over the top-level Compose name; project-scoped volumes remain separate. Private test settings are generated in the clone and never committed or printed. Keep its test volume on ordinary shutdown, matching the normal workflow.

An isolated project is slightly more setup than temporarily stopping the main database, but avoids unnecessary interruption and tests a truly empty database. It introduces no paid service, dependency or permanent system-runtime change. Default application ports can be used when free; inspect conflicts rather than killing unrelated processes.

Use a normal interactive Windows terminal where available for Ctrl+C, recording its actual surface and child/port evidence. Automated PTY termination alone is insufficient to relabel the historical owner's-terminal gap as closed. Any tool/access limitation must be stated explicitly rather than fabricated as a successful check.

The existing optional `db:verify` script fixes its Compose project to `webwargame-local`. Keep it restricted to the default project in the instructions; running it from the isolated checkout could affect the owner's container. Ordinary isolated migration/status commands use the configured connection and Compose project. Generalizing that intrusive verifier is outside this documentation walkthrough; use ordinary stop/start and retained migration-state checks here.

## 4. Changed components and operational behavior

README now separates prerequisites/runtime selection, first setup, daily start/stop, updates/migrations, checks, built preview and troubleshooting. It explains the browser-to-API proxy and database readiness, retained credentials/volumes, process environment precedence and optional second-checkout isolation. `.env.example` adds a commented Compose project-name example without usable credentials. No application code, script, runtime/dependency version, API, schema or approved UI changes are introduced.

Existing orchestration is retained. One automated PTY shutdown and two owner-operated normal Windows terminal cycles exited the complete captured trees; three bounded operational startup failures also exited naturally without leaks. Adding another supervisor would introduce maintenance without an observed benefit for this local workflow. README distinguishes early requests before API compilation finishes and the separate development/preview ports, addressing the actual walkthrough confusion.

## 5. Acceptance and evidence

The documented sequence must lead from a clean checkout to the browser's successful proxied API request, with migrations applied and readiness confirmed. Windows Ctrl+C must stop the project development process tree and permit restart on the same ports. Database stop/start must retain the test state, and checks/build must pass without production credentials.

Clean cached frozen installation, idempotent environment initialization/migrations, database status, real browser health/retry, direct readiness, the full root check/ten tests and bounded occupied-port/incorrect-password cases passed under Node 22.22.3. Two owner-operated terminal cycles reached readiness and left zero captured children/listeners after Ctrl+C; the owner confirmed the working development page after the stopped preview tab was corrected. Compiled preview and isolated database stop/start also passed: migration identity/checksum/timestamp were retained, readiness recovered without restarting the API and the main database was unchanged. See [verification evidence](../verification/t04-local-workflow.md) for methods, actual results and limits.

T04 closes the named lifecycle gap and completes the local B02/M0 foundation acceptance. Final documentation review, local links and whitespace checks complete this increment; runtime checks are dated separately. Current GitHub CI status remains a separate unverified item; T04 does not claim a remote run. No production or gameplay scope is added. The owner authorized committing and pushing this increment on 2026-10-24.

## 6. Code and documentation review

[Review 0005](../reviews/0005-t04-code-documentation-review.md), dated 2026-10-24, independently inspected the changed instructions and directly related code, process/database evidence and acceptance status. No actionable defect was confirmed. It also checked the installed pnpm parallel-error cleanup path without claiming a new runtime execution. T04/B02/M0 remain Done. This review adds reporting/navigation only; runtime outcomes remain dated 2026-10-23 and remote CI remains unverified.
