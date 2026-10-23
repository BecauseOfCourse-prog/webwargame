# Review 0004: T03 Repeatable Checks and CI

Date: 2026-10-23

Scope: Uncommitted T03 changes against `8914458`, including untracked `eslint.config.mjs`, `.github/workflows/ci.yml`, the incremental specification and evidence. Reviewed root scripts/dependencies/lockfile, lint configuration, the environment-loader lint suppression, CI and documentation. Application implementation from T01/T02 was read for context; this is not a new full application or dependency-security audit.

Current status: the original P1 finding below was corrected and verified later on 2026-10-23; see section 4. No unresolved finding remains in this review scope.

## 1. Original confirmed finding

**P1 — The CI-selected Node version cannot install the locked dependencies.**

Location: [.github/workflows/ci.yml](../../.github/workflows/ci.yml), line 50 (`node-version-file: .node-version`), before frozen installation at line 60.

The new workflow selects Node 22.22.0 from [.node-version](../../.node-version). [pnpm workspace settings](../../pnpm-workspace.yaml) enable `engineStrict`. The committed lockfile contains `@angular-devkit/core@22.2.3` (a Nest CLI dependency), whose required Node range is `^22.22.3 || ^24.15.0 || >=26.0.0`. Node 22.22.0 does not satisfy that range. A fresh CI installation therefore exits with `ERR_PNPM_UNSUPPORTED_ENGINE` before lint, types, build, migrations or tests execute.

This is a new CI failure even though the incompatible reference/runtime declaration predates T03: the newly added workflow explicitly selects that version for installation. Earlier successful local installations used the local pnpm wrapper's bundled Node 24 runtime, masking the difference between the shell's `node --version` and the runtime actually hosting pnpm.

The exact pinned [pnpm action installer source](https://github.com/pnpm/action-setup/blob/ea17c68df8912ef543352723c149a84f56e3d413/src/install-pnpm/run.ts) selects ordinary pnpm for system Node 22.13 or newer unless `standalone` is requested and preserves the preceding setup-node executable's PATH precedence. Its [bootstrap lockfile](https://github.com/pnpm/action-setup/blob/ea17c68df8912ef543352723c149a84f56e3d413/src/install-pnpm/bootstrap/pnpm-lock.json) already pins pnpm 11.25.0, matching this repository; it returns without self-updating to a different runtime. Thus the action's own Node runtime does not rescue the subsequent install command.

Required correction: align the reference Node version, declared supported versions and current instructions with the locked dependency requirements; then perform a fresh frozen installation under the selected actual Node runtime and run the checks. Do not work around this by disabling engine validation. No implementation correction was made during the initial review; the later closure is recorded in section 4.

## 2. Reproduction and verification

| Check | Actual result |
| --- | --- |
| Runtime comparison | Shell `node --version` and `pnpm exec node --version` both report 22.22.0. The pnpm command wrapper explicitly starts its JavaScript CLI with the bundled dependency runtime, which reports 24.22.1. The child `node` version alone does not identify pnpm's own runtime. |
| Isolated frozen-install probe | Copied the current root/workspace manifests, lockfile, workspace settings and `.node-version` into ignored `.local/t03-code-review-20261023/engine-probe`, with no installed dependencies. Invoked pnpm 11.25.0's JavaScript entry directly through the shell's actual Node 22.22.0, with `install --frozen-lockfile --offline --ignore-scripts`. It exited 1 with `ERR_PNPM_UNSUPPORTED_ENGINE` for `@angular-devkit/core@22.2.3`, expected `^22.22.3 || ^24.15.0 || >=26.0.0`, got 22.22.0. Offline mode and disabled lifecycle scripts do not relax engine validation. |
| Normal local check sequence | `pnpm check` passed: lint, all four package type checks, shared/API/web builds and all ten configuration/startup/local-target tests; no skips. This does not negate the fresh-install failure under the CI-selected runtime. |
| Lint coverage | ESLint API inspection enumerated all 21 maintained JS/MJS/TS/TSX files, including API tests, Prisma configuration, DB scripts, browser source/configuration, shared source and environment initializer. Generated Prisma and local scratch content are ignored. |
| Lint negative probes | In-memory samples triggered the expected undefined-global, unused-TypeScript-binding, conditional-Hook and missing-Hook-dependency diagnostics. No committed source was intentionally broken. |
| Exact action inspection | All three action commit references and supplied inputs were checked against the pinned official sources. No separate unsupported-input/reference defect was found. |
| Documentation | All 152 relative file links and 4 heading links across 20 Markdown documents resolved; final `git diff --check` passed. |

The root `check` ordering and standalone test/build requirement match the documentation. The one `preserve-caught-error` suppression retains the previously redacted environment-file error boundary and introduces no runtime behavior change. No additional actionable lint/source finding was confirmed.

## 3. Limits and resulting status

No remote CI job was run, and PostgreSQL tests were not rerun in this review. The successful 2026-10-22 database checks remain historical [T03 follow-up evidence](../verification/t03-repeatable-checks.md#5-postgresql-retry-and-runtime-recovery--2026-10-22). The CI failure is based on the direct runtime-specific installation reproduction and exact action-source inspection, not an invented remote-run result.

The initial review reopened T03 for the confirmed P1 correction and returned T04 to Planned until the prerequisite was closed. The existing [T03 change specification](../specs/0006-t03-repeatable-checks.md) and [current context](../specs/0002-project-context.md) record this review within the same coherent increment. The initial review did not change application code, runtime declarations, workflow or dependencies. No commit, push, deployment or Docker mutation was performed.

## 4. Correction and verification — 2026-10-23

**P1 closed.** Raised `.node-version` to 22.22.3 and `engines.node` to `^22.22.3 || ^24.15.0`, retaining strict engine checks. The workflow already reads the version file, so it now selects the compatible runtime without a duplicated version literal. No dependency graph or application behavior changed.

An official portable Windows x64 Node 22.22.3 archive was downloaded and its SHA256 matched the official release checksum. In a new credential-free source copy with no installed dependencies, the first dependency operation invoked pnpm 11.25.0 directly through that runtime: `install --frozen-lockfile --offline` passed with 461 packages and left the lockfile hash unchanged. PATH/shims kept nested commands on the selected runtime; `node --version` and pnpm's `npm_config_user_agent` both confirmed 22.22.3. Full `pnpm check` then passed lint, all package types/builds and all ten tests without skips.

An initial verification copy passed checks too, but its `pnpm exec` runtime preflight triggered auto-installation before the explicit frozen command. That preparation was not counted as the strict clean-frozen proof; the second `source-frozen` copy described above installed first, then verified runtimes and ran checks.

Independent follow-up inspection found no actionable issue in the minimal correction. All 312 Node constraints in the lockfile (658 package records) and 287 Node constraints in installed manifests (461 packages) accept the corrected declared range. This metadata check does not establish a complete execution matrix; Node 24.15.0 was not separately executed.

README, current context, T03 specification and backlog were aligned. T03 is Done; T04 is Ready; B02/M0 remain incomplete. Docker was unavailable during the initial fix verification. After the owner restarted it, a separate final pre-publication pass under Node 22.22.3 succeeded for the complete root checks, clean/idempotent database migrations, status and one real network-failure test; only the random test database was removed. These checks are dated separately in the [T03 evidence](../verification/t03-repeatable-checks.md). No remote CI run is claimed at this checkpoint. Full details and retained local log locations are in that evidence report.
