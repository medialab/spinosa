# Desktop parity audit

Source of truth: branch `spinosa-desktop-wiring` at `02e62207`
(`feat(app): wire V2 message paths and harden PTY directory transport`).
Base versions: Bun 1.3.14, Node v22.14.0, Electron 42.3.3.
Checkout note: the working tree carries another contributor's uncommitted
`jev` integration (35 dirty paths, `<<<<<<<` markers in 10 kernel/core
files, 4 untracked `jev` files). Desktop/app validation below was done from
a detached clean worktree at the recorded SHA plus owned patches only.

Status vocabulary: `source-verified` (read, not run), `fixture-tested`
(isolated test), `runtime-verified` (live bundle/app), `blocked` (with
owner/spec pointer). The user's reported starting state is NOT marked
verified anywhere below.

## Baseline gates (main checkout, at `02e62207`)

- `typecheck` for `app`, `session-ui`, `desktop`, `ui`: all exit 0.
- `packages/app test:unit`: 766 pass / 1 fail — the fail is the known
  pre-existing ICU case `desktop native locale detection > uses Unicode
  likely subtags for script-sensitive bundles`.
- `packages/session-ui test`: 83 pass / 0 fail.
- `packages/desktop bun test src`: 64 pass / 1 fail / 1 error — both the
  fail and the error are `src/main/draft-store.test.ts`, caused by this
  Bun's missing `node:sqlite` builtin (`No such built-in module`), not by
  desktop code. A fresh worktree at HEAD additionally fails
  `electron vite publicDir` because gitignored `packages/app/public/*`
  build output exists only in the main checkout.
- `bun run lint:deps`: clean (3760 modules).
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

UI gate (Task 1 fully closed only on pixels): the dialog's exact data
pipeline is `runtime-verified` headless against the live kernel (44/44,
§4–5 below) and the renderer `vite build` is clean; Electron pixel
observation stays pending — no display server in this environment.

Upstream report (kernel owner, NOT implemented here): guard the
`setReturnArrays` call in `packages/core/src/database/sqlite.node.ts`
(version-detect and map `Object.values` in column order, or equivalent).
Related read-only finding: `packages/core/src/global.ts validateSqliteFiles`
imports `bun:sqlite` in try/catch, so under Node every legacy-path SQLite
migration validates `false` → result `invalid`; same owner.

## Shared API boundary (§2) — implemented, fixture-tested, live-verified

- Envelopes `runtime-verified`: `legacy-api.ts unwrapEnvelope` strips exactly
  one transport layer — `{data,request,response}` → data (V2 success),
  `{error,...}` → throw (defensive; `throwOnError` throws first),
  legacy `{data,error}` preserved, `{stream}` single-key results extracted
  to the async iterable, domain payloads (incl. `{location,data}` bodies)
  untouched. All 46 tests in `server-compat.test.ts` pass; app suite
  766 pass with only the known ICU failure.
- Namespaces `runtime-verified` against a live kernel from source via
  `createCompatibleApi` over HTTP (live-check 44/44 PASS at `02e62207`):
  `provider.list/get` from the V1 full catalog mapped to flat legacy items
  (the V2 list is active-only and would hide unconnected providers);
  `model.list/default` (V1 `/provider` catalog preferred, V2 `/api/model`
  fallback; default honors `config.model`, else null); `agent.list` (V2,
  `name` synthesized from `id`); `integration.*` (get merges V1 methods
  as `v1:` ids live for openai + github-copilot; key dual-writes and flips
  both `config.providers` and `fetchActiveProviderIDs`; oauth start/
  status/complete/cancel with V1 `v1:` routing fixture-tested);
  `command.list` (V1 tree, legacy string-model shape); `reference.list`
  (V2, identical shapes); `mcp.list` (V1 status synthesized),
  `mcp.connect/disconnect` (server/location arg mapping),
  `mcp.resource.catalog` (low-level shared hey-api client to served
  `GET /experimental/resource`, the first generated-client gap).
   `session/project/file/vcs/pty/permission/question` stay on the V1-shim
   HTTP implementations for both protocols (served, legacy-correct), with
   two Step-4/5 corrections below. Receivers are explicit (never proxied
   class instances).
- Connected set `runtime-verified`: `fetchActiveProviderIDs` unions V1
  `GET /config/providers` (auth.json universe, failure propagates →
  all-on) with V2 `GET /api/integration` connections (failure → V1 set
  alone); `loadProvidersQuery` passes the union to
  `normalizeProviderList`, which no longer marks the whole catalog
  connected. Unit: both-leg union and V2-leg-failure degrade.
  `live-check` A/B workspaces isolate correctly.
- Stream `fixture-tested`: the adapter resolves subscriptions to the
  iterable; `server-sdk.tsx` awaits before `for-await`. Live SSE pending
  with the running app (§3–4).
