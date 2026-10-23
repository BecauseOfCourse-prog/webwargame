# Implementation Backlog

Updated: 2026-10-23

Status: T01–T03 complete, including the runtime review correction; T04 ready; remaining implementation tasks have not started

Scope and acceptance criteria: [Product backlog](product-backlog.md)

Architecture: [Specification 0001](specs/0001-project-specification.md)

Working agreements: [Development guidelines](../AGENTS.md)

## How to use this backlog

B01–B23 identify parent features. T01–T40 identify implementation tasks; Q01–Q10 identify product decisions or sample inputs. This file is the only task-status register. Keep IDs stable when splitting or reordering tasks. Record completed validation and a commit or artifact link when changing a task to Done.

| Status | Meaning |
| --- | --- |
| Ready | Can start now; no unresolved input or unfinished dependency. |
| Planned | Scope is clear enough to plan, but prerequisite tasks are unfinished. |
| Needs input | A named product decision or representative asset is required before this task can be completed. Other dependencies may also remain. |
| In progress | Currently being implemented; keep only one primary task in progress. |
| Done | Acceptance criteria and relevant verification passed; evidence is recorded. |
| Deferred | Outside the first release unless explicitly brought into scope. |

Priority follows the parent feature: P0 discovery/foundation, P1 first playable release, P2 optional follow-up. Milestones sequence work; they are not calendar promises. Later tasks are feature slices and may be split into smaller tasks before implementation. Do not estimate dates until the rule questions are answered and the first iteration establishes a useful baseline.

This is a low-cost hobby project for friends. No hosting purchase, paid service, implementation, or deployment is authorized merely by writing a task. Konva is confirmed. Other proposed technology choices should be explained when introduced, as required by AGENTS.md.

All UI tasks follow the owner-approved [interface style](design/interface-style.md) and shared CSS tokens. T04 must verify that Ctrl+C in the owner's Windows terminal stops all development child processes and permits a clean restart; the earlier automated shutdown left watchers running and is recorded as an open verification gap in the [T01 code review](reviews/0002-t01-code-review.md).

Current technical context: [project overview](specs/0002-project-context.md), [T01 changes](specs/0003-t01-workspace.md), [T02 changes](specs/0004-t02-local-database.md) and [T03 changes](specs/0006-t03-repeatable-checks.md). The [combined review](reviews/0003-t01-t02-code-review.md) records the two fixed T02 findings and regression checks. T03 has its own [verification evidence](verification/t03-repeatable-checks.md); the P1 finding in [Review 0004](reviews/0004-t03-code-review.md) is corrected and verified. T04 is not complete.

## Milestones and visible outcomes

| Milestone | Outcome the owner can try | Tasks | Exit condition |
| --- | --- | --- | --- |
| M0 — Local foundation | Start the project from documented commands and see the browser reach the backend. | T01–T04 | Clean install, build/checks, database persistence and API health demonstration. |
| M1 — Accounts | Register, log in, log out, and access an administrator-only page with the correct account. | T05–T08 | Real persisted accounts, revocable sessions and backend role checks work. |
| M2 — Content and setup | Upload images, publish units/maps/rules and prepare a game. | T09–T17 | Two assigned players can open a saved game with pinned content. |
| M3 — Shared play | View the board, move units and advance turns from two browsers. | T18–T29 | Authoritative movement, turn agreement and reconnect tests pass. |
| M4 — Calculator | Select participants and inspect explained damage/casualty results. | T30–T32 | Approved worked examples and supported-property coverage pass. |
| M5 — Friends release | Use the service on one host and restore its data from backup. | T33–T38 | End-to-end, usability, budget, deployment and recovery checks pass. |
| Later | Apply calculated casualties or expand gameplay where useful. | T39–T40 | Separately scoped and prioritized. |

## Open product decisions and required inputs

All entries below are Open. The owner supplies game intent/content; the developer explains alternatives and records the answer in the specification and affected tasks. Proposed defaults are not approved rules. Resolve only the decisions needed by the upcoming slice; do not block local foundation work on hosting or combat questions.

