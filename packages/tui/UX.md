# Spinosa TUI — workspace shell

Design contract: see [PRODUCT.md](./PRODUCT.md) and [DESIGN.md](./DESIGN.md).

## Panes

| Key | Pane | Purpose |
|-----|------|---------|
| 1 | Chat | Ask questions; orchestrator runs here |
| 2 | Corpus | Corpus health summary (expand for details) |
| 3 | Routes | Active route + latest report (expand for history) |
| 4 | Settings | Workspace, notes, framework maintenance |

Pane keys `1`–`4` are ignored while the chat prompt is focused.

## Workspace actions

| Key | Action |
|-----|--------|
| n | New question (Chat) |
| a | Add files (onboarding) |
| w | Switch workspace |

## Flow

1. **Picker** → choose or create workspace
2. **Onboarding** → `spinosa new` / `add`
3. **Startup hub** → index corpus in Chat when status is "Ready to index"
4. **Workspace** → Chat default when "Ready"

Orchestrated submits frame a goal artifact; general answers enter the conversation normally.
