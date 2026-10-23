# Specification 0006: T03 Repeatable Checks and Minimal CI

Date: 2026-10-22

Updated: 2026-10-23

Status: Implemented, locally verified and published, including the P1 runtime correction. Remote CI status is unverified. Parent: B02. Task: T03.

## 1. Problem and intended outcome

T01/T02 have build/type commands and meaningful Node-runner tests, but no lint command or repository CI workflow. Provide one repeatable root check sequence shared by local development and GitHub Actions. Checks must not require production credentials. Demonstrate that an intentional type error fails the root type check and that the valid tree passes after restoration.

## 2. Scope and interfaces

- Keep the existing workspace build and TypeScript checks, including Prisma client generation without a database connection.
- Add root ESLint configuration for maintained JavaScript/TypeScript, browser React code, server code, tests and scripts. Exclude dependencies, compiled output, generated Prisma client, coverage and local scratch files.
- Add root `lint`, `test` and `check` commands. `check` runs lint, type checking, build and the existing configuration/startup/local-target tests in order. The separate real-database suite remains explicit.
- Add one GitHub Actions job for pushes, pull requests and manual runs. Use the committed Node reference, pnpm version and frozen lockfile; run `check`, committed migrations twice, migration status and the real PostgreSQL silent-network test.
- Update setup/check documentation, task evidence and the current context. Application API, UI, schema and retained local storage are unchanged.

## 3. Decisions and tradeoffs

ESLint with typescript-eslint provides a single maintained lint configuration across the workspace. Use recommended JavaScript/TypeScript correctness rules plus the two fundamental React Hooks rules (`rules-of-hooks`, `exhaustive-deps`). Keep formatting and React Compiler adoption outside this increment. TypeScript's compiler remains responsible for type compatibility; type-aware lint rules can be introduced when an actual feature needs them. This adds development dependencies and a lockfile update, with no runtime service or subscription.

Retain Node's built-in test runner and the existing ten configuration/startup/local-target tests plus one database-network integration test. They exercise real behavior, so introducing another runner or tests for the empty game engine would add maintenance without useful coverage. Extend test commands with feature tests as features arrive.

One Linux CI job and an ephemeral PostgreSQL service fit the current foundation. Disposable credentials are declared in the workflow, never taken from production secrets or the owner's `.env`. CI applies migrations to its own database and does not run the local container-replacement verifier. A multi-platform/runtime matrix, browser automation, deployment and off-host backups remain separate work. Review available GitHub Actions minutes before enabling chargeable usage; no paid plan, runner or spending increase is selected by this change.

