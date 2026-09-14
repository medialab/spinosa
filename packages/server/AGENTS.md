# Server Package Guide

`@spinosa/server` implements the V2 HTTP API. It wires `packages/protocol` endpoint groups to `@spinosa/kernel-core` Effect handlers. No business rules invented here — translate HTTP ↔ core services.

**Shipped with the product CLI.** The live kernel HttpApi mounts this V2 Effect stack under `/api/...` alongside the legacy V1 instance routes. TUI prompt submit defaults to the V1 conversation transport (opt into V2 `session.prompt` with `delivery: steer|queue` via `SPINOSA_SESSION_V2_PROMPT=1`). V1 routes remain for session create/list, shell/command, and compatibility.

## Entry points

- `src/api.ts` — `makeDefaultApi({ locationMiddleware, sessionLocationMiddleware })`
- `src/handlers.ts` — merges all handler layers
- `src/routes.ts` — route assembly
- `src/auth.ts`, `src/cors.ts`, `src/location.ts` — cross-cutting HTTP concerns

## Handler map

Each file in `src/handlers/` maps to a protocol group:

| Handler | Domain |
| ------- | ------ |
| `session.ts` | Sessions, prompts, execution |
| `message.ts` | Messages, parts |
| `model.ts`, `provider.ts` | Model catalog, providers |
| `permission.ts` | Permission requests |
| `agent.ts` | Agent config |
| `event.ts` | Server-sent events |
| `fs.ts` | Filesystem operations |
| `command.ts`, `skill.ts` | Commands and skills |
| `pty.ts` | PTY tickets and streams |
| `question.ts`, `reference.ts` | Questions, references |
| `location.ts` | Workspace/location context |
| `integration.ts`, `credential.ts` | Integrations, credentials |
| `project-copy.ts` | Project copy |
| `health.ts` | Health checks |

Middleware: `src/middleware/authorization.ts`, `session-location.ts`, `schema-error.ts`

## Adding or changing an endpoint

1. **Schema** — add/update types in `packages/schema` (see `packages/schema/AGENTS.md`)
2. **Protocol** — add endpoint to matching `packages/protocol/src/groups/*.ts`
3. **Handler** — implement in `src/handlers/` calling core services
4. **SDK** — regenerate via `@spinosa/sdk` tooling when the wire contract changes (never hand-edit generated clients)
5. **Tests** — handler tests in this package; core logic tests in `packages/core`

Dependency direction: `schema ← protocol ← server → core`. Server imports core; core never imports server.

## Running the server

No standalone `bun dev` in this package. The shipped headless API is `spinosa serve` from `packages/spinosa-kernel`. Integration tests compose layers from `packages/core` + this package.

## Checks

```bash
cd packages/server
bun typecheck
```

## V1 vs V2

Live V1 HttpApi lives in `packages/spinosa-kernel/src/server/routes/instance/httpapi/` (separate stack). V2 `/api/...` handlers from this package are mounted by the kernel server and are the default TUI prompt path. Prefer additive V2 contracts; keep V1 for surfaces not yet cut over (shell, command, some list/sync).

## Related docs

- `packages/protocol/AGENTS.md` — HttpApi groups, middleware placement
- `packages/sdk/AGENTS.md` — client SDK
- `packages/core/AGENTS.md` — domain services handlers call into
- `packages/spinosa-kernel/AGENTS.md` — shipped CLI and V1 server