- §4 message wiring (`02e62207`, `fixture-tested` + `runtime-verified`):
  `api.message` was `undefined` at runtime — the generated root client has
  no top-level `message` namespace, so `createServerSession` received an
  undefined `messageApi` and every V2 branch (`fetchMessages`,
  `fetchMessage`, `hydrateV2Message`) stayed dormant while the V1-root
  fallbacks carried the load. The facade now maps `message.list` →
  `v2.session.messages` (projected `{data, cursor}` pages) and
  `session.message` → `v2.session.message` (single projected message);
  `normalizeSessionMessages`/`projectV2` already consume that shape
  (including the newer `agent-switched`/`model-switched` variants). Unit:
  page + single-message routing. Live: create/get/root-list/message-page/
  missing-message-rejects/raw-`v2.session.list`/remove all pass.
  `session.create` now resolves its directory once and binds the client
  header to the same value as the body (V1 `Session.list` is scoped to the
  instance's project, so an ambient-bound client creating a body-directory
  session filed it under a project no directory-bound list returns).
- §5 PTY transport hardening (`02e62207`, `fixture-tested` +
  `runtime-verified`): `pty.create/get/update/remove` now send `?directory=`
  explicitly instead of relying on header-only transport on non-GET calls.
  Kernel-side header routing verified working (header/query/header+query
  all 200 on POST `/pty`); the observed failure was a probe fetch wrapper
  that replaced a passed `Request`'s headers. Unit: create/remove query
  assertions. Live: pty create/get/list/update/remove + `file.list/find`
  pass; V2 `/api/pty/{id}/connect` socket URL is served (source-verified
  against the generated surface).
- Dialog pipeline `runtime-verified` headless: the exact data path
  `dialog-connect-provider` renders (`provider.list` + `model.list` +
  `model.default` + `fetchActiveProviderIDs` → `normalizeProviderList` +
  per-provider `integration.get`) driven against the live kernel — 223
  catalog entries, openai connected post-dual-write with models attached,
  methods key + `v1:` oauth. Renderer `vite build` clean. Pixel observation
  of the Electron dialog still pending: no display server/`agent-browser`
  in this environment, so the Task 1 UI gate stays open on pixels only.
- Directory defaults `fixture-tested` + live A/B: explicit location >
  bound workspace > ambient home; `createDirSdkContext` builds a
  directory-bound adapted facade instead of reusing the global one.
- No consumed method relies on an unimplemented cast (verified by usage
  inventory): `integration.command.*` and `wellknown.add` have no app
  consumers and stay unmapped.
- Catalog warmth finding: `/api/model` (and agent/integration lists) return
  partial/empty arrays while the models.dev catalog loads asynchronously
  (0 → 32 → 7987 across identical calls); success-shaped empties do NOT
  trigger query retries. Connect flows must tolerate cold catalogs (§3).
- Upstream notes (kernel owner): `sqlite.node.ts setReturnArrays` (Task 1),
  `validateSqliteFiles` bun-only import, `Experimental`/`V2.config` missing
  generated methods (`experimental.resource.list`, `v2.config.providers`).

## Feature matrix (all rows: not yet verified unless noted)

