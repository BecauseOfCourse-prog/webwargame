# Product Backlog

Date: 2026-10-22  
Status: Initial proposal; no items implemented  
Architecture and requirement IDs: [Specification 0001](specs/0001-project-specification.md)

P0 = clarification or foundation that blocks implementation; P1 = required for the first playable release; P2 = proposed follow-up. Acceptance criteria below include proposed behavior from the specification; they are not evidence of user approval. Dependencies reference backlog IDs.

## Discovery and foundation

| ID | Priority / source | Story or outcome | Acceptance criteria | Depends on |
| --- | --- | --- | --- | --- |
| B01 | P0 / R05–R09 | Define the supported game rules. | Record topology, scale, movement cost, terrain/stacking, turn sequence, consent electorate, combat formula, randomness, casualties and ownership. Attach worked examples and a stat/ability coverage matrix. Clearly identify unsupported rules. | — |
| B02 | P0 / technical | Establish application foundations. | Web/API/shared engine workspace builds; reproducible install and version lockfile exist; configuration is documented; database migrations and CI type/lint checks run without production secrets. | — |
| B03 | P1 / R01 | As a visitor, register using username and password. | Valid unique normalized username and acceptable password create a player account; duplicate/invalid input produces useful validation; passwords are hashed; registration cannot assign admin or private-game access; requests are rate limited. | B02 |
| B04 | P1 / R02 | As a user, log in, log out and end expired sessions. | Valid credentials create a protected revocable session; bad credentials use generic errors; logout/expiry invalidates access; brute-force controls and CSRF/origin checks cover relevant endpoints. | B03 |
| B05 | P1 / R03, R13 | Enforce roles and object-level access. | Player cannot invoke admin endpoints or access another private game by changing an ID; game membership, side and unit ownership are checked server-side; first-admin bootstrap is documented; last active admin is protected. | B04 |

## Content and administration

| ID | Priority / source | Story or outcome | Acceptance criteria | Depends on |
| --- | --- | --- | --- | --- |
| B06 | P1 / R04, R10–R12 | Upload and reference game images safely. | Admin can upload supported decoded images within configured limits; invalid formats and oversized images fail safely; stored assets have metadata and access checks; referenced assets cannot be accidentally removed. | B05 |
| B07 | P1 / R10 | As an administrator, create and edit unit definitions. | Form accepts name, image and supported movement/combat properties; invalid and unsupported abilities are rejected; publish creates a version; deployed units retain previous versions; used definitions can be archived. | B01, B06 |
| B08 | P1 / R11 | As an administrator, add playable maps. | Upload background, set dimensions/topology/scale and required terrain/obstacles; preview alignment; invalid calibration prevents publication; versioned maps remain available to existing games. | B01, B06 |
| B09 | P1 / R04, R12 | Read and maintain illustrated rules. | Admin can save, preview and publish text with images; players can read published content; scripts and unsafe content do not execute; drafts stay hidden; gameplay-changing publications link to a supported engine version. | B05, B06; B01 for executable rules |
| B10 | P1 / R13 | As an administrator, manage accounts and permissions. | List users; grant/revoke roles and game membership; assign sides/units; suspend accounts; revoke affected sessions/subscriptions promptly; audit changes; suspension/removal of an eligible voter pauses affected active games and invalidates consents without advancing; roster repair and resume are explicit. | B05; B11 for game assignments |

## Game setup and battle map

| ID | Priority / source | Story or outcome | Acceptance criteria | Depends on |
| --- | --- | --- | --- | --- |
| B11 | P1 / enabling R05–R09 | As an administrator, prepare and activate a game. | Choose pinned map/rules/unit versions, assign participants and sides, deploy units and set first turn; invalid placement or missing required setup blocks activation; active/paused/finished lifecycle permissions are enforced. | B07, B08, B09 |
| B12 | P1 / R05 | As a participant, view a shared interactive map. | Map and units load at saved logical positions; select, pan and zoom work; active side and remaining allowance are visible; refresh restores persisted state; outsiders cannot load the game. | B11 |
| B13 | P1 / R05 | As a player, move an eligible unit within its allowance. | Legal path commits position and spent movement; out-of-bounds, blocked, over-budget, wrong-owner and wrong-turn commands fail without changing state; repeated commands cannot spend twice; previews match server rules and rejection restores display. | B01, B12, B17 |
| B14 | P1 / R08 | Inspect a unit's properties. | Hover for the configured delay reveals current properties and abilities; leaving cancels the pending tooltip; click, keyboard focus and touch offer equivalent inspection; hidden information follows the chosen visibility policy. | B12, B07 |

