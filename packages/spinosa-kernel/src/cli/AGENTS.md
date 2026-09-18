# Spinosa kernel CLI

`packages/spinosa-kernel/src/cli/` is the yargs command surface for the Spinosa kernel binary.

The terminal application lives in `packages/tui`. Do not add full TUI features here.

## Entry points

| Entry | File | Role |
| ----- | ---- | ---- |
| Kernel router | `src/index.ts` | Version fast path, then `boot-runtime.ts` + lazy commands |
| Product dev | `packages/spinosa-cli/src/index.ts` | `bun run dev` — spawns kernel, re-execs on preflight exit `10` |
| Installed shim | `workspace-template/.bin/spinosa` | Resolves framework root, spawns kernel, re-execs on exit `10` |

## TUI launch flow

Default command (`spinosa` with no args) runs `cmd/tui.ts`.

1. Launch probes npm `opencode-ai` (5 s, 6 h cache) and sets `SPINOSA_OPENCODE_COMPAT_VERSION` so Console gets `User-Agent: opencode/≥1.18.0` before the worker spawns. If Console later requires a newer floor, the session retries once with that version and persists it.
2. `runLaunchPreflight()` in `@spinosa/core/commands/preflight` checks for Spinosa updates, then offers a Y/n refresh for stale workspace template packs. A cache-miss network check times out after 2.5 s and continues launch.
3. The TUI worker spawns in parallel with that check and answers `ping` before it loads the session server. An accepted upgrade stops the worker and exits.
4. `runLaunchBootHealth()` indexes registered workspaces and cleans stale install paths in the same terminal. Clean success prints nothing. Warnings print one line. Failures log and do not exit. The TUI does not rerun boot health.
5. The terminal prints `Launching TUI...`. There is no extra delay after the worker is ready.
6. `cli/tui/layer.ts` starts `@spinosa/tui`. Plugin load can still show the startup overlay; instant-ready boot completes without a splash.
7. `cli/tui/worker.ts` stubs DOM globals (DOMMatrix, ImageData, Path2D) and suppresses pdf.js boot noise, then loads `worker-main.ts`. It must not import `@napi-rs/canvas` — that extra isolate cannot require the native from bunfs chunks and `/provider` stalls. PDF render stays in the parent. The installer smoke captures boot noise and fails if those warnings appear. Compiled binaries load the extra entrypoint from `/$bunfs/root/src/cli/tui/worker.js` — never a cwd-relative `worker.ts`. The parent waits for an RPC `ping` before rendering. Short worker fetches time out after 120s. Session prompt/command/shell/summarize/compact POSTs have no fetch deadline; worker death still fails the RPC.

`--version` / `-v` / `version` exit in `src/index.ts` before OpenTUI or command modules load. Other commands lazy-load from `cli/command-catalog.ts`. The OpenTUI Solid preload lives in `cli/cmd/tui-entry.ts` only. `boot-runtime.ts` awaits `GlobalReady` (legacy-path migration) before `cli-main.ts` parses.

Preflight runs once per launch. After a successful launch-time Spinosa upgrade it exits cleanly and the user relaunches manually. Template-pack updates apply in place and then continue into the TUI.

## Launch and upgrade commands

| Command | File | Role |
| ------- | ---- | ---- |
| Default TUI | `cmd/tui.ts` | Launch preflight + boot health + full TUI |
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
