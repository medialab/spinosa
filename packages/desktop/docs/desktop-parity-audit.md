# Desktop parity audit

Source of truth: branch `spinosa-desktop-wiring` at `80697495`
(`fix(desktop): bundle jsonc-parser ESM into sidecar server`).
Base versions: Bun 1.3.14, Node v22.14.0, Electron 42.3.3.
Checkout note: the working tree carries another contributor's uncommitted
`jev` integration (35 dirty paths, `<<<<<<<` markers in 10 kernel/core
files, 4 untracked `jev` files). Desktop/app validation below was done from
a detached clean worktree at the recorded SHA plus owned patches only.

Status vocabulary: `source-verified` (read, not run), `fixture-tested`
(isolated test), `runtime-verified` (live bundle/app), `blocked` (with
owner/spec pointer). The user's reported starting state is NOT marked
verified anywhere below.

## Baseline gates (main checkout, pre-change)

- `typecheck` for `app`, `session-ui`, `desktop`, `ui`: all exit 0.
- `packages/app test:unit`: 724 pass / 1 fail — the fail is the known
  pre-existing ICU case `desktop native locale detection > uses Unicode
  likely subtags for script-sensitive bundles`.
- `packages/session-ui test`: 83 pass / 0 fail.
- `packages/desktop bun test src`: 64 pass / 1 fail / 1 error — both the
  fail and the error are `src/main/draft-store.test.ts`, caused by this
  Bun's missing `node:sqlite` builtin (`No such built-in module`), not by
  desktop code. A fresh worktree at HEAD additionally fails
  `electron vite publicDir` because gitignored `packages/app/public/*`
  build output exists only in the main checkout.
- `bun run lint:deps`: clean (3759 modules).
- Investigation ZIP from the brief is absent from this environment; fixtures
  below were reconstructed from source.

## Task 1 — plain-Node catalog 500s (backend gate: CLOSED)

Symptom: under the plain-Node sidecar bundle, `/provider`,
`/provider/auth`, `/agent`, `/command`, `/config`, `/api/model`,
`/api/provider` (and `/session`, `/project`) returned 500 `UnknownError`
while `/global/health` and `/api/health` passed. `runtime-verified`.

Root cause (`source-verified` + `runtime-verified`): NOT jsonc-parser, NOT
models.dev fetch (200 under node), NOT CJS interop. The error boundary
(`spinosa-kernel/.../httpapi/middleware/error.ts`) logged
`TypeError: statement2.setReturnArrays is not a function` at
`Project.fromDirectory` → `InstanceStore.boot`. The kernel's Node SQLite
driver (`packages/core/src/database/sqlite.node.ts:75`) calls the
`bun:sqlite`-only `Statement.setReturnArrays`; `node:sqlite` `StatementSync`
has no such method (verified absent on Node v22.14.0; `setReadBigInts`
exists). Bun never hits this because the `#sqlite` package-conditional
selects `sqlite.bun.ts` under Bun. Every workspace-routed request boots an
instance, so every instance route 500s; health routes skip instance boot.

