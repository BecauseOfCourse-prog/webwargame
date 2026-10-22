# Review 0002: T01 Code and Approved Interface Style

Date: 2026-10-22

Scope: All T01 application/shared-package source files, manifests, TypeScript/Vite/Nest configuration, workspace commands, ignore rules and related verification documentation. Existing work is still uncommitted, so this review covers the working tree rather than a pull request.

## Findings

No confirmed blocking correctness or security defect was found in the inspected T01 implementation. Registration, authorization, database persistence and game rules do not exist yet and are not covered by that conclusion.

| Category | Observation | Disposition |
| --- | --- | --- |
| Open verification gap | The earlier automated Windows terminal shutdown left nested development watchers/API processes running. It is not established whether the owner's normal terminal reproduces this behavior. | T04 explicitly requires a Ctrl+C shutdown, verification that all development child processes exit, and a clean restart. Do not label this verified fixed or terminate unrelated Node processes. If reproduced, fix process orchestration before completing the local workflow. |
| Maintainability | Colors and typography were repeated as literal CSS values; there was no persistent record of the owner's approved style. | Introduced semantic CSS tokens without changing values, added the interface style guide and repository-wide development instructions. |
| Future style leakage | The welcome-page heading size and footer layout used global element selectors. Those rules would apply to unrelated headings/footers added later. | Scoped display heading styling to `.welcome h1` and footer layout to `.page > footer`. Current page appearance is preserved. This was a preventative maintainability correction, not a demonstrated failure of the existing page. |

## Code inspection

- Browser health requests use the shared relative route, check HTTP success, treat JSON as unknown and apply a runtime guard. They have a five-second timeout and an explicit retry/error state.
- Effect cleanup clears the timer, aborts the request and prevents stale/unmounted requests from updating the page. This also accommodates React StrictMode's development setup/cleanup cycle.
- Health output uses a shared return type. NestJS startup has error reporting, a global API prefix and shutdown hooks. API, dev server and preview bind to loopback.
- Workspace links, built package exports and dependency-aware compilation are consistent. The engine package exports no invented rules. Direct dependencies are pinned and the lockfile exists.
- No credentials, database connection, broad browser CORS policy, HTML injection API or externally hosted fonts are introduced by T01. The health endpoint is process availability, not database/game readiness.
- Canvas, accounts, sockets and persistence are correctly deferred to their feature tasks. There is no reason to add them merely to make the skeleton look complete.

These are inspection results, not claims of exhaustive security, browser or runtime coverage. Fixed ports and the lack of database readiness remain intentional T01 boundaries; validated environment configuration belongs to T02. CI/lint remain T03.

## Verification after style extraction

- `pnpm typecheck`: all four packages passed.
- `pnpm build`: contracts, engine, API and production frontend passed.
- Reloaded the built frontend preview in the in-app browser; a real proxied API request displayed `Сервер доступен`.
- Compared computed color, background, font family, font size, radius and width for the root, card, heading, button and intro before and after reload. Those properties matched exactly in the unchanged desktop viewport.
- Activated the retry button with Enter and observed the successful connection result.
- Saved a screenshot of the resulting page in ignored `.local/style-review-preview.png`.

Prior clean-install, unavailable-server and recovery evidence remains in [T01 verification](../verification/t01-workspace.md). It was not repeated unnecessarily for a CSS token extraction. No new dependency or application test suite was added. Complete responsive/accessibility coverage remains a feature/release responsibility, not a claim of this focused visual check.

## Approved visual direction

The owner confirmed retaining the deep green, ivory and sand/gold appearance, serif display headings, system UI text, restrained borders, rounded panels and generous space. [Interface style](../design/interface-style.md) records the rules and references the CSS token source. New pages should reuse the system while adapting layout to their function. Uploaded game art retains its own colors; future side markers require distinguishable labels and colors.

No commit, remote push or deployment was performed as part of this review.
