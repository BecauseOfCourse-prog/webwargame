# T03 Verification: Repeatable Checks and Minimal CI

Date: 2026-10-22

Scope: [Specification 0006](../specs/0006-t03-repeatable-checks.md), task T03 / B02. These are checks performed on the resulting local changes, not a remote CI run. The full T04 onboarding/shutdown demonstration is not claimed.

Review update (2026-10-23): [Review 0004](../reviews/0004-t03-code-review.md) subsequently reproduced a frozen-install failure under the old CI-selected Node 22.22.0. The correction and selected-runtime proof in section 6 close that P1 finding. Earlier successful installation used pnpm's separate bundled runtime and did not establish reference-runtime compatibility; those dated checks remain actual historical evidence.

## 1. Resulting source

- [Root scripts and exact tool versions](../../package.json), [lockfile](../../pnpm-lock.yaml).
- [ESLint flat configuration](../../eslint.config.mjs).
- [CI workflow](../../.github/workflows/ci.yml).
- [Environment-file error redaction](../../apps/api/src/config/load-environment.ts): one documented lint suppression preserves the existing safe error message without retaining a raw cause.
- [Check instructions](../../README.md#build-and-inspect).

## 2. Checks performed

| Check | Actual result |
| --- | --- |
| Tool compatibility | npm registry metadata and installed package engines/peers inspected. ESLint 10.13.0, typescript-eslint 8.72.0 and React Hooks plugin 7.1.1 support the selected TypeScript/ESLint/Node requirements. Shell reference Node is 22.22.0; pnpm is 11.25.0. No runtime compatibility matrix is claimed. |
| Frozen root installation | `pnpm install --frozen-lockfile --offline` passed with the updated lockfile and cached dependencies. |
| Root application checks | `pnpm check` passed: lint, workspace type check, build and all ten existing configuration/startup/local-target tests. No tests were skipped. |
| Separate credential-free source installation | Copied maintained source/configuration to ignored `.local/t03-verification/source`, excluding `.env`, generated output and installed dependencies; ran a separate `pnpm install --frozen-lockfile --offline`. All 461 dependency packages were installed from the cache into that copy. No dependency junctions to the main checkout remained during the checks; pnpm's normal internal dependency links stayed within the copy. |
| Intentional type error | Added only a temporary `packages/game-engine/src/t03-type-error-probe.ts` in that isolated copy containing `export const t03TypeProbe: number = 'intentional type mismatch';`. Root `pnpm typecheck` exited 1 with TS2322 (`string` is not assignable to `number`). This happened during its shared-package build stage; it was a compiler failure, not a missing-tool failure. |
| Restored valid tree without credentials | Removed the temporary probe in `finally`, removed database/API variables from the verification process and confirmed the isolated copy had no `.env`. Root `pnpm check` then passed with all ten tests and regenerated Prisma client/build output. The main checkout never contained the intentional source error. |
| CI inspection | Independent review confirmed triggers, read-only repository permission, stale-run cancellation, timeout, pinned action inputs, committed runtime/package-manager versions, frozen install, local-equivalent check command, isolated PostgreSQL, migration reapplication/status and integration-test ordering. No production secret access or deployment is configured. |
| Lint coverage and independent review | All 21 maintained JS/TS source/configuration/test/script files were covered at review time. Generated/dependency/build/scratch files are excluded. No actionable code/configuration finding remained. |
| Documentation/whitespace | All 136 relative Markdown file links across 19 documents resolved; `git diff --check` passed after the final documentation update. |

The source-copy negative/positive check logs are retained as ignored local scratch artifacts under `.local/t03-verification/`; the committed evidence is this report. Dependency junction reuse was rejected by pnpm's safety check during preparation; they were removed and replaced with a separate frozen installation before the actual type-error exercise. This is a source-copy check with a cached install, not the T04 clean-checkout onboarding demonstration.

## 3. CI references inspected

The workflow pins full commit SHAs from official releases, with readable version comments:

- [actions/checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1).
- [actions/setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0).
- [pnpm/action-setup v6.1.0](https://github.com/pnpm/action-setup/releases/tag/v6.1.0).

Inputs were checked against each exact revision's `action.yml`, including pnpm's `cache` support and its default `packageManager` lookup. PostgreSQL uses the documented [runner-to-service localhost connection](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers). Node tests consume API `dist`, so `pnpm check` builds before running them. Migration/database steps follow the build and run against the job's temporary database. The service is discarded after the job; the local persistence verifier is intentionally separate.

## 4. Limits and unavailable checks

- At the initial local-verification checkpoint, no remote GitHub Actions run had occurred and no commit/push had been requested or performed. Later owner-authorized publication is recorded in section 8. No CI badge or successful-run claim is added without verified remote evidence.
- During the initial T03 pass, Docker's Linux engine was unavailable. Starting Docker Desktop failed in its own Inference manager while opening/removing the local `dockerInference` socket, and `docker info` could not find `dockerDesktopLinuxEngine`. Database checks were not run in that initial pass. The owner's same-day retry restored the runtime and passed the checks recorded in section 5 below; the initial failure is retained as history.
- CI configuration was manually inspected and independently reviewed; no action runner was emulated locally. An attempted optional YAML parser check lacked a local YAML library and did not constitute a validation pass.
- There are no new gameplay, authorization, browser, accessibility, production or backup guarantees. B02/M0 still require T04; its Windows Ctrl+C/restart gap remains open.

## 5. PostgreSQL retry and runtime recovery — 2026-10-22

The owner requested another PostgreSQL verification and supplied the Docker error. A normal retry reproduced the Inference manager failure before engine startup. The existing `dockerInference` entry was zero bytes with `Archive, ReparsePoint` attributes; the containing `Docker\run` directory was an ordinary directory and contained only that endpoint and `userAnalyticsOtlpHttp.sock`. These observations do not establish NTFS corruption or a specific Windows/Docker root cause.

After `docker desktop stop --force --timeout 25` exited 0, verified that no Desktop/backend processes remained. Preserved only the checked runtime directory by renaming it to `C:\Users\User\AppData\Local\Docker\run.before-t03-20261022T204402Z` and created a fresh empty `run`. Started the installed Docker Desktop through the normal Windows shell (`explorer.exe`). The Linux engine then responded with version 28.5.1. No socket was deleted; no settings, model-runner setting, image, volume or VM-data directory was changed. The saved runtime directory remains available; it is not a database backup.

The directory workaround is described by users in [Docker's issue tracker, issue 554](https://github.com/docker/desktop-feedback/issues/554). A separate [Codex user report, issue 52698](https://github.com/openai/codex/issues/52698) describes an inherited AppData-context interaction and normal-shell launch. These reports informed the recovery; neither report proves the underlying cause on this machine, and the two recovery steps were not tested independently. This is an observed recovery, not a claim of a permanent Docker fix.

| Retry check | Actual result |
| --- | --- |
| Current compiled server | `pnpm build:packages` and `pnpm --filter @webwargame/api build` passed before the database checks. |
| Local-target guard | Loaded private configuration without printing credentials and checked it with `assertLocalDatabaseTarget`; it matched this repository's canonical loopback Compose target. |
| PostgreSQL startup | `pnpm db:up` passed; existing service `webwargame-local-postgres-1` became healthy using its retained volume and `postgres:18.6-bookworm`. |
| Isolated clean migration | Created only a random `t03_verify_*` database on that local server. `pnpm db:migrate` applied `20261022000100_initial_baseline` successfully. |
| Idempotent reapplication | Second `pnpm db:migrate` reported no pending migrations. A Prisma query confirmed exactly one completed, non-rolled-back migration, matching the one committed migration directory. |
| Temporary migration status | `pnpm db:status` reported the schema up to date. |
| Real silent-network test | `pnpm test:database` passed: 1 test, 0 failures/skips, test duration about 6.07 seconds. Its real API reached readiness through the TCP proxy, returned 503 after forwarding stopped within the asserted deadline, and still returned 200 from liveness. |
| Cleanup | Disconnected the verification Prisma client and dropped only the exact random database created by this retry. The test cleaned up its temporary API and proxy. The project database and named volume were retained. |
| Final project state | `docker compose ps` showed PostgreSQL running/healthy; `pnpm db:status` against the normal project database reported up to date. |
| Follow-up documentation | All 137 relative Markdown file links and 3 heading links across 19 documents resolved; `git diff --check` passed after updating the specification, context and backlog. |

The one-off orchestration script and redacted output are retained under ignored `.local/t03-verification/postgres-retry.mjs` and `postgres-retry.log`. It passes the temporary `DATABASE_URL` to the same pnpm migration/test commands configured in CI, uses no shell interpolation for SQL command execution, and restricts cleanup to its generated `t03_verify_*` database. No committed application code, schema or migration changed during this retry. Container-replacement persistence was not rerun; its earlier T02 evidence remains historical. Remote GitHub Actions execution is still unverified.

## 6. Runtime review correction — 2026-10-23

Raised [the reference version](../../.node-version) from 22.22.0 to 22.22.3 and [root `engines.node`](../../package.json) to `^22.22.3 || ^24.15.0`. The workflow already reads the reference file and strict engine validation remains enabled. No dependency graph, schema or application behavior changed.

| Correction check | Actual result |
| --- | --- |
| Portable reference runtime | Downloaded `node-v22.22.3-win-x64.zip` from the [official release](https://nodejs.org/dist/v22.22.3/) into ignored `.local/t03-runtime-fix-20261023`. Archive SHA256 `6c8d54f635feff4df76c2ca80f45332eb2ff57d25226edce36592e51a177ee33` matched [official checksums](https://nodejs.org/dist/v22.22.3/SHASUMS256.txt); extracted executable reported 22.22.3. This checked the archive hash, not a detached signature. The system Node installation was not changed. |
| Strict fresh-install proof | Copied maintained source/configuration into new `.local/t03-runtime-fix-20261023/source-frozen`, without `.env`, installed dependencies or generated/build output. Removed database/API environment variables from the verification process. Its first dependency operation directly invoked pnpm 11.25.0's JavaScript entry through portable Node 22.22.3 with `install --frozen-lockfile --offline`. All 461 cached packages installed successfully with strict engines enabled. |
| Unchanged dependency graph | The source-copy lockfile SHA256 was identical before and after frozen installation and matched both the main checkout and the pre-fix review copy (`7b16a3f6ddc43e52f0dd67e7ef2d45f4a29b07aa823f0c6b7a503a9d6b21bffa`). No dependency update was required for this correction. |
| Actual process runtimes | Portable Node and a local command shim were prepended only to the verification process PATH. `pnpm exec node --version` returned `v22.22.3`; `pnpm exec node -p 'process.env.npm_config_user_agent'` returned `pnpm/11.25.0 npm/? node/v22.22.3 win32 x64`. Both child Node and pnpm's host runtime matched the selected reference. |
| Complete selected-runtime checks | In that installed source copy, `pnpm check` passed lint, all four package type checks, shared/API/browser builds and ten configuration/startup/local-target tests; no failures or skips. Prisma client generation worked without credentials. |
| Engine compatibility audit | Independent inspection checked all 312 Node engine declarations in 658 lockfile package records and cross-checked 287 declarations in 461 installed package manifests. The corrected declared range is a subset of every constraint. Lower boundaries 22.22.3 and 24.15.0 pass metadata checks; this does not claim actual execution of every version or Node 24.15.0. |
| Follow-up review | Independent review found no actionable issue in the minimal fix. CI continues to consume `.node-version`; strict validation and the locked package graph are retained. |
| Final documentation | All 159 relative file links and 11 heading links across 20 Markdown documents resolved; `git diff --check` passed. Current instructions/statuses and historical runtime notes agree with the correction. |

The first preparation copy also passed all checks, but its `pnpm exec` preflight automatically installed dependencies before the explicit frozen command. It was not counted as the strict fresh-frozen proof. The second `source-frozen` copy ran explicit frozen installation first, then verified runtimes and ran checks. Its output is retained in ignored `clean-frozen-install.log` and `clean-check.log` under `.local/t03-runtime-fix-20261023`.

The local Docker engine was unavailable during this correction (`dockerDesktopLinuxEngine` pipe missing), so PostgreSQL commands were not rerun. The separate successful 2026-10-22 database checks in section 5 remain historical. No remote CI job, Linux execution, full runtime matrix, system Node update or Docker recovery is claimed by this correction. The P1 finding is closed; T03 is Done and T04 is Ready. B02/M0 still require T04.

## 7. Final pre-publication PostgreSQL check — 2026-10-23

After the owner started Docker Desktop and explicitly authorized commit/push, `docker info` returned engine 28.5.1 and this project's retained PostgreSQL service was healthy. Repeated the root `pnpm check` in the main checkout with portable Node 22.22.3 and its matching pnpm command shim: lint, types, all builds and all ten tests passed without skips.

Using that same actual Node runtime, the local-target-guarded helper created a fresh random `t03_verify_*` database, ran committed migrations twice and migration status, and queried migration history through Prisma. The baseline applied once, the second deployment was a no-op and status was up to date. `pnpm test:database` passed one test with no failures/skips (test duration about 6.05 seconds): readiness returned 503 under silent network failure while liveness remained 200. Cleanup disconnected Prisma and removed only this run's temporary database. Final `pnpm db:status` for the normal project database was up to date. No container/volume replacement or data reset was performed.

The redacted database output is retained in ignored `.local/t03-runtime-fix-20261023/precommit-postgres.log`. This is a new check under the corrected selected runtime; it supplements the earlier unavailable-Docker and successful-retry records without rewriting their outcomes. Repository scope/secret checks found only the intended 15 T03 source/configuration/documentation files; `.env`, `.local`, generated Prisma output and logs are excluded. Remote publication/CI had not yet occurred at this pre-commit checkpoint.

## 8. Owner-authorized publication — 2026-10-23

Committed the 15 reviewed T03 source/configuration/documentation files as [f4782e3 — Implement T03 checks and CI with verified Node runtime](https://github.com/BecauseOfCourse-prog/webwargame/commit/f4782e3e888c04f9c789ad23d1ed483884cf33fd). A normal `git push origin master` succeeded, advancing the remote from `8914458` to that revision. No force push, branch rewrite, secret file, local runtime, test log or generated client was included. Immediately afterward the working tree was clean and `master` matched `origin/master`.

Attempted to read GitHub Actions runs for the exact pushed SHA through the unauthenticated GitHub API. The endpoint returned HTTP 404 without additional account access. This does not establish whether a workflow started, passed or failed; remote CI status remains unverified. The linked [repository Actions page](https://github.com/BecauseOfCourse-prog/webwargame/actions) is the account-authenticated entry point. Local validation is recorded separately above. This publication note is a documentation-only follow-up to the implementation commit.