Fix (desktop-owned, kernel untouched): `packages/desktop/scripts/` —
`sqlite-node-shim.ts` + `sqlite-array-mode.ts`, aliased over `node:sqlite`
by `build-server.ts` (importer-aware so the shim's own builtin import stays
external). The shim re-exports the builtin by name (`export *` from an
external breaks Bun's ESM output: dangling `node_sqlite` namespace) and
supplies array mode on `prepare()` statements (own data properties, never a
`Proxy`: native getters/internal slots reject proxied receivers with
`Illegal invocation`). Native `setReturnArrays`, when present, passes
through. Hypothesis ledger: jsonc ESM alias retained (harmless, not the
cause); externals `@lydell/node-pty`/`@aws-sdk/client-s3` must sit next to
the bundle (probe symlinks them; Task 7 verifies packaging).

Verification (`runtime-verified`): `packages/desktop/scripts/probe-server.mjs`
(12-path matrix, isolated temp HOME/config/data/state/cache/workspace, no
inherited credentials, loopback, deadlines, nonzero exit on failure) returns
12/12 200 under plain node against the clean-worktree bundle: 223
integrations, 7986 models, 7 agents, full provider catalog + auth methods,
session/project/config/command reads, clean instance disposal.

Regression (`fixture-tested`): `scripts/sqlite-array-mode.test.ts`, 5/5 —
native passthrough, default object mode, array mapping for `all`/`get`/
`iterate`, flag-off restore, null/empty handling.

UI gate (Task 1 fully closed only when observed): the running Electron
provider dialog must show the controlled catalog — pending shared-client
fixes (§2–3).

Upstream report (kernel owner, NOT implemented here): guard the
`setReturnArrays` call in `packages/core/src/database/sqlite.node.ts`
(version-detect and map `Object.values` in column order, or equivalent).
Related read-only finding: `packages/core/src/global.ts validateSqliteFiles`
imports `bun:sqlite` in try/catch, so under Node every legacy-path SQLite
migration validates `false` → result `invalid`; same owner.

## Shared API boundary (§2) — in progress

- `packages/app/src/utils/legacy-api.ts` unwraps only `{data, error}`
  envelopes. The generated hey-api client (`packages/sdk/src/v2/gen/client/
  client.gen.ts`) resolves `{data, request, response}` on success and
  `{error, request, response}` on non-throwing failure (`throwOnError: true`
  throws instead). `source-verified`: V2 calls through the adapter return
  whole envelopes, not bare data.
- Namespace mismatch `source-verified`: generated root client exposes V1
  namespaces plus `.v2` (`integration.connect.key/oauth`,
  `integration.attempt.cancel/status/complete`, ...); the app consumes
  `integration.oauth.connect/status/complete` and `integration.connect.key`.
  `createApiForServer` casts without mapping; the V1 shim in
  `server-compat.ts` is shape-only for the selected V2 implementation.
- Stream `source-verified`: `sse.get` resolves `{stream: AsyncGenerator}`
  (`gen/core/serverSentEvents.gen.ts`); the adapter wraps results in a
  `Promise`, so `for await` in `context/server-sdk.tsx:282` iterates a
  `Promise`. Boundary must preserve an async iterable (or the consumer must
  await + extract).
- Directory defaults `source-verified`: `createDirSdkContext` passes the
  ambient-bound `currentApi` as `current`; explicit `location` args work but
  default isolation is not established. Test plan: workspaces A/B + distinct
  home, precedence explicit > bound > ambient.
- Catalog path note `source-verified`: `global-sync/bootstrap.ts`
  `loadProvidersQuery` calls the RAW sdk (`sdk.provider.list(location)` with
  a nested `{location:{directory}}` arg the generated root `Provider.list`
  does not declare — it takes flat `{directory, workspace}`), bypassing the
  adapter; ambient `x-spinosa-directory` header currently masks the shape
  error for the global query. Per-directory provider queries need the flat
  shape.

## Feature matrix (all rows: not yet verified unless noted)

| Surface | UI entrypoint | App method | SDK method | HTTP | Dir behavior | Events | Status | Next |
|---|---|---|---|---|---|---|---|---|
| Provider catalog | `dialog-connect-provider`, `use-providers`, bootstrap | `sdk.provider.list/model.list/model.default` | root `Provider.list`, `Model.list/default` | `GET /provider`, `/api/model` | ambient (arg shape wrong) | `integration.connection.updated` | backend `runtime-verified`, UI pending | §2–3 |
| Key connect | `dialog-connect-provider` | compat `integration.connect.key` | `.v2.integration.connect.key` | `POST /api/integration/{id}/connect/key` | mapped | refresh+dispose (verify!) | `source-verified` | §3 |
| OAuth connect/status/complete | same dialog | compat `integration.oauth.*` | `.v2.integration.connect.oauth`, `.attempt.*` | `POST/GET /api/integration/...` | mapped | same | `source-verified` | §3 |
| Sessions list/create/message | home, tabs, session views | compat `session.*` (V1 shim impls call raw V1 root methods) | root `Session2.*` | `/session*` | explicit+ambient | `session.*.delta` stream | `source-verified` | §4 |
| Agents/models | agents panel, model selector | `sdk` list queries | `Agent.list`, `Model.*` | `/agent`, `/api/model` | tbd | — | probe 200 only | §5 |
| MCP | mcp dialogs | compat passthrough | root `Mcp.*` | tbd | tbd | — | todo | §5 |
| Terminal/PTY | terminal panel | compat `pty.*` (V1 root methods) | root `Pty.*` + `Pty2` | tbd | tbd | socket | todo | §5 |
| Permissions/questions | docks | compat `permission.reply`, `question.*` | root + `Permission3/Question3` | tbd | tbd | `permission/question.v2.*` | `source-verified` (adapter exists) | §5 |
| Files/find/refs/commands | palettes, browser | compat `file.*`, passthrough | root `File/Find/Reference/Command` | tbd | tbd | — | todo | §5 |
| Onboarding (11 steps) | TUI route only | — | — | gap suspected | — | — | todo | §6 |
| Add-files/import | TUI route only | — | — | gap suspected | — | — | todo | §6 |
| Visualizer | TUI route only | — | — | gap suspected | — | — | todo | §6 |
| Doctor/upgrade/preflight | TUI route only | — | — | gap suspected | — | — | todo | §6 |
| Markdown→PDF export | TUI route only | — | — | gap suspected | — | — | todo | §6 |
| Workspace registry | TUI route only | — | — | gap suspected | — | — | todo | §6 |

## Packaging (§7) — not started

Three layers to validate on a clean candidate worktree: plain-Node bundle
(done for Task 1), electron-vite utility-process sidecar, unpacked
electron-builder app. Local-only unsigned override for notarization; no
publish/tags/releases. Excluded: updater feed, artwork, translator review.
