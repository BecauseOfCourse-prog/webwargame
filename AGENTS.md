# Development Guidelines

These instructions apply to the entire repository.

## Budget and audience

The service is for the owner's group of friends. A commercial launch is not currently planned. Optimize for low recurring cost, simple maintenance, and a working game rather than speculative growth.

Prefer one host, one backend instance, self-hosted PostgreSQL, and persistent local asset storage for the initial deployment. Do not introduce mandatory paid services, managed databases, object storage, distributed infrastructure, commercial availability targets, or market-facing features without a demonstrated need. Explain both recurring cost and maintenance tradeoffs when proposing infrastructure. Ask for a concrete spending limit before choosing paid hosting; do not purchase services without authorization.

Keep password protection, server-side permissions, transactional game correctness, and off-host backups in scope. Low cost does not justify losing game state or exposing credentials. Revisit capacity based on the actual group's needs.

## Explain important technical decisions

The project owner wants to learn alongside development. Explain every important technical decision to them in Russian, using plain language and defining unfamiliar terms. Keep repository documentation in English.

For each important decision, explain:

1. The problem it solves and how it affects this project.
2. The proposed approach and why it fits.
3. Reasonable alternatives and their main tradeoffs.
4. Relevant costs, limitations, and conditions that would justify revisiting it.

Important decisions include architecture, dependencies, data models, API contracts, authentication and permissions, game algorithms, concurrency, persistence, deployment, and substantial changes to existing approaches. Explain before implementing when practical; routine naming, formatting, and equivalent local implementation details do not require a separate explanation.

Use a small project-specific example when it helps understanding. Separate established facts, assumptions, and recommendations. Do not imply that a library enforces game rules unless it actually does. Scale explanations to the significance of the decision and avoid overwhelming the owner with unrelated detail.

Explain decisions without turning every explanation into an approval request. Continue authorized work; ask for clarification when a missing product decision materially changes behavior or scope. Record lasting decisions and their rationale in the project specification or a focused decision document, and keep the backlog consistent with them.

## Confirmed board technology

The project owner confirmed retaining Konva with react-konva for the interactive battle map on 2026-10-22. It renders uploaded map and unit images and supports board interaction. Upload handling, movement validation, combat calculations, and multiplayer authorization remain separate responsibilities.

A representative prototype should validate usability and performance. Such validation does not reopen the technology choice automatically; explain material evidence and tradeoffs before proposing a replacement.

## Confirmed interface style

The owner approved the T01 interface's colors and visual style on 2026-10-22. Follow [the interface style guide](docs/design/interface-style.md) for all new pages, forms, administrative screens and board controls. Reuse the CSS tokens in `apps/web/src/styles.css`: deep green backgrounds, ivory text, sand/gold accents, serif display headings and system sans-serif UI text. Preserve restrained borders, rounded cards/controls and comfortable spacing.

Explain any material visual-direction change before implementing it. Adapt layout to the task rather than copying the welcome page's oversized heading into every screen. Preserve the original colors of uploaded maps and unit art. Include appropriate focus, loading and error states; do not communicate state or team identity through color alone.
