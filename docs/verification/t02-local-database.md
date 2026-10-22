# T02 Verification: Persistent Local Database and Configuration

Date: 2026-10-22

Result: Passed. T02 is complete. T03 and T04 still block completion of B02/M0.

Follow-up: [Combined code review](../reviews/0003-t01-t02-code-review.md) fixed the local-verifier query-override bypass and added a driver query timeout. Its checks passed with ten configuration/startup/local-target tests, one silent-network integration test, type/build checks, frozen installation and the stricter persistence verifier. The seven-test results in the original table below describe the initial T02 verification.

## Delivered artifacts

- [Local Compose database](../../compose.yaml) with an explicitly versioned PostgreSQL image and retained data volume.
- [Blank-secret environment template](../../.env.example) and [non-overwriting local initializer](../../scripts/init-local-env.mjs).
- [Prisma configuration](../../apps/api/prisma.config.ts), [schema](../../apps/api/prisma/schema.prisma) and [baseline migration](../../apps/api/prisma/migrations/20261022000100_initial_baseline/migration.sql).
- [Configuration loader](../../apps/api/src/config/load-environment.ts), [validation](../../apps/api/src/config/environment.ts) and [database lifecycle service](../../apps/api/src/database/prisma.service.ts).
- [Database readiness endpoint](../../apps/api/src/readiness.controller.ts).
- [Configuration tests](../../apps/api/test/environment.test.mjs), [real startup tests](../../apps/api/test/startup.test.mjs) and [local persistence verifier](../../apps/api/scripts/verify-database.mjs).
- [Run/migrate/stop instructions](../../README.md) and [decision explanation](../decisions/0002-local-database.md).

## Observed checks

| Check | Result |
| --- | --- |
| Docker prerequisites | Existing Docker Desktop was installed but stopped. Started its Linux engine; Docker 28.5.1 and Compose 2.40.3 were available. No Docker installation or paid account was needed. |
| Initial database | Official `postgres:18.6-bookworm` image started with a healthy container, loopback port and namespaced persistent volume. |
| Environment initializer | Generated a random local password and matching URL in ignored root `.env`, without printing their values. The committed template has blank password/URL values. |
| pnpm settings | `engineStrict` and `saveExact` were confirmed true after moving them into workspace YAML. Required Prisma install scripts were explicitly approved through pnpm 11 `allowBuilds`; no global script bypass was used. |
| Frozen install | `pnpm install --frozen-lockfile --offline` passed. |
| Client generation | Prisma 7.10.1 generated an ESM client from the schema with no domain models. Generated code is ignored by Git. |
| Type and build checks | `pnpm typecheck` and `pnpm build` passed for all packages. |
| Configuration/startup tests | All seven Node tests passed: defaults, configured port, invalid/missing URLs, invalid ports, redacted errors, missing-URL startup failure, and unreachable-DB startup failure without a leaked password/URL. |
| Clean source-only copy | In a new ignored `.local/t02-clean-*` directory, copied source/manifests/lockfile without `.env`, `node_modules`, `dist` or generated Prisma code. Offline frozen install reused 342 cached packages, client generation/typecheck/build and all seven tests passed. |
| Main database migration | `pnpm db:migrate` applied the baseline; `pnpm db:status` reported up to date. A final table listing contained only `_prisma_migrations`, not invented user/game tables. |
| Clean migration and persistence | `pnpm db:verify` created its own random `t02_verify_*` database, applied committed migrations twice and confirmed each applied exactly once. It wrote a marker through Prisma, recreated the container without deleting the volume, confirmed a different container ID and read the original marker. |
| Disposable-data cleanup | The verifier removed only its generated database in its cleanup path, leaving the project database and named volume intact. The check passed again after the migration-count assertion was made compatible with later migrations. |
| Real backend connection | Replaced the previously agent-started T01 API with the compiled T02 API. `GET /api/ready` returned `status: ready` and `database: ok`. |
| Database outage | Stopped only this Compose project's PostgreSQL. Liveness returned HTTP 200; readiness returned HTTP 503. |
| Recovery | Restarted PostgreSQL with the volume retained; readiness returned HTTP 200 directly and through the port-4173 preview proxy without an API restart. After the final container-replacement check, readiness was healthy again. |
| Secret handling | Git ignore checks covered `.env` and generated client files. Scanned Git-tracked/untracked nonignored candidates and built browser assets for the actual generated password/connection URL without printing them; neither value was present. |

## Scope and remaining work

The baseline creates migration history and ensures the `public` schema exists; it deliberately adds no account/game models. The current UI keeps its T01 visual style and process-availability check. A successful health response alone does not prove database readiness.

Verification used Windows, Node.js 22.22.0 and pnpm 11.25.0 (the installed standalone pnpm also uses its Node 24 runtime). No full browser/OS/runtime compatibility claim is made. Type/build/configuration tests and actual PostgreSQL integration were run; CI/lint remain T03 and the complete local workflow/Windows child-process shutdown check remains T04.

Final local services: PostgreSQL in Docker, compiled API on loopback port 3000 and the previously running preview on port 4173. PostgreSQL has no automatic restart policy; `pnpm db:down` stops it while retaining data. No production deployment, hosting purchase, commit or remote push was performed. Off-host backup/restore remains later work; the volume test is not a backup test.