## Turns and multiplayer consistency

| ID | Priority / source | Story or outcome | Acceptance criteria | Depends on |
| --- | --- | --- | --- | --- |
| B15 | P1 / R06 | As an administrator, advance the turn. | Only admin can force advance; reason and actor are recorded; correct next side/phase and allowance resets are applied atomically; finished games reject the command; duplicate/racing requests produce only one transition. | B01, B11, B17 |
| B16 | P1 / R07 | As players, advance by mutual agreement. | Display eligible voters and outstanding consent; only eligible participants vote once per turn; withdrawal works; unanimity advances exactly once; disconnect is not consent; stale votes are rejected; pending-vote mutation policy and roster changes follow the agreed spec. | B01, B15 |
| B17 | P1 / enabling R05–R09 | Keep clients consistent under concurrency and reconnects. | Commands carry revision and actor/game-scoped deduplication ID; a lost-acknowledgment retry returns its original result before stale-revision validation; ID reuse with different input fails; revoked access cannot retrieve stored results; permission writes share the game-lock protocol; committed changes broadcast to authorized subscribers; gaps/reconnects and revision refresh repair missed events; restart preserves committed state. | B05, B11 |

## Combat

| ID | Priority / source | Story or outcome | Acceptance criteria | Depends on |
| --- | --- | --- | --- | --- |
| B18 | P1 / R09 | As a player, preview damage and casualties. | Choose valid participants and required context; see all applicable modifiers, intermediate steps and final losses; results match approved examples for every supported property and combination; rounding and randomness are explicit; missing or unsupported rules block calculation; preview makes no persistent change. | B01, B07, B12 |
| B19 | P2, optional extension / related to R09 | Apply a verified combat result to the game. | Explicit application revalidates permissions, phase, participant revision, range and action eligibility as required by rules; server recomputes results and rolls; casualties/statuses persist atomically; duplicate apply cannot repeat losses; stale preview is rejected/refreshed; result records inputs and rule version. | B18, B17; include only after scope confirmation |

## Release and follow-up

| ID | Priority / source | Story or outcome | Acceptance criteria | Depends on |
| --- | --- | --- | --- | --- |
| B20 | P1 / technical | Verify a complete multiplayer game flow. | Automated tests cover approved rules, object authorization, simultaneous move/turn commands, lost-acknowledgment retries, voter suspension and reconnects; a two-player plus admin browser scenario passes with representative content. Test duplicate combat application if B19 is included. | B03–B18; B19 only if included |
| B21 | P1 / operational | Deploy and recover the service. | TLS and secure secrets configuration, migrations, health checks, logs, image/database backups and retention are documented; restore drill succeeds; no credentials appear in logs; agreed capacity envelope is measured. | B20 |
| B22 | P1 / usability | Make core gameplay understandable and accessible. | Clear loading/disconnect/conflict errors; keyboard inspection and destination controls; safe confirmation of destructive admin operations; responsive essential forms; chosen browser matrix verified. | B12–B18; B19 only if included |
| B23 | P2 / follow-up | Expand content and gameplay after MVP feedback. | Individually scope spectator access, replay/undo, advanced editors, fog of war, line of sight, extra sides, or public discovery; promote rules-required features to P1 before release. | B01, user prioritization |

## Delivery slices

1. **Rules and foundation:** B01–B05. Confirm core rule decisions; establish secure accounts.
2. **Playable content:** B06–B12 and relevant B10 assignments. Admin can publish content and set up a game.
3. **Shared movement and turns:** B17, B13–B16, B14. Two browsers agree on movement and turn state.
4. **Combat:** B18 and, if confirmed, B19. Calculator covers the agreed rules and explains results.
5. **Release readiness:** B20–B22. Verification, accessibility, deployment, and restoration pass.

Each slice should include its own relevant tests and usable UI; final verification adds cross-feature coverage. These slices are ordering guidance, not time estimates.

## Definition of done

An item is done when its acceptance criteria pass, required server authorization and validation exist, meaningful automated checks cover its risks, related documentation is current, and the behavior can be demonstrated with representative data. A first playable release includes every P1 item. B19 is optional and does not block that release unless explicitly promoted into scope. Every R01–R13 requirement must be traceable to passing acceptance evidence. Open formula/topology/turn-policy questions block dependent completion claims.
