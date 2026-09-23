# Kernel endpoint gaps for desktop wiring

This is an upstream handoff, not a kernel implementation. Desktop-owned code
must remain defensive, but the fixes below require changes in the kernel/core
boundary or regenerated protocol surface.

## 1. V1 prompt persistence barrier and terminal event

Observed in the Electron utility-process sidecar on 2026-09-23:

- `POST /session/:id/prompt_async` returns `204` and the desktop renders the
  optimistic user message.
- The sidecar logs the admitted message, selects the model, reaches loop step
  1, then logs `exiting loop` without an error.
- A subsequent status read is idle and the session message list is empty; no
  terminal execution event reaches the desktop.
- The same model/prompt succeeds through the plain-Node backend.

The relevant path is `createUserMessage` → `sessions.updateMessage` and
`sessions.updateParts` → the V1 event projector → `MessageTable`/`PartTable`.
`runLoop` then reads `MessageV2.page` from those projected tables. The desktop
sidecar uses the Node SQLite shim, while the plain-Node backend is the working
comparison. The current evidence establishes a persistence/read visibility
or event-ordering discrepancy, but does not prove whether the shim, projector
flush, or loop scheduling is the first fault.

### Required kernel investigation

1. Add a persistence barrier or same-transaction read path so the user message
   and parts written by `createUserMessage` are visible to the first
   `MessageV2.page` in the same execution.
2. Instrument the projector queue and the first loop read with message ID,
   table row count, and projection sequence; do not log prompt contents or
   credentials.
3. Define the empty/stale-read behavior. A loop must not treat a previous
   finished assistant as the current prompt's successful completion.
4. Publish a terminal success, failure, or interrupted event for every loop
   exit, including the no-op/early-exit path. The existing idle status is not
   sufficient for clients that use execution events to reconcile optimistic
   state.
5. Add a regression test that runs prompt admission and the first loop read in
   the Node SQLite utility-process configuration, then asserts the user row,
   parts, terminal event, and non-empty response are all observable.

## 2. Credential-universe bridge

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

## 3. Generated endpoint surface

Regenerate or explicitly document the protocol/client surface for endpoints
already served but absent from the generated root client, including:

- `GET /experimental/resource`;
- V2 config/provider availability where the server exposes it;
- the execution terminal event/status contract described above.

Each endpoint needs a location/workspace parameter contract and a fixture
against the plain-Node and Electron utility-process servers.

## Acceptance criteria

- A prompt admitted through `prompt_async` is persisted and readable before
  the first loop decision in both server runtimes.
- Every execution reaches exactly one terminal event and idle status, even on
  early exit, provider failure, cancellation, or interruption.
- Provider/model availability has one documented credential universe and
  directory scope; V2-only credentials cannot silently produce a V1
  `ModelNotFound`.
- Generated client types and server routes agree for every desktop-consumed
  endpoint.
