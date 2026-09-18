# TUI Package Guide

`@spinosa/tui` is the canonical Spinosa terminal application. SolidJS + OpenTUI. The live host is `packages/spinosa-kernel` (product entry via `packages/spinosa-cli`) — it wires transport, config, and Effect layers and does not own UI trees.

Read `specs/tui-package.md` for extraction history and boundary rules.

## Public API

Entry: `src/index.tsx` exports `run` and `TuiInput`.

Hosts call `run({ url, headers, args, config, fetch, pluginHost, ... })` and provide an Effect layer (typically `AppNodeBuilder.build(Global.node)` from core).

Subpath exports in `package.json` expose stable host/plugin surfaces: `./config`, `./runtime`, `./context/*`, `./plugin/*`, `./keymap`, `./util/*`, etc. Prefer these over deep imports when integrating from outside the package.

## Spinosa workspace shell

Entry stack (`spinosa/entry.ts`, `routes/spinosa/`):

1. **global (Home)** — new-chat prompt, chips, recent workspaces
2. **onboarding** — new / resume workspace wizard via `SpinosaCliBridge`
3. **add-files** — import more files into an active workspace
4. **workspace** — chat/session shell (`sessionID`)
5. **visualizer** — workspace graph / timeline views
6. **plugin** — plugin-owned full-screen routes

Dialogs (workspace picker, settings, agents, models, queued prompts, …) are overlays — not routes.

Route model: `global | workspace | onboarding | add-files | visualizer | plugin`. Legacy `home`/`session` navigate inputs normalize to `workspace` / `global` as appropriate.

`SpinosaWorkspaceProvider` holds `activePath` in KV (`spinosa_active_workspace_path`). `setup_status` from `.spinosa/workspace` drives launch decisions (startup choice / open).

**Workspace binding:** Chat sessions default to `spinosa.activePath` (not host cwd) via `HomeSessionDestinationProvider`. `SpinosaWorkspaceBinder` watches setup files and refreshes workspace state.

**Framework source:** `scripts/link-framework.sh` symlinks `../spinosa-main` → `framework/`. CLI bridge resolves `.bin/spinosa` from that tree.

**Layout:** Session transcript follows `transcriptBudget()` (`src/util/layout.ts`): main text first (≥80 center cells), annotation rails only at ≥124 terminal columns; classic single-column below that. Session sidebar (42 cols) sits outside the cap. The transcript renders the last 120 rows. Home and Session load lazily; plugin chrome does not block first paint. CWD discovery polls every 15 s.

CLI flags `--session`, `--continue`, `--prompt` skip the picker.

## Verification

Fixture workspace: `test/spinosa/fixtures/workspace-started/` (self-contained; does not use spinosa-main).

```bash
cd packages/tui
bun run test:spinosa      # unit tests
bun run verify:spinosa    # tests + typecheck + maturity checklist
```

## Source map

```txt
src/
  app.tsx                 application root, provider tree, renderer lifecycle
  index.tsx               public exports
  spinosa/                service, bash, parse-goal, parse-corpus, artifact-watcher, types
  routes/
    spinosa/              onboarding, add-files, visualizer
    workspace/            home chips shell helpers
    home.tsx              global Home (new-chat prompt)
    session/              main session view, dialogs, timeline
  context/                Solid providers (SDK, sync, theme, route, …)
  component/              dialogs, prompt, command palette, workspace chrome
  feature-plugins/        built-in sidebar/home plugins (builtins.ts)
  plugin/                 plugin slots, runtime, command-shim
  config/                 TUI config schemas, keybind resolution
  theme/                  theme engine + assets/*.json
  prompt/                 history, stash, frecency
  ui/                     dialog primitives, spinner, toast
  util/                   locale, error, persistence, tool-display, layout
```

## Architecture rules

- **SDK is the backend boundary.** Missing data or operations belong in the server API and `@spinosa/sdk`, not imports from kernel internals.
- **Do not add new `@spinosa/kernel-core` imports.** ~12 files still import core (Flag, Global, InstallationVersion, Flock, Glob, AppNodeBuilder) from the extraction migration. Shrink this set; do not expand it. Pass behavior through `run()` inputs, SDK, or explicit runtime providers instead.
- **One canonical UI.** Never duplicate feature trees into the kernel CLI. Host adapters live in `packages/spinosa-kernel`; presentation lives here.
- **Tool rendering stays tolerant.** Accept `unknown` wire shapes; do not import backend tool implementations for types.

## Host integration paths

| Host | Entry | Notes |
| ---- | ----- | ----- |
| Live CLI (default) | `packages/spinosa-kernel/src/cli/cmd/tui.ts` → `cli/tui/layer.ts` | Full TUI via worker or in-process fetch |
| Attach | `packages/spinosa-kernel/src/cli/cmd/attach.ts` | Full TUI unless `--mini` |
| Product entry | `packages/spinosa-cli` | `bun run dev` / installed shim → kernel |
| Mini TUI | `packages/spinosa-kernel/src/cli/cmd/run/` | **Not** this package's app tree — reuses primitives only |

## Tests and checks

```bash
cd packages/tui
bun test          # 50+ tests: unit, snapshot, sync-hydration, app-lifecycle
bun typecheck
```

Snapshot tests live under `test/`. Prefer extending existing test helpers over new global mocks.

## UI stack

- Rendering: `@opentui/core`, `@opentui/solid`, `@opentui/keymap`
- State: SolidJS (`createStore` preferred over many signals)
- Shared web primitives: `@spinosa/ui` where terminal and web align
- Plugins: `@spinosa/plugin` presentation slots; host injects `pluginHost`

## When changing behavior

1. Session/timeline UI → `src/routes/session/`
2. Global chrome, dialogs → `src/component/`, `src/ui/`
3. Server sync, events → `src/context/sdk.tsx`, `src/context/sync.tsx`
4. Keybinds, themes → `src/config/`, `src/theme/`
5. New backend need → extend SDK/server first, then wire context here

## Dev note

There is no standalone `bun dev` in this package. Run through the live host:

```bash
bun run dev              # from repo root → packages/spinosa-cli → kernel TUI
bun run dev serve        # headless API
```

For TUI-only iteration, `packages/tui` tests are the fastest feedback loop.
