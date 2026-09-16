#!/usr/bin/env bash
# Manual-use probe for a built product binary: provider-catalog + doctor +
# version + native-imports + pdf-runtime, N times, each in a fresh HOME to
# force re-stage + cold dlopen. Fail closed.
#
# NOTE: not wired into CI anymore. Release integrity comes from the verify
# matrix's end-to-end installer smoke (install.sh on real target hosts),
# which covers every check below including pdf-runtime. Keep this script for
# ad-hoc binary probing (e.g. Lima guests) only.
#
# A corrupt embedded native can pass version yet die on TUI launch, and an
# intermittent loader failure can survive a single probe — hence repetition.
# version/doctor never dlopen the TUI natives; native-imports loads OpenTUI,
# FFF, watcher, node-pty, and canvas without starting an interactive UI.
# provider-catalog proves the embedded models.dev snapshot converts to a
# /provider list with selectable defaults (the empty connect-dialog outage
# shipped green because no gate touched the catalog). pdf-runtime proves a
# page actually renders through the staged canvas native (doctor only proves
# the modules resolve). tui-worker proves the compiled extra-entrypoint
# Worker starts and serves that catalog (cwd-relative worker.ts died after
# chdir; retry toasted "Worker has been terminated").
#
# provider-catalog runs first: the fresh HOME guarantees an empty models
# cache, so it exercises the embedded snapshot path, never the network.
#
# Usage: smoke-native-binary.sh <binary> [iterations=3]
set -euo pipefail

BIN="${1:?usage: smoke-native-binary.sh <binary> [iterations]}"
ITERS="${2:-3}"

# Always treat the argument as a filesystem path: a bare filename must
# resolve against the current directory, never $PATH (the release verify
# job cds into dist/... and passes a bare asset name — that 127 must not
# recur).
case "$BIN" in */*) ;; *) BIN="./$BIN";; esac

if [[ ! -f "$BIN" ]]; then
  echo "smoke: binary not found: $BIN" >&2
  exit 1
fi

BIN="$(cd "$(dirname "$BIN")" && pwd -P)/$(basename "$BIN")"

chmod +x "$BIN"
for ((i = 1; i <= ITERS; i++)); do
  SMOKE_HOME="$(mktemp -d /tmp/smoke-home-XXXXXX)"
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" internal smoke provider-catalog --json
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" doctor
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" version
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" version --json
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" internal smoke native-imports --json
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" internal smoke pdf-runtime --json
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" internal smoke tui-worker --json
  rm -rf "$SMOKE_HOME"
done
echo "smoke passed: $BIN (${ITERS}x)"
