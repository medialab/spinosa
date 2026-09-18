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

registry_leak_fn() {
  local dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/spinosa-reg-leak.XXXXXX")"
  timed_register_temp "$dir"
  printf '%s' "$dir" > "$BATS_TEST_TMPDIR/reg-leak-path"
  sleep 30
}

registry_ok_fn() {
  local dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/spinosa-reg-ok.XXXXXX")"
  timed_register_temp "$dir"
  printf '%s' "$dir" > "$BATS_TEST_TMPDIR/reg-ok-path"
  echo "registered ok"
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

@test "timed temp registry cleans payload temps on timeout" {
  rm -f "$BATS_TEST_TMPDIR/reg-leak-path"
  local status=0
  run_timed_step "Registry timeout" 1 registry_leak_fn >/dev/null 2>&1 || status=$?
  [ "$status" -eq 124 ]
  [ -f "$BATS_TEST_TMPDIR/reg-leak-path" ]
  [ ! -e "$(cat "$BATS_TEST_TMPDIR/reg-leak-path")" ]
}

@test "timed temp registry cleans payload temps on success" {
  rm -f "$BATS_TEST_TMPDIR/reg-ok-path"
  run_timed_step "Registry success" 30 registry_ok_fn >/dev/null 2>&1
  [ -f "$BATS_TEST_TMPDIR/reg-ok-path" ]
  [ ! -e "$(cat "$BATS_TEST_TMPDIR/reg-ok-path")" ]
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

@test "get_installed_version assigns via parent var without subshell loss" {
  mkdir -p "$SPINOSA_HOME/bin"
  printf '#!/bin/sh\nprintf "{\\"version\\":\\"1.0.3-beta.9\\"}\\n"\n' > "$SPINOSA_HOME/bin/spinosa"
  chmod +x "$SPINOSA_HOME/bin/spinosa"
  local probed=""
  get_installed_version probed
  [ "$probed" = "1.0.3-beta.9" ]
  # Parent-shell form leaves no stray probe behind for the signal handler.
  [ -z "${PROBE_PID:-}" ]
}

@test "probe_spinosa_version_output falls back on fast --json failure" {
  mkdir -p "$SPINOSA_HOME/bin"
  # Old shims predate `version --json`: a fast failure must still fall back
  # to plain `version` (only timeouts are terminal).
  cat > "$SPINOSA_HOME/bin/spinosa" <<'EOF'
#!/bin/sh
if [ "$2" = "--json" ]; then
  printf 'loader blew up\n' >&2
  exit 1
fi
printf '{"version":"1.0.3-beta.9"}\n'
EOF
  chmod +x "$SPINOSA_HOME/bin/spinosa"
  run probe_spinosa_version_output "$SPINOSA_HOME/bin/spinosa" /dev/null
  [ "$status" -eq 0 ]
  [ "$output" = '{"version":"1.0.3-beta.9"}' ]
}

@test "probe_spinosa_version_output performs no fallback after timeout" {
  mkdir -p "$SPINOSA_HOME/bin"
  # If --json hangs, the plain fallback must NEVER run: starting fresh work
  # from a timed-out probe orphans it outside the reaped tree.
  local marker="$BATS_TEST_TMPDIR/fallback-marker"
  rm -f "$marker"
  cat > "$SPINOSA_HOME/bin/spinosa" <<EOF
#!/bin/sh
if [ "\$2" = "--json" ]; then
  sleep 30
  exit 0
fi
touch "$marker"
printf '{"version":"1.0.3-beta.9"}\n'
EOF
  chmod +x "$SPINOSA_HOME/bin/spinosa"
  SPINOSA_PROBE_TIMEOUT_SECONDS=1 run probe_spinosa_version_output "$SPINOSA_HOME/bin/spinosa" /dev/null
  [ "$status" -ne 0 ]
  [ ! -e "$marker" ]
  run pgrep -f "sleep 30"
  [ "$status" -ne 0 ]
}

@test "probe timeout tree-kills wrapper grandchildren" {
  mkdir -p "$SPINOSA_HOME/bin"
  # Fake binary that orphans a grandchild sleep: a pid-only kill would leak it.
  cat > "$SPINOSA_HOME/bin/spinosa" <<'EOF'
#!/bin/sh
sleep 30 &
sleep 30
EOF
  chmod +x "$SPINOSA_HOME/bin/spinosa"
  SPINOSA_PROBE_TIMEOUT_SECONDS=1 run probe_spinosa_version_output "$SPINOSA_HOME/bin/spinosa" /dev/null
  [ "$status" -ne 0 ]
  run pgrep -f "sleep 30"
  [ "$status" -ne 0 ]
}

@test "version probe wait stays SIGINT-responsive at process level" {
  mkdir -p "$SPINOSA_HOME/bin"
  printf '#!/bin/sh\nsleep 30\n' > "$SPINOSA_HOME/bin/spinosa"
  chmod +x "$SPINOSA_HOME/bin/spinosa"
  local started elapsed waiter_status=0
  started="$(date +%s)"
  SPINOSA_INSTALLER_LIB_ONLY=1 SPINOSA_PROBE_TIMEOUT_SECONDS=30 NO_COLOR=1 SPINOSA_LOG_DISABLED=1 \
    bash -c 'source "$1"; get_installed_version VAR' _ "$INSTALLER" &
  waiter=$!
  sleep 1
  kill -INT "$waiter" 2>/dev/null || true
  wait "$waiter" || waiter_status=$?
  elapsed=$(( $(date +%s) - started ))
  # Without the async-probe design the shell would sit in command substitution
  # (background children ignore SIGINT) for the full 30s budget.
  [ "$waiter_status" -ne 0 ]
  [ "$elapsed" -lt 10 ]
  # Lib mode has no INT trap by design (real installer reaps PROBE_PID via
  # _spinosa_install_signal) — clean up the orphaned probe tree explicitly.
  pkill -f "sleep 30" 2>/dev/null || true
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

@test "gate_note prints the marker even when the gate tty cannot be written" {
  SPINOSA_GATE_TTY="/no/such/spinosa-gate-tty"
  run gate_note "Running smoke provider-catalog..."
  [ "$status" -eq 0 ]
  [[ "$output" == *"Running smoke provider-catalog..."* ]]
  [[ "$output" != *"Device not configured"* ]]
  [[ "$output" != *"No such file"* ]]
}

@test "gate_note mirrors a live copy when SPINOSA_GATE_TTY is writable" {
  local ttyfile="$BATS_TEST_TMPDIR/gate-tty"
  : > "$ttyfile"
  SPINOSA_GATE_TTY="$ttyfile"
  run gate_note "Smoke provider-catalog passed (1s)"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Smoke provider-catalog passed (1s)"* ]]
  grep -F "Smoke provider-catalog passed (1s)" "$ttyfile"
}
