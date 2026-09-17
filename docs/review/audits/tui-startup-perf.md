# TUI Startup Performance Report — LIMA VM

**Date:** 2026-07-07
**VM:** `spinosa-test` (LIMA, aarch64, 4 vCPU, 4GiB RAM)
**OS:** Linux arm64 (Ubuntu)
**Bun:** 1.3.14
**Spinosa:** 0.8.0-beta.14

---

## Baseline Measurements

| Command | Cold (ms) | Notes |
|---|---|---|
| `bun --version` | 0.8–1.3 | Bun binary startup only |
| `bun --help` | 0.8–0.9 | Bun CLI, no JS runtime |
| `bun -e 'console.log(1+1)'` | 13.9–14.8 | Bun runtime + minimal JS execution |

---

## Spinosa CLI Help (Bash shim)

**Command:** `spinosa --help`

| Run | Time (ms) | Exit Code |
|---|---|---|
| 1 | 38.1 | 0 |
| 2 | 36.6 | 2 |
| 3 | 38.1 | 2 |

**Observations:**
- Runs 2–3 exit with code 2 even though the `cmd_help` function in the bash library calls `exit 0`. This suggests an error during sourcing of `commands_system.sh` or a `set -e` failure in one of its dependencies (`detect_llm_clis`, workspace detection, etc.). Exit code 2 is a bash builtin error (misuse).
- The output is empty (neither stdout nor stderr), indicating the error is silently swallowed or the help function fails before emitting anything.
- Timing (~37ms) is pure bash sourced-library overhead — no TypeScript/bun involved.

**`spinosa version`** (same bash shim, similar path) completes correctly in **35–38ms** (exit=0), so framework resolution and library sourcing work. The `--help` issue is specific to `cmd_help` encountering a failing sub-operation.

---

## Spinosa-core CLI Help (TypeScript entry)

**Command:** `bun run <fw>/packages/spinosa-core/bin/spinosa.ts --help`

| Run | Time (ms) | Exit Code |
|---|---|---|
| 1 | 632.0 | 0 |
| 2 | 577.8 | 0 |
| 3 | 563.9 | 0 |

**Lazy loading in spinosa-core:**
- Static imports at top (32 `import` statements): framework discovery, workspace/registry/meta utilities, handoff runner, string utils, node:fs, node:path, node:os
- Dynamic `await import()` found in handlers for:
  - `node:child_process` — only when running `uninstall`
  - `node:fs` — only when running `doctor` / `help` (workspace detection)
  - `checkUpgradeAvailable` from `../src/commands/upgrade` — only when upgrade check is needed
- **Core command modules** (create, onboard, add, startup, update, upgrade) are imported **statically** at the top level, so they ALL load on every invocation regardless of subcommand.

---

## TUI/OpenCode CLI Help (Bun entry)

**Command:** `bun run --cwd <fw>/packages/opencode --conditions=browser src/index.ts --help`

| Run | Time (ms) | Exit Code |
|---|---|---|
| 1 (cold) | 1087.0 | 0 |
| 2 | 1031.4 | 0 |
| 3 | 1000.8 | 0 |
| 4 (warm) | 1039.1 | 0 |
| 5 (warm) | 1016.7 | 0 |
| 6 (warm) | 1033.5 | 0 |

**Average: ~1035ms**

No significant cold/warm difference — bun's module cache is persistent across runs (bun install/cache is already populated from install).

**Lazy loading in opencode/TUI:**
- Static imports at entry (31 `import` statements): loads **all** command class definitions (AcpCommand, AgentCommand, RunCommand, ServeCommand, DbCommand, etc.), yargs, UI, Heap, error utilities, and `@opencode-ai/core/installation/version`
- Heavy modules are **dynamically imported only when a command is actually invoked**:
  - `Server` from `@/server/server` — only for `serve`, `generate`, `web`, `acp`, `run`
  - `Agent` from `@/agent/agent` — only for `run`, `agent`
  - `Config` from `@/config/config` — only for `debug`, `run` (network options)
  - `TuiConfig` from `@/config/tui` — only for `attach`, `tui`
  - `InstanceRef` from `@/effect/instance-ref` — only for `effect`, `run`, `agent`
  - `TUI runtime` (layer, plugin host) — only for `attach`, `tui` (the full TUI)
  - `prettier` — only for `generate`
  - `runMini`, `runInteractiveMode`, `toolInlineInfo` — only for `run`
- **Effect pattern**: `yield* Effect.promise(() => import(...))` — lazy load via Effect's runtime

---

## TUI Full Launch (no args, interactive)

**Command:** `bun run --cwd <fw>/packages/opencode --conditions=browser src/index.ts`

All 3 runs timed out at 3 seconds (process kept running — TUI was alive). The TUI launched but was killed after the timeout. This means:
- TUI loads additional runtime modules (TUI layer, SolidJS components, OpenTUI terminal rendering, etc.) dynamically after the initial CLI entry
- The full startup includes: bun startup (~14ms) + static import loading + yargs CLI bootstrap + TUI runtime dynamic import chain + SolidJS component mounting + OpenTUI terminal renderer init

---

## Analysis

### CLI help path (most used)
| Path | Time | Architecture |
|---|---|---|
| `spinosa --help` | ~37ms | Bash shim (fails silently, exit 2) |
| `spinosa version` | ~37ms | Bash shim, works correctly |
| `spinosa cli --help` | ~37ms (bash) or ~580ms (TypeScript) | Depends on routing — `--help` uses bash, actual CLI uses TS |

### TUI --help vs full TUI
| Scenario | Time | Modules Loaded |
|---|---|---|
| `--help` | ~1035ms | Static imports only (31 modules) |
| `no args (TUI launch)` | >3000ms | Static + dynamic TUI runtime + SolidJS + OpenTUI |

### Recommendations
1. **Fix bash `cmd_help` exit 2** — the bash CLI help should produce output. Currently outputs nothing with exit 2.
2. **`spinosa --help` is fast (~37ms)** for simple help, but only the TypeScript help has the actual content. Consider routing `--help` through the TypeScript entry for correctness.
3. **Lazy loading is well implemented** in opencode/TUI via `Effect.promise(() => import(...))`. The ~1s `--help` time is dominated by bun module resolution for the 31 static imports, not the runtime.
4. **Heavy static imports** in opencode entry include all yargs command definitions (~20 commands) and the UI module. If `--help` only needs the command list, trimming unused static imports or tree-shaking could reduce startup.
