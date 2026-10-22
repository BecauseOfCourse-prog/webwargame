# Specification 0005: Mandatory Change Documentation Workflow

Date: 2026-10-22

Status: Implemented development policy, explicitly requested by the project owner.

## 1. Purpose and scope

Keep the project's general context accurate and make every completed change understandable without reconstructing chat history. This policy applies to features, bug fixes, refactors, API/data-model changes, dependencies, configuration, infrastructure/tooling and development-rule/documentation changes. It is part of the definition of done for the whole repository.

## 2. Required documents

Every coherent task/change must have a change specification under `docs/specs/`, using the next available numeric prefix and a descriptive filename. T01 and T02 already have their own specifications. Create a new specification for a new task or independent change; update the existing one for implementation edits and review fixes within the same change. The unit is a coherent change, not an individual file edit or tool call.

Each specification must contain:

1. Date, status, task/parent references where applicable, problem and intended outcome.
2. Scope, changed components and resulting behavior/interfaces.
3. Important decisions, rationale, alternatives/tradeoffs or links to the relevant decision records.
4. Affected configuration, dependencies, data/migrations and compatibility/operational implications, as applicable.
5. Acceptance conditions, verification actually performed and links to evidence.
6. Limitations, deferred scope and any unresolved questions.

Scale detail to the change. A policy-only increment can be short and say that application behavior, API and storage are unchanged; it still requires a specification. Do not add speculative technical content merely to fill a section. Review reports describe findings, and decision records explain choices; neither replaces the change specification.

## 3. Mandatory general-context update

After each change, edit [the current project context](0002-project-context.md) to describe the final state. Update affected stack versions, architecture, capabilities, interfaces, commands, status, decisions and limitations as needed. Link the new or updated change specification. Separate implemented behavior from proposals and confirmed constraints.

If a change affects only documentation/process or leaves the architecture and application behavior intact, update the context with a concise maintenance note identifying the change and its specification. Do not imply that an application feature was added. The latest note can be replaced with the next relevant update; the context is an overview, not a duplicate commit log.

## 4. Completion and commit workflow

1. Read current context and the active backlog task before implementing.
2. Create/update the change specification while making the change; explain important technical choices to the owner as AGENTS.md requires.
3. Verify the resulting behavior at a level appropriate to the change and record actual evidence. Documentation-only work needs link/content checks, not fabricated application test runs.
4. Update the general context after the final implementation/review corrections.
5. Link the specification and evidence from the task's completion entry; update any affected backlog criteria and README navigation.
6. Check local document links and ensure specs/context agree with source and status.
7. Only then report completion or mark the task Done. Include source, specification, context and relevant evidence updates together when committing the change. Do not postpone documentation to an unspecified later task.

This is a documentation requirement, not a new permission gate. Continue authorized work; it does not independently authorize a commit, push, deployment or paid service.

## 5. This policy increment

This change makes documentation maintenance mandatory in AGENTS.md, the product definition of done and implementation completion rules, and adds a matching section to current context. It updates navigation and links existing T01/T02 completion entries to their specifications. Runtime code, stack versions, database schema and interface style are unchanged by this increment. Verification is documentation link consistency and `git diff --check`; existing application test evidence is not claimed as newly rerun.
