# Kernel endpoint gaps for desktop wiring

This is an upstream handoff, not a kernel implementation. Desktop-owned code
must remain defensive, but the fixes below require changes in the kernel/core
boundary or regenerated protocol surface.

## 1. Mixed-protocol message projection and terminal event

Observed in the Electron utility-process sidecar on 2026-09-23:

- `POST /session/:id/prompt_async` returns `204` and the desktop renders the
  optimistic user message.
- In an isolated packaged replay with a local OpenAI-compatible mock, V1
  `GET /session/:id/message` returned both the user message and assistant
  `pong`; V2 `GET /api/session/:id/message` returned an empty page. The session
  was idle, and no terminal execution event reached the desktop.
- The same model/prompt succeeds through the plain-Node backend. This replay
  proves V1 persistence in the tested path; the earlier claim that the V1
  message list was empty was based on reading the V2 projection and was
  incorrect.

The confirmed boundary is that the desktop admits prompts through the V1
runner while its protocol detector can select V2 message reads. The desktop
now pairs those operations with the V1 message projection and refreshes it
when session status becomes idle. Whether the V2 message API should include V1
prompt data is an API-contract decision, not evidence of failed V1 persistence.

### Required kernel investigation

1. Decide and document whether V2 message APIs must project V1 prompt data, or
   whether clients must keep prompt submission and message reads on one
   protocol until a complete V2 cutover.
2. Publish a terminal success, failure, or interrupted event for every prompt
   loop exit, including the no-op/early-exit path. The tested V1 path returned
   idle status without a terminal event; desktop status polling is defensive
   reconciliation, not a substitute for a documented event contract.
3. Add a regression covering V1 `prompt_async` followed by both V1 and V2
   message reads, plus the expected terminal event and idle status. Do not log
   prompt contents or credentials.

## 2. PTY WebSocket close hardening

Observed on 2026-09-23:

- A direct Bun WebSocket probe against the V1 `/pty/:id/connect` route caused
  the running sidecar to terminate after the client closed, with an unhandled
  `read ECONNRESET` in the server process.
- A separate isolated Node sidecar accepted PTY input, replayed its cursor
  frame, returned terminal echo and command output, stayed healthy after a
  normal `ws` close, and was then disposed cleanly.

The evidence narrows the failure to an abrupt/client-specific socket-close
boundary, but does not establish that every WebSocket close reproduces it. No
kernel or core code is changed in the desktop migration.

### Required kernel investigation

1. Treat peer-reset/abrupt-close errors as connection teardown, not process-
   fatal errors, at every WebSocket adapter boundary.
2. Preserve PTY attachment cleanup when the peer resets before or during
   replay, input, or output delivery.
3. Add a regression fixture that covers cursor replay, text input, normal close,
   abrupt close, and a health check proving the sidecar remains alive.

## 3. PTY WebSocket auth fallback

Observed on 2026-09-23:

- The packaged sidecar returned 401 for the V1
  `/pty/:id/connect?...&auth_token=...` fallback used when no connect ticket is
  available.
- The same sidecar issued a connect ticket with the authenticated
  `x-opencode-ticket` request and the packaged renderer connected successfully
  with that ticket.

The desktop's ticket-first path is therefore verified, but its retained V1
no-ticket fallback is not compatible with the current server auth middleware.

### Required kernel/API decision

1. Either accept the documented `auth_token` query credential on the V1 PTY
   upgrade route, or remove/deprecate that fallback in the generated client
   contract.
2. Keep the ticket path origin/CSRF checks intact; do not solve this by making
   an authenticated PTY upgrade unauthenticated.
3. Add a fixture covering ticket success and the chosen no-ticket behavior.

## 4. Credential-universe bridge

V2 stored credentials live in SQLite while the V1 session runner reads
`auth.json`. There is no kernel bridge or credential readback contract. The
desktop therefore dual-writes key connections and gates the runnable provider
set on V1 `/config/providers`; this is intentionally temporary.

### Required kernel/API work

- Decide whether V1 execution should read V2 credentials, or whether V2
  execution becomes the desktop default.
- Expose one authoritative connected/runnable-provider endpoint with explicit
  directory/workspace scope.
- Make disconnect remove the authoritative credential and invalidate any
  provider/model cache derived from it.
- Add OAuth token readback/availability semantics without exposing secrets.
- Resolve V2-only OAuth providers (currently including the device flow) for
  the desktop conversation path.

## 5. Generated endpoint surface

Regenerate or explicitly document the protocol/client surface for endpoints
already served but absent from the generated root client, including:

- `GET /experimental/resource`;
- V2 config/provider availability where the server exposes it;
- the execution terminal event/status contract described above.

Each endpoint needs a location/workspace parameter contract and a fixture
against the plain-Node and Electron utility-process servers.

## Acceptance criteria

- A prompt admitted through `prompt_async` is readable in its V1 message
  projection in both server runtimes; mixed V1/V2 read behavior is documented.
- Every execution reaches exactly one terminal event and idle status, even on
  early exit, provider failure, cancellation, or interruption.
- Provider/model availability has one documented credential universe and
  directory scope; V2-only credentials cannot silently produce a V1
  `ModelNotFound`.
- Generated client types and server routes agree for every desktop-consumed
  endpoint.
