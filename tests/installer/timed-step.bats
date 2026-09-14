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