| ID / parent | Decision or input | Existing proposal or needed evidence | Blocks |
| --- | --- | --- | --- |
| Q01 / B01 | Source rules, properties and abilities | Existing written rules, at least two representative unit definitions, and a list of mechanics required in the first release. | T12, T15, T21, T30–T32 |
| Q02 / B01 | Board geometry and movement | Square, hex or free movement; scale; path/distance rule; diagonals; terrain, stacking and obstacles; one legal and one illegal move example. | T13, T15, T21–T22 |
| Q03 / B01 | Turns and movement resets | Player/side/phase/round sequence, first turn, action limits and when movement/statuses reset. | T15, T21, T24–T25 |
| Q04 / B01 | Mutual agreement | Who votes; whether first consent freezes play; withdrawal and absent-player policy. Current proposal: all participants, freeze on first vote, no timeout advance. | T25–T27 |
| Q05 / B01 | Ownership, visibility and overrides | Number of sides, unit control/sharing, visible unit properties, any hidden information or mandatory line of sight, and active-game admin overrides. | T15–T17, T20–T22, T29 |
| Q06 / B01 | Combat examples | Deterministic/dice rules, rounding, modifiers and casualty allocation. Provide ordinary, boundary and interacting-ability examples with expected results. | T30–T32 |
| Q07 / B03–B04, B09 | Account and content access policy | Public self-registration or friend invitation code; rules visibility. Also finalize session lifetime, username policy and password limits with a technical explanation. | T05–T07, T14 |
| Q08 / B22 | UI language and primary devices | Documentation remains English; confirm interface language, desktop browsers and whether phones need full board play. Desktop-first is currently proposed. | T07, T08, T11–T14, T19–T20, T22, T25–T26, T32, T34 |
| Q09 / B21 | Operating budget and group size | Monthly spending ceiling/currency, available machine, typical players/units and upload volume. One active game with 2–8 players is a sizing proposal only. | T35–T37 |
| Q10 / B21 | Backup destination and tolerated progress loss | Separate device/storage, retention, manual recovery and acceptable loss interval. Daily/seven copies is a proposal. | T35, T37–T38 |

Calculator result application is not required for the first release. Discuss its permissions and mechanics only if T39 is promoted. Resolve any rules-required advanced mechanic under Q01/Q05 before claiming the game is supported.

## First iteration: M0 local foundation

T01–T03 are complete, including the CI-runtime correction. Next take T04. No paid infrastructure or actual game-rule implementation is needed for this iteration. While it proceeds, collect Q07/Q08 for accounts and Q01–Q06 for gameplay. M1 is the next iteration, not part of the M0 completion claim.

### T01 — Create the workspace and minimal application skeleton

- Parent: B02. Priority: P0. Status: Done. Dependencies: none. Evidence: [T01 verification](verification/t01-workspace.md).
- Deliver: `apps/web`, `apps/api`, `packages/contracts`, and `packages/game-engine`; React/Vite browser shell and NestJS backend shell; pnpm workspace configuration, compatible pinned dependency versions, and a lockfile.
- Acceptance: a clean install succeeds; frontend and backend start using documented commands; the browser can fetch a small health response through a same-origin development proxy; shared packages resolve and production builds succeed.
- Verification: build/type checks and a manual browser-to-API check. Do not add fake combat formulas, demo auth or unused feature libraries.
- Learning note: explain workspaces, frontend/backend responsibilities and why shared types still need runtime input validation.

### T02 — Provide persistent local PostgreSQL and validated configuration

