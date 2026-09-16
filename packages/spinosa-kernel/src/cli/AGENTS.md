# Spinosa kernel CLI

`packages/spinosa-kernel/src/cli/` is the yargs command surface for the Spinosa kernel binary.

The terminal application lives in `packages/tui`. Do not add full TUI features here.

## Entry points

| Entry | File | Role |
| ----- | ---- | ---- |
| Kernel router | `src/index.ts` | Registers commands, handles argv |
| Product dev | `packages/spinosa-cli/src/index.ts` | `bun run dev` — spawns kernel, re-execs on preflight exit `10` |
| Installed shim | `workspace-template/.bin/spinosa` | Resolves framework root, spawns kernel, re-execs on exit `10` |

## TUI launch flow

Default command (`spinosa` with no args) runs `cmd/tui.ts`.

1. `runLaunchPreflight()` in `@spinosa/core/commands/preflight` checks for Spinosa updates, then offers a Y/n refresh for stale workspace template packs (runs **before** the TUI worker spawns).
2. The terminal prints status lines. Then `printLaunchingTui()` prints `launching TUI...`.
3. `cli/tui/layer.ts` starts `@spinosa/tui`.
4. `cli/tui/worker.ts` stubs DOM globals (DOMMatrix, ImageData, Path2D) and suppresses pdf.js boot noise, then loads `worker-main.ts`. It must not import `@napi-rs/canvas` — that extra isolate cannot require the native from bunfs chunks and `/provider` stalls. PDF render stays in the parent. Compiled binaries load the extra entrypoint from `/$bunfs/root/src/cli/tui/worker.js` — never a cwd-relative `worker.ts`. The parent waits for an RPC `ping` before rendering.

Preflight runs once per launch. After a successful launch-time Spinosa upgrade it exits cleanly and the user relaunches manually. Template-pack updates apply in place and then continue into the TUI.

## Launch and upgrade commands

| Command | File | Role |
| ------- | ---- | ---- |
| Default TUI | `cmd/tui.ts` | Launch preflight + full TUI |
| `preflight` | `cmd/preflight.ts` | Manual preflight (tests, scripts) |
| `upgrade` | `cmd/upgrade.ts` | CLI wrapper around `upgradeFramework()` |

Upgrade logic lives in `@spinosa/core/commands/upgrade`. Do not duplicate it in the kernel or TUI.

## Other TUI paths

| Trigger | File | Flow |
| ------- | ---- | ---- |
| `spinosa attach` | `cmd/attach.ts` | Full TUI unless `--mini` |
| `spinosa --mini` | `cmd/run.ts` | Lightweight split-footer mode |
| `spinosa run` | `cmd/run.ts` | Batch or mini interactive |
| `spinosa serve` | `cmd/serve.ts` | Headless API server |

## Host adapters (stay in kernel)

```txt
cli/tui/
  layer.ts              transport + Effect layer for full TUI
  worker.ts             in-process server worker
  validate-session.ts   session validation helper
```

Config: `src/config/tui.ts`, `tui-migrate.ts`, `tui-host-attention.ts`

## Dev

From repo root:

```bash
bun run dev              # same launch path as installed spinosa
bun run dev serve        # headless API
```

`bun run dev` sets `SPINOSA_TEMPLATE_ROOT` to the repo root. Preflight compares root `package.json` to the remote channel.

## Related docs

- `packages/tui/AGENTS.md` — terminal application
- `packages/spinosa-core/AGENTS.md` — upgrade engine and preflight
- `RELEASE_GUIDE.md` — maintainer release pipeline
- `packages/spinosa-kernel/AGENTS.md` — inherited kernel internals (Effect, database)
