# Core Package Guide

`@spinosa/kernel-core` is the V2 domain layer: sessions, tools, providers, SQLite persistence, Effect services. No HTTP routes here — those live in `packages/server`.

Database schema (Drizzle) and migrations also live in this package (`src/database/`).

## Entry and layers

- `src/effect/layer-node.ts`, `src/effect/app-node.ts` — assemble Effect layers for Node
- `src/effect/app-node-builder.ts` — layer builder used by CLI/TUI hosts
- `src/session/runner/index.ts` — session runner export
- `src/system-context/index.ts` — system context algebra + builtins
- Package exports: `./*` wildcard over `src/*.ts` plus conditional `#sqlite`, `#pty`, `#fff` (bun/node splits)

Read root `AGENTS.md` **V2 Session Core** section before editing session execution.

## Source map

```txt
src/
  session/
    execution/          SessionExecution, drain scheduling
    runner/             provider turns, tool settlement
    store/              durable session state
    prompt/             admission, promotion, delivery modes
    history/            projected conversation
    compaction/         context epoch boundaries
    run-coordinator/    process-local drain joining
  tool/                 registry, builtins — see src/tool/AGENTS.md
  database/             SQLite, schema.sql.ts, migration/
  config/               agent, provider, command, formatter modules
  plugin/               plugin host, provider adapters
  system-context/       context sources, registry, builtins
  pty/                  PTY protocol (bun/node split)
  project/              project bootstrap, InstanceState
  permission/           permission V2
  credential/           stored credentials
  effect/               runtime helpers, InstanceState, makeRuntime
  v1/                   legacy compatibility — avoid new dependencies here
  github-copilot/       Copilot provider integration
```

## Module conventions

Follow `packages/spinosa-kernel/AGENTS.md` module shape:

- Flat top-level exports + `export * as Foo from "./foo"` self-reexport
- No `export namespace Foo` blocks
- Multi-sibling dirs (`session/`, `config/`) — no barrel `index.ts`; import specific siblings
- `src/config` — self-export pattern at top when adding modules

Effect rules: `makeRuntime` for services, `InstanceState` for per-directory state, `EffectBridge` for native callbacks. See `packages/spinosa-kernel/AGENTS.md` and `specs/effect/migration.md`.

## Session V2 invariants (short)

- `SessionV2.prompt` admits durable input; `SessionExecution.wake` schedules drains
- One `llm.stream(request)` per provider turn (in runner, via `@spinosa/llm`)
- Tool registry and permissions are Location-scoped
- System context in `src/system-context`; context sources stay with observed domains
- Turn snapshots freeze tools/system/model for the in-flight turn; save points refresh after each successful turn (and before compaction) so mid-run setters apply next turn (`session/loop-control.ts`)
- Runner hooks: `prepareNextTurn` (auto-compaction), `shouldStopAfterTurn` (terminate / max-steps), `beforeToolCall` (skip before Permission.ask)
- Structural ops (switchModel / switchAgent / compact) reject with `BusyRejection` while execution is active
- `SessionExecutionStatus` reports busy/idle for the public `session.status` contract (kernel bridges to `SessionStatus`)
- Do not bridge through legacy `SessionPrompt.loop` for new features — TUI defaults to the V1 conversation transport (`SPINOSA_SESSION_V2_PROMPT=1` opts into the V2 prompt); with V2 on, mid-run Enter queues, Steer on the queued message (or `prompt.submit_queue` / `<leader>return`) steers immediately

Full spec: `specs/v2/session.md`, vocabulary: root `CONTEXT.md`.

## Database

- Schema: `src/database/schema.sql.ts` and related `*.sql.ts` files
- Migrations: `src/database/migration/`
- Commands: `bun run db`, `bun run migration` from this package
- Schema authority lives here (not in the kernel CLI package)

## Tests

```bash
cd packages/core
bun test
bun typecheck
```

Never run tests from repo root. Use `testEffect` from test helpers for layered tests.

## Dependency boundaries

| May import | Must not import |
| ---------- | --------------- |
| `@spinosa/schema`, `@spinosa/llm`, `@spinosa/plugin` | `@spinosa/server`, `@spinosa/tui` |
| `@spinosa/effect-drizzle-sqlite`, `@spinosa/effect-sqlite-node` | `packages/spinosa-kernel` (CLI/server host) |

## Nested docs

- `src/tool/AGENTS.md` — tool registry, registration, settlement (read before editing tools)

## Typical change paths

| Task | Start here |
| ---- | ---------- |
| New tool | `src/tool/` + `src/tool/AGENTS.md` |
| Session prompt/delivery | `src/session/prompt/` |
| Provider adapter | `src/plugin/` or `src/github-copilot/` |
| New config module | `src/config/` (self-export pattern) |
| Schema change | `@spinosa/schema` first, then core consumers |
| New API surface | `packages/protocol` → `packages/server` → handler in server |