- Parent: B02. Priority: P0. Status: Done. Depends on: T01. Evidence: [T02 verification](verification/t02-local-database.md).
- Deliver: local Compose database, persistent volume, `.env.example` without credentials, ignored local secret files, Prisma setup and a first migration convention. Local development data is not production data.
- Acceptance: backend connects using validated configuration; an invalid/missing required setting fails with a useful error; migration command works against a clean database; a disposable persistence check survives container replacement without deleting volumes. No speculative game schema is required.
- Verification: clean database initialization and persistence demonstration using disposable local data.
- Learning note: explain migrations versus table editing, and why a persistent Docker volume survives container replacement but still needs a separate backup. See [Docker volumes](https://docs.docker.com/engine/storage/volumes/).

### T03 — Add repeatable checks and a minimal CI workflow

- Parent: B02. Priority: P0. Status: Done (including review correction). Depends on: T01, T02.
- Deliver: root build/type/lint commands and a repository CI workflow using the lockfile. Add test tooling with the first meaningful tests rather than filler tests of empty scaffolding.
- Acceptance: the same commands run locally and in CI without production secrets; an isolated local exercise with an intentional type error makes the type check fail; the restored valid tree passes. Include tests/migrations in CI as corresponding features arrive.
- Verification: successful local checks and CI configuration inspection; record an actual CI run when remote execution is available, without claiming it ran locally.
- Learning note: explain what CI checks and which behavior still needs runtime or browser verification.
- Completion: [change specification](specs/0006-t03-repeatable-checks.md), [verification](verification/t03-repeatable-checks.md) and [Review 0004](reviews/0004-t03-code-review.md). The review's P1 mismatch is fixed by reference Node 22.22.3 and supported ranges `^22.22.3 || ^24.15.0`. Fresh frozen installation as the first dependency operation, unchanged lockfile and full checks/ten tests passed with both pnpm and child commands on the selected runtime. After Docker restart, final clean/idempotent migration/status and network-failure tests also passed under Node 22.22.3 in a disposable database. Remote CI had not run at the pre-commit checkpoint.

### T04 — Document and demonstrate the local workflow

- Parent: B02. Priority: P0. Status: Ready. Depends on: T01–T03.
- Deliver: setup instructions covering prerequisites, environment configuration, start/stop, migrations and checks, plus troubleshooting for occupied ports and database connection errors.
- Acceptance: following instructions from a clean checkout leads to the browser/API health demonstration; no undocumented global dependency or paid account is needed. Document supported runtime versions and distinguish local setup from a future production deployment.
- Verification: repeat the documented sequence; record outcomes. Mark B02 Done only when all B02 acceptance criteria are satisfied.
- Learning note: walk through a browser request to the backend and explain where database data lives.

## M1 — Accounts and roles

| ID / parent | Priority | Status | Task and completion evidence | Depends on / input |
| --- | --- | --- | --- | --- |
| T05 / B03 | P1 | Needs input | Implement user model, unique normalized username, password hashing and registration endpoint. Match Q07; registration always creates a player; validate duplicates/invalid input and rate limiting with integration checks. | T02–T03; Q07 |
| T06 / B04 | P1 | Needs input | Implement login/current-user/logout, hashed opaque sessions, expiry, CSRF/origin checks and rate limits. Valid session works; logout/expiry stops access; invalid credentials do not reveal account details. | T05; Q07 |
| T07 / B03–B04, B22 | P1 | Needs input | Build registration/login forms, authenticated shell and logout. Field errors, failed login and expired session have clear states; refresh preserves a valid login. Verify the real API flow in a browser. | T06; Q07–Q08 |
| T08 / B05 | P1 | Needs input | Add admin bootstrap command, backend role guards and minimal admin landing page. A player cannot access admin endpoints even by direct requests; public registration cannot grant admin; last active admin is protected. | T06–T07; Q08 |

## M2 — Content administration and game setup

| ID / parent | Priority | Status | Task and completion evidence | Depends on / input |
| --- | --- | --- | --- | --- |
| T09 / B06 | P1 | Planned | Implement persistent private upload storage and asset metadata. Define and explain byte/pixel/disk limits; validate decoded PNG/JPEG/WebP; generated paths stay within storage; unauthorized reads fail; container replacement preserves files. | T08 |
| T10 / B06 | P1 | Planned | Add asset references and archive/cleanup rules. Referenced files cannot be removed; unreferenced cleanup has a documented retention period and does not remove in-use content. | T09 |
| T11 / B10 | P1 | Needs input | Add account list, role changes, suspension and administrator-assisted password reset UI/API. Audit changes and revoke affected sessions; protect last admin. Game membership effects are completed in T17, not claimed here. | T08; Q08 |
| T12 / B07 | P1 | Needs input | Implement unit catalog UI/API with validated stats/abilities and image selection. Create/edit/publish immutable versions and archive used definitions; existing deployed instances retain selected versions. | T09–T10; Q01, Q08 |
| T13 / B08 | P1 | Needs input | Implement map upload, calibration and required terrain data UI/API. Preview coordinates and reject invalid calibration; publish immutable versions; an uploaded picture does not infer obstacles. | T09–T10; Q02, Q08 |
| T14 / B09 | P1 | Needs input | Implement illustrated rules editor, preview and reader. Drafts stay private, published content is safely rendered, images resolve and versions link to supported engine rules where applicable. Explain editor choice before adding it. | T09–T10; Q07–Q08; Q01 for gameplay links |
| T15 / B11 | P1 | Needs input | Implement draft/active/paused/finished game state and setup API with pinned content, participants, sides and unit placement. Invalid setup cannot activate; finished games reject writes. | T12–T14; Q01–Q03, Q05 |
| T16 / B11–B12 | P1 | Planned | Add authorized game listing and revisioned snapshot API. Only assigned members/admin can read private games; snapshots contain pinned definitions and saved positions. Verify cross-game access attempts. | T15 |
| T17 / B05, B10 | P1 | Needs input | Finish membership/side/unit assignment and access revocation. Use game-lock ordering; removing/suspending an eligible voter pauses the affected game and invalidates consents; repair/resume is explicit. Verify with T27 before closing this task. | T11, T15, T23, T27; Q05 |

## M3 — Interactive shared board, movement and turns

| ID / parent | Priority | Status | Task and completion evidence | Depends on / input |
| --- | --- | --- | --- | --- |
| T18 / B12 | P1 | Planned | Prototype Konva using representative images: background, units, selection and pan/zoom with logical coordinates. Record alignment and responsiveness at the proposed board size; no authoritative movement claim. Synthetic assets are acceptable until real ones arrive. | T01–T04 |
| T19 / B12 | P1 | Needs input | Connect the board to saved game snapshots and add navigation/setup UI. Reload preserves positions; active-side/loading/empty/error states are visible; zoom never changes distances. | T13, T15–T16, T18; Q08 |
| T20 / B14 | P1 | Needs input | Add delayed unit tooltip and persistent DOM inspector. Cancel on pointer exit; click/focus/touch alternatives show the same permitted current stats and abilities. | T12, T19; Q05, Q08 |
| T21 / B13 | P1 | Needs input | Implement pure movement validation/path cost and approved examples. Cover map bounds, obstacles/terrain, stacking, allowance and statuses required by the rules; document unsupported mechanics. | T12–T13; Q01–Q03, Q05 |
| T22 / B13 | P1 | Needs input | Add move command and board interaction. Server checks ownership/turn, re-evaluates path and atomically spends allowance; client reconciles rejection. Cover legal/illegal/wrong-player/wrong-turn/duplicate commands. | T19, T21, T23; Q05, Q08 |
| T23 / B17 | P1 | Planned | Build game command transaction service, revisions, actor/game-scoped IDs, payload fingerprints and events. Lost-response retry returns original result before revision checks; conflicting payload fails; permission writes share the locking protocol. Verify competing writes on real PostgreSQL. | T15–T16 |
| T24 / B15 | P1 | Needs input | Implement shared turn-transition service. Advance the configured sequence once, reset appropriate state, clear consent and append one event; concurrent transitions cannot double-advance. | T23; Q03 |
| T25 / B15 | P1 | Needs input | Add admin force-advance UI/API with reason and audit. Players cannot invoke it; paused/finished behavior follows the lifecycle policy; browser shows the new turn. | T19, T24; Q03–Q04, Q08 |
| T26 / B16 | P1 | Needs input | Add consent/withdrawal UI/API with eligible-voter display. Turn/roster-scoped unique votes, agreed freeze behavior and unanimity work; disconnected players are not silently excluded. | T24; Q04, Q08 |
| T27 / B10, B16–B17 | P1 | Planned | Verify concurrent final votes versus admin advance, stale votes, withdrawal and roster/suspension handling. Add shared pause/consent invalidation helper usable by T17; prove exactly one transition and explicit recovery. | T25–T26 |
| T28 / B17 | P1 | Planned | Add authenticated game subscriptions and post-commit Socket.IO updates; repair gaps/duplicates/reconnects via snapshots and revision refresh. Session expiry/logout/revocation end unauthorized delivery. | T19, T23 |
| T29 / B12–B17 | P1 | Needs input | Demonstrate two-player shared play plus admin: movement, wrong-owner rejection, turn agreement/force, reload and reconnect convergence. Include role revocation and a rejected stale command. | T17, T20, T22, T25–T28; Q05 |

M2 establishes initial membership and game reads. Active-game membership changes in T17 deliberately finish in M3, once turn/consent behavior exists. M3 is not complete without T17. This avoids claiming full access-management behavior in the content-only milestone.

## M4 — Explained combat calculator

| ID / parent | Priority | Status | Task and completion evidence | Depends on / input |
| --- | --- | --- | --- | --- |
| T30 / B01, B18 | P0 | Needs input | Turn supplied rules/examples into a typed combat contract and coverage matrix linking every supported property/ability to calculation steps and expected examples. Identify missing combinations and unsupported cases before coding formulas. | T12; Q01, Q06 |
| T31 / B18 | P1 | Needs input | Implement pure versioned calculator, rounding/casualty rules and golden tests. Explain modifiers and intermediate results; unknown abilities/missing inputs fail explicitly; distinguish expected outcomes and sampled rolls if applicable. | T30; Q06 |
| T32 / B18, B22 | P1 | Needs input | Add authorized preview endpoint and calculator UI using selected units/context. Show rule versions, modifiers and losses; preview never writes unit/game state; missing input has a useful error; verify examples end to end. | T16, T20, T31; Q08 |

## M5 — Release for friends

| ID / parent | Priority | Status | Task and completion evidence | Depends on / input |
| --- | --- | --- | --- | --- |
| T33 / B20 | P1 | Planned | Maintain seeded browser/integration flow for registration, roles, illustrated content, setup, two-player moves/turns, calculator and reconnects. Include race/retry and private-game access evidence. | T07–T17, T29, T32 |
| T34 / B22 | P1 | Needs input | Finish keyboard unit/destination controls, focus/error states and agreed browser/device checks; verify safe destructive admin actions. Fold accessibility into earlier slices and close remaining gaps here. | T29, T32; Q08 |
| T35 / B21 | P1 | Needs input | Choose one-host deployment and document complete recurring cost categories, available alternatives and maintenance tradeoffs. Confirm budget, capacity and backup destination; no purchase is part of this task. | Q09–Q10 |
| T36 / B21 | P1 | Needs input | Prepare production Compose/proxy configuration, frontend route fallback, HTTPS, persistent database/uploads, secret handling, rotated logs and health checks. Document deployment/migrations and rollback data implications; validate locally before external deployment. | T04, T09, T35; Q09 |
| T37 / B21 | P1 | Needs input | Implement coordinated backup and restoration instructions using chosen off-host destination. Define retention and pre-migration backup; demonstrate a restore where database asset references remain valid. | T10, T35–T36; Q09–Q10 |
| T38 / B20–B22 | P1 | Needs input | Measure representative one-game load; finish release checks and a restore drill; deploy to the selected host when authorized, then smoke-test with the owner and record any known limitations. No public commercial launch is included. | T33–T34, T36–T37; Q09–Q10 |

T35–T37 may be prepared before final browser tests; actual deployment follows verification and the owner's hosting authorization. Each feature carries its own tests rather than deferring testing until M5.

## Optional follow-up

| ID / parent | Priority | Status | Task and completion evidence | Depends on / input |
| --- | --- | --- | --- | --- |
| T39 / B19 | P2 | Deferred | If requested, scope and implement persistent combat application: authority, phase/range checks, server rolls, atomic casualties, stale-preview handling, audit and duplicate protection. | T23, T31–T32; explicit scope decision |
| T40 / B23 | P2 | Deferred | Split individually requested advanced features into scoped tasks. No matchmaking, commercial features, scaling services, undo/replay or spectators are required now. Promote fog of war/line of sight if the source rules require them. | Q01, Q05 and owner prioritization |

## Completion evidence and maintenance

T01–T03 are Done. T03's P1 runtime correction passed fresh-install and full-check verification on 2026-10-23, restoring completion after review. Prior local/database evidence remains separately dated. B02/M0 still require T04's full local onboarding/shutdown demonstration. No remote CI success is claimed. No account, content-management or gameplay feature is complete yet.

For each completed task, add a short entry below with task ID, date, commit/artifact, checks performed and material limitations. Update affected feature criteria, decisions and specification in the same change. Move a dependent task to Ready only after all prerequisites and named inputs have been satisfied. If a task combines independently deliverable work, split it and preserve the original ID as the parent reference.

Required for every coherent change: create/update its numbered change specification, edit [general context](specs/0002-project-context.md) after final corrections, and link specification plus verification evidence from completion records. This also applies to bug fixes, refactors, configuration/dependency/tooling and documentation-policy changes. Do not mark a task Done or report completion until these documents reflect the result. See [Specification 0005](specs/0005-development-documentation.md); historical evidence must not be relabeled as a newly run check.

| Task | Completed | Commit or artifact | Verification and limitations |
| --- | --- | --- | --- |
| T01 | 2026-10-22 | [Change specification](specs/0003-t01-workspace.md); [verification and source links](verification/t01-workspace.md) | Clean frozen installation, package resolution, typecheck/build, dev/proxy requests, compiled frontend/API, browser retry, unavailable-server and recovery checks passed. No database or gameplay implemented. |
| T02 | 2026-10-22 | [Change specification](specs/0004-t02-local-database.md); [verification and source links](verification/t02-local-database.md) | Clean credential-free build, initial seven configuration/startup tests, migration history, Prisma connection, retained marker, outage/recovery and secret checks passed. Review follow-up passed ten configuration/local-target tests and one silent-network test. No domain models or backup system implemented. |
| T03 | 2026-10-23, after review correction | [Change specification](specs/0006-t03-repeatable-checks.md); [verification](verification/t03-repeatable-checks.md); [Review 0004](reviews/0004-t03-code-review.md) | Earlier intentional TS2322/restoration and isolated PostgreSQL checks passed. P1 runtime correction passed clean frozen installation and full lint/type/build/ten tests under actual Node 22.22.3 for pnpm and child commands, preserving the lockfile. No unresolved review finding. Remote CI has not run; no gameplay/onboarding-completion claim. |