| Surface | UI entrypoint | App method | SDK method | HTTP | Dir behavior | Events | Status | Next |
|---|---|---|---|---|---|---|---|---|
| Provider catalog | `dialog-connect-provider`, `use-providers`, bootstrap | compat `provider.list/model.list/model.default` + `fetchActiveProviderIDs` | V1 `GET /provider`, V1 `GET /provider/auth` (merged), V2 `/api/model` fallback, `/config/providers` + `/api/integration` union | bound default, explicit wins (A/B live) | `integration.connection.updated` | facade `runtime-verified` (live-check 44/44 headless dialog pipeline), pixels pending | §3 |
| Key connect | `dialog-connect-provider` | compat `integration.connect.key` dual-write | `.v2.integration.connect.key` then V1 `auth.set` | `POST /api/integration/{id}/connect/key` + `PUT /auth/{id}` | V2 first (400 surfaces before auth.json), then V1; no dispose | refresh; V1 leg flips `config.providers`, V2 leg flips SQLite connections | `fixture-tested` + `runtime-verified` (live dual-write flips active/config.providers) | §3 |
| OAuth connect/status/complete | same dialog | compat `integration.oauth.*` routes on `v1:` prefix | V2: `.v2.integration.connect.oauth`/`.attempt.*`; V1: `provider.oauth.authorize/callback` | V2: `/api/integration/...`; V1: `POST /provider/{id}/oauth/authorize|callback` | V1 attemptID = `v1:{integrationID}:{method}`; no dispose (kernel reloads) | same | `fixture-tested` (unit: authorize/callback/cancel routing) + method merge live | §3 |
| Method merge (dialog methods) | `dialog-connect-provider` methods memo | `integration.get` | V2 `.v2.integration.get` ∥ V1 `provider.auth` | `/api/integration/{id}` + `/provider/auth` | V1 oauth → `id: v1:{index}` wins label dups; V1 api dropped when V2 key exists | — | `fixture-tested` + `runtime-verified` (openai + github-copilot `v1:` oauth live) | §3 |
| Connected set (union) | bootstrap `loadProvidersQuery` | `fetchActiveProviderIDs` | V1 `GET /config/providers` ∪ V2 `GET /api/integration` connections | V1 fail propagates → all-on; V2 fail → V1 set alone | directory headers on both legs | — | `fixture-tested` + `runtime-verified` | §3 |
| V1 catalog models | model selector | `model.list`/`model.default` | V1 `GET /provider` models → `toLegacyV1Model`, empty → V2 `/api/model` | V1 full catalog (223 providers, kernel Model shape) | bound directory | — | `fixture-tested` (mapping incl. release_date/cost/capabilities) + live fallback | §3 |
| Sessions list/create/message | home, tabs, session views | compat `session.*` (V1 shim) + V2 `message.list`/`session.message` | root `Session2.*`, V2 `Session3.messages/message` | `/session*`, `/api/session*` | explicit+ambient; create binds header=body | `session.*.delta` stream | facade `runtime-verified` (live create/get/root-list/V2 page/missing-rejects/remove) | §4 closed |
| Agents/models | agents panel, model selector | `sdk` list queries | `Agent.list`, `Model.*` | `/agent`, `/api/model` | bound directory | — | `runtime-verified` (live lists) | §5 closed |
| MCP | mcp dialogs | compat passthrough | root `Mcp.*` | `/mcp`, `/experimental/resource` | bound directory | — | list + resource catalog `runtime-verified`; connect/disconnect untested (no server configured) | §5 partial |
| Terminal/PTY | terminal panel | compat `pty.*` (V1 root methods + explicit `?directory=`) | root `Pty.*`, V2 `Pty2` socket | `/pty`, `/api/pty` | explicit directory | socket (`/api/pty/{id}/connect` served) | `runtime-verified` (live create/get/list/update/remove; `file.list/find` live) | §5 closed |
| Permissions/questions | docks | compat `permission.reply`, `question.*` | root + `Permission3/Question3` | tbd | tbd | `permission/question.v2.*` | `source-verified` (adapter exists) | §5 open |
| Files/find/refs/commands | palettes, browser | compat `file.*` (V1 shim), V2 `reference`, V1 `command` tree | root `File/Find`, V2 `Reference`, V1 `Command` | `/file`, `/find`, `/api/reference`, `/command` | bound directory | — | `runtime-verified` (file list/find, reference, command lists live) | §5 closed |
| Onboarding (11 steps) | TUI route only | — | — | — | — | — | triaged: no app consumer references it; absent by design, no wiring | §6 |
| Add-files/import | TUI route only | — | — | — | — | — | triaged: same as onboarding | §6 |
| Visualizer | TUI route only | — | — | — | — | — | triaged: same as onboarding | §6 |
| Doctor/upgrade/preflight | TUI route only | — | — | — | — | — | triaged: same as onboarding | §6 |
| Markdown→PDF export | TUI route only | — | — | — | — | — | triaged: same as onboarding | §6 |
| Workspace registry | TUI route only | — | — | — | — | — | triaged: same as onboarding | §6 |

### Dual auth-universe findings (isolated live matrix, isolated homes)

- V1 universe: kernel `Auth.Service` → auth.json. Feeds `/config/providers`,
  V1 `/provider.connected`, V1 session LLM (`spinosa-kernel/src/session/llm.ts`
  `auth.get`), desktop conversation path (V1 loop → auth.json).
  `control.authSet` = `auth.set` + `provider.reload()` (`PUT /auth/:id`).
- V2 universe: core `Credential.Service` → SQLite `credential` table. Feeds
  `Catalog.available()` → `/api/model` and the V2 session runner.
- **No bridge**: no credential-read API, no auth.json mirror, V1 LLM never
  reads SQLite; `Catalog.available()` never reads auth.json. Each universe
  alone is incomplete (V2 key → models 93/61 openai but config_active
  unchanged; V1 auth → config_active + v1_connected but anthropic_models 0).
  Dual-write (the facade) is required for key connect to wire chat + model
  list together.
- OAuth routing: V1 authorize/callback when a V1 oauth method exists
  (writes auth.json → chat + connected ✓); V2 attempt only otherwise.
  `opencode` device oauth is V2-only (zen already config_active by default;
  chat through V1 stays a documented gap when the method is V2-only).
- V1 `GET /provider/auth` non-empty for: `openai` (oauth + api),
  `github-copilot`, `gitlab`, `poe`, `cloudflare-workers-ai`,
  `cloudflare-ai-gateway`, `azure`, `digitalocean`, `snowflake-cortex`,
  `xai`. **No `opencode` entry.** V2 oauth methods: only `openai`
  (`chatgpt-browser`, `chatgpt-headless`) and `opencode` (device).
- Kernel gaps to report upstream (not fixed here): `Catalog.available()`
  ignores auth.json; V1 session LLM ignores SQLite credentials; no OAuth
  token readback API; opencode-device oauth is V2-only (chat gap).

## Packaging (§7) — not started

Three layers to validate on a clean candidate worktree: plain-Node bundle
(done for Task 1), electron-vite utility-process sidecar, unpacked
electron-builder app. Local-only unsigned override for notarization; no
publish/tags/releases. Excluded: updater feed, artwork, translator review.
