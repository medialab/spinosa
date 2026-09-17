# Spinosa TUI — Design system (terminal)

**Surface:** Product TUI on OpenTUI/Solid. Inherits Spinosa theme via `useTheme()`.

## Typography hierarchy

| Level | Treatment | Use for |
|-------|-----------|---------|
| L1 — Pane title | `theme.text` + bold | One per pane |
| L2 — Section | `theme.text` bold or regular | Coverage, Pipeline, etc. (≤4 per viewport) |
| L3 — Body / meta | `theme.text` / `theme.textMuted` | Values, paths, counts |
| L4 — Action | `theme.primary` (primary only) | One CTA per region |

Paths and session ids always `textMuted`; never bold.

## Semantic status colors

| Meaning | Token |
|---------|-------|
| OK / present | `theme.success` |
| Blocked / missing | `theme.error` |
| In progress | `theme.info` |
| Pending | `theme.textMuted` |
| Primary action | `theme.primary` |

Status glyphs (✓ ✗ ◉ ○) must use semantic color, not decoration alone.

## Layout

- Content rail: `CenteredColumn` + `MAIN_CONTENT_MAX_WIDTH` (100)
- Chat/session: transcript budget from `transcriptBudget()` (`util/layout.ts`) — main text first (≥80 center cells), annotation rails only at ≥124 terminal columns (≥18 cells each); classic single-column below that. Session sidebar (42 cols) sits outside the cap.
- Nav chrome: full terminal width; `backgroundPanel` + `SplitBorder`
- Density: compact; collapsed summaries by default; expand for operator detail

## Restraint

- ≤1 primary-colored control group per pane
- No duplicate workspace metadata in nav and pane header
- Left-bar CTA: primary = `borderColor primary` + `backgroundElement`

## Accessibility (TUI)

- Pane keys `1`–`4`; guard when prompt focused
- Nav actions: `n` new question, `a` add files, `w` switch workspace
- Status: symbol + color + text
