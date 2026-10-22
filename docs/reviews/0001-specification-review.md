# Review 0001: Initial Specification and Backlog

Date: 2026-10-22  
Scope: Specification 0001 and the initial product backlog  
Outcome: Suitable for foundation planning after the corrections below. Rule-dependent implementation remains blocked by the documented product questions.

## Findings and disposition

| Severity | Finding | Correction |
| --- | --- | --- |
| P1 | Revision checking before command deduplication would reject a successful move retried after its acknowledgment was lost. Deduplication scope and access checks were unspecified. | Specify actor/game keys, payload fingerprints, current authorization, and stored-result lookup before revision validation; extend B17/B20 acceptance criteria. |
| P1 | Suspending an eligible voter could leave mutual agreement permanently blocked, with no defined roster repair path. Concurrent access revocation and movement also lacked a shared ordering rule. | Pause affected games, invalidate consents, require explicit roster repair/resume, and serialize relevant permission writes through the game-lock protocol; extend B10/B17/B20. |
| P2 | Applying combat losses was called proposed MVP scope and appeared in mandatory release dependencies, although the request only requires a calculator. | Make B19 an optional P2 extension, remove unconditional release dependencies, and align the specification and definition of done. |
| P2 | Separate frontend/backend and private storage were selected without a concrete cookie/routing/access deployment boundary. | Specify one HTTPS origin with API/socket proxying, SPA route fallback, and authorized private asset delivery. |
| P2 | The library list could be interpreted as an upfront infrastructure requirement. | Introduce dependencies by feature slice, keep one backend deployment, and validate the canvas choice with representative content. |

## Architecture assessment

Retain the proposed stack. React handles forms and interactive state; Konva handles the board scene; a shared TypeScript engine reduces duplicated formulas; NestJS organizes one authoritative backend; PostgreSQL serializes competing game commands. Prisma assists persistence but does not replace transaction design. Socket.IO distributes committed changes, while snapshots and revisions repair missed notifications.

This is a design judgment for the stated requirements, not a benchmark result. A lighter HTTP framework or SVG board could work at smaller scope; the proposed structure trades some setup effort for explicit boundaries around identity, content, permissions and game rules. Avoid additional services until measured needs justify them.

## Remaining decisions

The source rules, movement topology, turn semantics, consent policy and combat examples remain unspecified. The two-side model, consent freeze, access policy and capacity targets remain proposals. This review does not approve those product assumptions or invent missing formulas. Foundation implementation can proceed independently; movement and combat completion require the answers and acceptance examples listed in Specification 0001.

## Validation

Review checks: trace R01–R13 to backlog coverage; inspect dependency consistency after making B19 optional; verify local Markdown links; run `git diff --check`; inspect the final documentation diff. No application tests apply because this change only updates planning documents.
