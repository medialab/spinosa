# TUI Performance Remediation

## Execution Directive (Standard)

Implement the confirmed findings from the TUI performance report non-destructively on `codex/tui-performance-fixes`. Validate each recommendation against current OpenTUI and Solid behavior, preserve existing user changes, add focused proof, and keep the maintained TUI and Spinosa suites green.

## Metadata

- Created: 2026-07-11
- Scope: startup, rendering, streaming, state, filesystem/logging, network, module loading, and observability
- Input sources: performance report, current source, OpenTUI/Solid/Bun references, tests and typechecks
- Constraints: shippable behavior, no destructive migration, no speculative compatibility fallbacks
- Skill references to invoke (global):
  - `skills/coding/SKILL.md`
  - `skills/coding/references/refactoring/workpackage-execution-directive.md`
  - `skills/coding/references/code-smells/smells/index.md`
  - `skills/coding/references/code-smells/smells/codex-code-smell.md`
  - OpenTUI renderer, Solid, and testing references

## Background

The report summarizes 157 claimed bottlenecks but provides detailed evidence only for the top 20 and quick wins. Several recommendations conflict with current library semantics or require measurement before adoption. Each detailed claim receives a confirmed/stale/unsafe/not-actionable disposition.

## Overarching goals

- Remove confirmed startup and hot-path stalls.
- Coalesce streaming work without delaying correctness-critical events.
- Eliminate synchronous filesystem work from interactive paths where safe.
- Add measurable performance primitives and regression coverage.
- Preserve route, session, plugin, and Spinosa behavior.

## Non-goals

- Rewriting the renderer, replacing Solid, or introducing speculative architecture with no measured benefit.
- Treating aggregate dimension counts without file-level evidence as individual actionable defects.

| WP ID | Status | Last updated | Proof / validation pointer | Next action |
|---|---|---|---|---|
| WP-01 | In Progress 2026-07-11 | 2026-07-11 | Startup/app lifecycle tests | Validate startup gates |
| WP-02 | Todo | 2026-07-11 | Streaming/session tests | Inspect hot render paths |
| WP-03 | Todo | 2026-07-11 | I/O/logging tests | Remove confirmed sync I/O |
| WP-04 | Todo | 2026-07-11 | SDK/module/metrics tests | Validate network and loading claims |
| WP-05 | Todo | 2026-07-11 | Finding disposition | Close every supplied claim |

### WP-01 Startup and provider gates [Status: In Progress 2026-07-11]

- Issue: theme detection, plugin readiness, context readiness, and bootstrap calls may delay first useful paint.
- Needs: identify which gates are correctness-critical and which can become progressive.
- How: measure/order current startup, render a safe shell immediately, and gate only consumers requiring loaded state.
- Why this approach: reduces latency without exposing providers before their invariants hold.
- Recommendation rationale: coding rules 1, 8, 11; Default hard cutover; targets long method and shotgun surgery; global references above.
- Desired outcome: immediate safe first frame and unchanged eventual readiness.
- Skill references to invoke: global references above.
- Non-destructive tests: app lifecycle, route E2E, provider readiness.

### WP-02 Streaming and session rendering [Status: Todo]

- Issue: token deltas and transcript-derived layouts may cause repeated allocations and render work.
- Needs: coalescing at the event boundary, bounded rendering work, and proof that order/content remain exact.
- How: buffer compatible deltas, use OpenTUI-supported culling/live-render primitives, and remove redundant computation only when measured by tests.
- Why this approach: fixes shared hot primitives instead of handler-by-handler micro-optimizations.
- Recommendation rationale: coding rules 1, 8, 11; Default hard cutover; targets long method and data clumps; global references above.
- Desired outcome: fewer store writes/renders with byte-identical streamed content.
- Skill references to invoke: global references above.
- Non-destructive tests: sync hydration/event ordering and session render tests.

### WP-03 Filesystem and logging [Status: Todo]

- Issue: interactive validation and logging perform synchronous filesystem work.
- Needs: async validation and queued/batched logging with durable flush/rotation semantics.
- How: move I/O out of render/input handlers, cache stable paths, and serialize log writes.
- Why this approach: removes main-thread stalls at shared boundaries.
- Recommendation rationale: coding rules 2, 8, 9, 11; Default hard cutover; target duplicate code; global references above.
- Desired outcome: no blocking filesystem scans on hot UI events and no lost ordered logs.
- Skill references to invoke: global references above.
- Non-destructive tests: wizard edge cases and logging tests.

### WP-04 Network, modules, and metrics [Status: Todo]

- Issue: requests, eager imports, and missing timing evidence may hide latency or hangs.
- Needs: distinguish finite requests from streams, remove confirmed eager heavy imports, and expose low-overhead timing hooks.
- How: apply scoped timeouts only where contracts permit, deep-import heavy features, and instrument startup/sync/stream batches.
- Why this approach: avoids breaking long-lived connections while making real latency observable.
- Recommendation rationale: coding rules 1, 8, 9, 11; Default hard cutover; target inappropriate intimacy; global references above.
- Desired outcome: bounded finite operations, smaller eager graph, and testable timing evidence.
- Skill references to invoke: global references above.
- Non-destructive tests: SDK client, import graph, and metrics tests.

### WP-05 Audit closure and release proof [Status: Todo]

- Issue: aggregate report counts exceed the supplied file-level evidence and some recommendations are framework misconceptions.
- Needs: a disposition for each detailed top-20/quick-win claim and explicit scope note for unsupported aggregate counts.
- How: record confirmed fixes, stale claims, unsafe proposals, duplicates, and measured no-ops; run the full release-relevant checks.
- Why this approach: makes completion falsifiable without inventing missing findings.
- Recommendation rationale: coding rules 1, 5, 9; Default hard cutover; target speculative generality; global references above.
- Desired outcome: shippable diff with complete evidence for every supplied actionable claim.
- Skill references to invoke: global references above.
- Non-destructive tests: targeted tests, full TUI, Spinosa verifier, typechecks, diff check.
