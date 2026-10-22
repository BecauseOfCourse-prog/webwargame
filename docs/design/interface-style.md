# Interface Style

Date: 2026-10-22

Status: Confirmed by the project owner after the T01 preview. Apply this visual direction to subsequent pages, components and board controls.

## Visual direction

A quiet tabletop atmosphere: deep green backgrounds, warm ivory text, restrained sand/gold accents, thin borders, generous space and readable typography. Preserve the T01 appearance when adding registration, rules, catalog, game and administrator screens. Use hierarchy and spacing rather than decorative effects to organize information.

The token definitions in [styles.css](../../apps/web/src/styles.css) are the implementation source of truth. Reuse them through `var(...)` instead of introducing repeated literal colors. Update this guide alongside intentional token changes. The existing HTML theme-color matches the background and must be kept consistent if that background changes.

## Palette

| CSS token | Value | Intended use |
| --- | --- | --- |
| `--color-background` | `#172724` | Page background; text on filled accent buttons. |
| `--color-surface` | `#1d302b` | Cards and panels above the page background. |
| `--color-text` | `#f5f0e5` | Main text and visible focus outline. |
| `--color-muted` | `#c1cec7` | Descriptions, secondary labels and footer text. |
| `--color-accent` | `#d6b67a` | Primary actions, small emphasis and brand details. |
| `--color-accent-hover` | `#e9c990` | Hover state of filled primary actions. |
| `--color-border` | `#4e6159` | Subtle panel outlines and decorative separators. |
| `--color-success` | `#8bd6a0` | Positive status. |
| `--color-error` | `#f2ab9b` | Error status and error text on dark surfaces. |

Status is always expressed in words as well as color. The subtle panel border is decorative; do not assume it gives sufficient contrast for essential input boundaries or selected board elements. Verify contrast and add an appropriate stronger token when those components are introduced.

## Typography and layout

- UI font: `--font-ui`, the system sans-serif stack, with no external font download or subscription.
- Display font: `--font-display`, Georgia with a serif fallback. Use for page/display headings where it supports the tabletop feel. Body copy, inputs, tables and board labels remain sans-serif.
- The T01 welcome title uses 52–88 px responsive sizing. This is specific to the welcome section, not a global size for every page heading. Forms and admin pages need smaller headings appropriate to their density.
- Intro text uses 17 px with a 1.7 line height. Preserve comfortable body readability; 12–13 px is reserved for short secondary labels, not dense rules text.
- Page shell: maximum width 1160 px, with responsive horizontal padding. Text columns stay narrower than the shell. Gameplay may use a wider board layout where needed while keeping the same palette and controls.
- Use a consistent 4 px spacing rhythm for new components, with occasional optical adjustments. Existing cards use 24 px padding, reduced to 20 px on small screens.
- Card radius: `--radius-card` (12 px); control radius: `--radius-control` (6 px). Use subtle 1 px outlines and avoid heavy shadows or gradients unless they solve a specific readability problem.

## Components and interactions

- Primary buttons: sand/gold fill, dark green text, modest rounding, clear hover state and visible keyboard focus. Secondary and destructive variants should inherit this system when implemented; they do not exist yet.
- Forms: dark surfaces, persistent visible labels, readable input values and error text. Design focus/error/disabled/loading states along with the normal state.
- Cards: slightly lighter green than the page, restrained border and generous inner space.
- Navigation: compact and readable, using the same fonts and accent color. Avoid turning every navigation item into a primary action.
- Status: show a short text message alongside an optional colored dot/icon; loading should not shift the whole layout.
- Board: keep map/unit uploads faithful to their original colors. Apply this theme to surrounding panels, tooltips and controls. Player/side markers need a separate distinguishable palette and labels; do not overload success/error colors as the sole team identifiers.
- Avoid unnecessary motion; any later animation must respect reduced-motion preferences. Verify that essential content fits narrow screens and that keyboard focus remains visible.

## Implementation and review rule

Before adding a new component, consult these tokens and reuse existing patterns. Add reusable components when actual repetition appears; no UI kit or paid assets are required to preserve this style. Any material change to palette, typography or visual direction must be explained to the owner before implementation. Minor layout adaptation for forms, admin tables and the battle map is expected.

For each new screen, inspect normal, loading, empty and error states as applicable. Check narrow-width layout, keyboard interaction and text contrast. This guide records the approved direction; it does not claim future components or complete accessibility coverage are implemented.
