#!/usr/bin/env bats

setup() {
  export SPINOSA_INSTALLER_LIB_ONLY=1
  export NO_COLOR=1
  export SPINOSA_LOG_DISABLED=1
  export SPINOSA_HOME="$BATS_TEST_TMPDIR/.spinosa"
  export SPINOSA_METADATA_DIR="$SPINOSA_HOME/metadata"
  export SPINOSA_BIN_DIR="$BATS_TEST_TMPDIR/.local/bin"
  export SPINOSA_STAGING_DIR="$SPINOSA_HOME/.staging"
  INSTALLER="$BATS_TEST_DIRNAME/../../install.sh"
  set --
  # shellcheck disable=SC1090
  source "$INSTALLER"
}

bridge_success_fn() {
  TEMPLATE_PACK_ID="abc123"
  BINARY_BACKUP="/tmp/x.backup.123"
  echo "inner output"
}

bridge_fail_fn() {
  BINARY_BACKUP="/tmp/y.backup.999"
  echo "did work before failing"
  return 42
}

bridge_slow_fn() {
  SHIM_BACKUP="/tmp/z.backup.1"
  sleep 30
}

bridge_leak_fn() {
  SPINOSA_TIMED_LEAK_CHECK="leaked"
}

@test "run_timed_step preserves listed globals on success" {
  TEMPLATE_PACK_ID=""
  BINARY_BACKUP=""
  run_timed_step "Bridge success" 30 bridge_success_fn >/dev/null 2>&1
  [ "$TEMPLATE_PACK_ID" = "abc123" ]
  [ "$BINARY_BACKUP" = "/tmp/x.backup.123" ]
}

@test "run_timed_step preserves listed globals on step failure" {
  BINARY_BACKUP=""
  local status=0
  run_timed_step "Bridge failure" 30 bridge_fail_fn >/dev/null 2>&1 || status=$?
  [ "$status" -eq 42 ]
  [ "$BINARY_BACKUP" = "/tmp/y.backup.999" ]
}

@test "run_timed_step preserves listed globals on timeout" {
  SHIM_BACKUP=""
  local status=0
  run_timed_step "Bridge timeout" 1 bridge_slow_fn >/dev/null 2>&1 || status=$?
  [ "$status" -eq 124 ]
  [ "$SHIM_BACKUP" = "/tmp/z.backup.1" ]
}

@test "run_timed_step does not leak unlisted globals" {
  SPINOSA_TIMED_LEAK_CHECK=""
  run_timed_step "Bridge isolation" 30 bridge_leak_fn >/dev/null 2>&1
  [ -z "$SPINOSA_TIMED_LEAK_CHECK" ]
}

@test "_spinosa_install_signal kills the step tree and exits 130 with cleanup" {
  # Deterministic cancel-path test (no live signals): a real terminal CTRL+C
  # reaches the whole foreground group, which cannot be simulated from inside
  # the test runner without signaling the runner itself — so drive the
  # handler directly with a live step tree behind it.
  sleep 45 &
  STEP_COMMAND_PID=$!
  STEP_OUTPUT_FILE="$BATS_TEST_TMPDIR/step-out"
  touch "$STEP_OUTPUT_FILE"
  INSTALL_LOCKDIR="$BATS_TEST_TMPDIR/empty.lock"
  mkdir -p "$INSTALL_LOCKDIR"
  STEP_RENDER_PID=""
  STEP_STARTED_AT="$(date +%s)"
  STEP_LABEL="Hung"
  PROBE_PID=""
  run _spinosa_install_signal 130
  [ "$status" -eq 130 ]
  [[ "$output" == *"cancelled"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/empty.lock" ]
  [ ! -e "$STEP_OUTPUT_FILE" ]
  [ -z "$(pgrep -f 'sleep 45' || true)" ]
}

@test "wait_for_pid returns promptly on exit and timeout" {
  sleep 2 &
  local quick=$!
  wait_for_pid "$quick" 10
  sleep 30 &
  local hung=$!
  local status=0
  wait_for_pid "$hung" 1 || status=$?
  [ "$status" -eq 1 ]
  kill -KILL "$hung" 2>/dev/null || true
  wait "$hung" 2>/dev/null || true
}

@test "get_installed_version probes a live binary without metadata" {
  mkdir -p "$SPINOSA_HOME/bin"
  printf '#!/bin/sh\nprintf "{\\"version\\":\\"1.0.3-beta.9\\"}\\n"\n' > "$SPINOSA_HOME/bin/spinosa"
  chmod +x "$SPINOSA_HOME/bin/spinosa"
  # No metadata dir -> forces the live-probe path in get_installed_version.
  run get_installed_version
  [ "$status" -eq 0 ]
  [ "$output" = "1.0.3-beta.9" ]
}

@test "step_end reaps the wave renderer" {
  sleep 30 &
  local renderer=$!
  STEP_RENDER_PID="$renderer"
  STEP_STARTED_AT="$(date +%s)"
  STEP_LABEL="Test renderer"
  step_end 0 "done" >/dev/null 2>&1
  [ -z "$STEP_RENDER_PID" ]
  ! kill -0 "$renderer" 2>/dev/null
}