Official references: [ESLint flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files), [typescript-eslint setup](https://typescript-eslint.io/getting-started/), [supported dependency versions](https://typescript-eslint.io/users/dependency-versions/), [React Hooks lint rules](https://react.dev/reference/eslint-plugin-react-hooks).

## 4. Configuration and compatibility

New tools are exact-version root development dependencies: ESLint 10.13.0, `@eslint/js` 10.0.1, typescript-eslint 8.72.0, globals 17.13.0 and eslint-plugin-react-hooks 7.1.1. Registry peer requirements were inspected before installation; the TypeScript 5.9.3 and ESLint 10 versions are supported by the selected plugins. The review correction raises the Node reference to 22.22.3 and supported ranges to `^22.22.3 || ^24.15.0`; pnpm stays at 11.25.0.

No new environment variable, domain table, migration, production setting or mandatory paid service is introduced. The database-dependent commands require only a disposable/local PostgreSQL URL. The ordinary `check` command does not require PostgreSQL to be running.

One inline `preserve-caught-error` suppression in the environment-file loader retains its existing redacted startup diagnostic. Attaching the raw file-read error as a cause would defeat that deliberate diagnostic boundary. No application runtime behavior changes.

The workflow uses Ubuntu 24.04 and PostgreSQL 18.6 bookworm, `contents: read`, a 15-minute timeout and cancellation of obsolete runs. Official checkout 7.0.1, setup-node 7.1.0 and pnpm/action-setup 6.1.0 releases are pinned to full commit SHAs. There is one runtime/OS job; this is not a compatibility matrix.

## 5. Acceptance and verification

- Frozen installation, root lint/type/build and existing tests pass locally.
- An isolated intentional type mismatch fails `pnpm typecheck` with a nonzero exit; after restoring valid source it passes.
- Inspect CI triggers, minimal permissions, pinned tool versions, disposable database, migration ordering and absence of production secrets.
- Run real-database checks locally where available. Record remote CI evidence only if the workflow actually runs remotely; local execution is not a GitHub Actions run.
- Verify documentation links and `git diff --check` before completing T03.

Frozen installation and root `pnpm check` passed in the main checkout. A separate source copy with its own cached frozen installation, no `.env` and no database variables rejected the temporary intentional type mismatch with TS2322/exit 1. Removing that file restored a passing `pnpm check` with all ten existing tests. Independent source/configuration review found no actionable issue. Documentation links and whitespace were checked. See [the T03 report](../verification/t03-repeatable-checks.md) for the procedure and limits.

At the initial local-verification checkpoint, no commit/push or remote CI verification had occurred. Later publication is recorded in section 9. Docker Desktop's Inference manager/socket error blocked the initial database check. During the owner's same-day retry, stopped the failed runtime, preserved its socket-only `Docker\run` directory under a unique backup name, created an empty runtime directory and launched Desktop through the normal Windows shell. The engine then responded. This reversible runtime recovery changed no application setting, image, volume or database file; it does not establish the underlying failure's root cause or a permanent Docker fix.

The retry rebuilt the server, validated the canonical local target and started the retained PostgreSQL service. In a newly created random `t03_verify_*` database, committed migrations applied successfully, reapplication was a no-op, migration status was current and a Prisma query confirmed each committed migration applied once. The real silent-network test passed (one test, no failures/skips). Cleanup removed only that disposable database; the normal project database remained up to date and PostgreSQL was healthy. See the [follow-up evidence](../verification/t03-repeatable-checks.md#5-postgresql-retry-and-runtime-recovery--2026-10-22). Container-replacement persistence and the remote CI run were not repeated in this retry.

## 6. Limitations

Static checks cannot establish gameplay correctness, authentication, browser accessibility or production readiness. There are no such features or browser tests in this increment. T04 still owns the full clean-checkout onboarding demonstration and the owner's Windows Ctrl+C/restart check. B02/M0 remain incomplete until T04 is complete.

## 7. Code review — 2026-10-23

[Review 0004](../reviews/0004-t03-code-review.md) found a confirmed P1 issue: CI selects Node 22.22.0, but a locked Nest CLI dependency requires `^22.22.3 || ^24.15.0 || >=26.0.0`. With `engineStrict: true`, fresh frozen installation under actual Node 22.22.0 fails with `ERR_PNPM_UNSUPPORTED_ENGINE`, before any check/test step. Exact pinned action-source inspection confirms subsequent pnpm commands use that selected Node. The local pnpm wrapper uses a separate bundled runtime (24.22.1 at review time), so earlier local frozen-install success did not validate the CI-selected runtime.

The review reproduced this failure in an isolated manifest copy and reran a passing normal `pnpm check` with all ten tests. Lint coverage/negative probes and the authored error suppression showed no additional actionable defect. At review time no implementation correction was made and T03 was reopened pending runtime alignment and fresh-install verification. Section 8 records the subsequent correction; earlier evidence remains historical rather than being relabeled as a CI pass.

## 8. Runtime correction — 2026-10-23

Retain the existing Node 22 reference line and raise its patch version to 22.22.3, the minimum accepted by the locked Nest CLI development dependencies. Narrow `engines.node` to `^22.22.3 || ^24.15.0`. Keep strict engine validation and the dependency graph unchanged. The workflow already reads `.node-version`, so no separate hard-coded CI version is needed.

Changing to a Node 24 reference or changing dependency versions would affect more of the established setup without being necessary to resolve this mismatch. This patch does not introduce a new package, runtime installer, service or recurring cost. Future dependency changes must recheck their engine requirements; a compatible declared range is not evidence of a complete runtime/OS test matrix.

Verification used the [official Node 22.22.3 distribution](https://nodejs.org/dist/v22.22.3/) inside ignored `.local`, checking the Windows x64 archive SHA256 against the release checksums. Created a source-only workspace copy with no `.env` or installed/generated files. The first dependency operation directly invoked pnpm's JavaScript entry through portable Node 22.22.3 with `install --frozen-lockfile --offline`; all 461 packages installed and the lockfile SHA256 remained unchanged. Both the child Node version and pnpm's own `npm_config_user_agent` runtime were verified as 22.22.3 before a passing complete `pnpm check` (lint, types, builds and all ten tests).

Independent review checked all 312 declared Node engine constraints in 658 locked package records; the corrected supported range is a subset of every constraint. The 287 Node requirements in 461 installed manifests also matched. This is an engine-metadata audit, not execution on every OS/runtime. The P1 finding is closed and T03 is Done again. No dependency upgrade or lockfile graph change was necessary. Docker was unavailable during the initial correction check, but after the owner restarted it and authorized commit/push, final checks under actual Node 22.22.3 passed the root suite plus clean/idempotent migrations, status and one real network-failure test in a disposable local database. Cleanup removed only that database; the normal project schema remained current. Earlier checks remain separately dated. Remote CI had not run at the pre-commit checkpoint. See [verification details](../verification/t03-repeatable-checks.md#6-runtime-review-correction--2026-10-23), [final PostgreSQL evidence](../verification/t03-repeatable-checks.md#7-final-pre-publication-postgresql-check--2026-10-23) and the [review follow-up](../reviews/0004-t03-code-review.md#4-correction-and-verification--2026-10-23).

## 9. Publication — 2026-10-23

The owner explicitly authorized commit/push. [Implementation commit f4782e3](https://github.com/BecauseOfCourse-prog/webwargame/commit/f4782e3e888c04f9c789ad23d1ed483884cf33fd) was pushed normally to `origin/master` after final selected-runtime/PostgreSQL checks. A read-only GitHub Actions query for that exact SHA returned HTTP 404 without additional account access, so no remote workflow outcome is claimed. The documentation-only publication record and limitations are in [the evidence report](../verification/t03-repeatable-checks.md#8-owner-authorized-publication--2026-10-23). Application behavior/configuration is unchanged by this follow-up note.
