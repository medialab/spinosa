#!/usr/bin/env bash
# Smoke a built product binary: doctor + version + native-imports, N times,
# each in a fresh HOME to force re-stage + cold dlopen. Fail closed.
#
# A corrupt embedded native can pass version yet die on TUI launch, and an
# intermittent loader failure can survive a single probe — hence repetition.
# version/doctor never dlopen the TUI natives; native-imports loads OpenTUI,
# FFF, watcher, node-pty, and canvas without starting an interactive UI.
#
# Usage: smoke-native-binary.sh <binary> [iterations=3]
set -euo pipefail

BIN="${1:?usage: smoke-native-binary.sh <binary> [iterations]}"
ITERS="${2:-3}"

chmod +x "$BIN"
for ((i = 1; i <= ITERS; i++)); do
  SMOKE_HOME="$(mktemp -d /tmp/smoke-home-XXXXXX)"
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" doctor
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" version
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" version --json
  HOME="$SMOKE_HOME" SPINOSA_HOME="$SMOKE_HOME/.spinosa" "$BIN" internal smoke native-imports --json
  rm -rf "$SMOKE_HOME"
done
echo "smoke passed: $BIN (${ITERS}x)"
