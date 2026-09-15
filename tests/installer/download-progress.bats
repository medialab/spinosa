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

@test "parse_content_length returns last header across redirects" {
  local headers=$'HTTP/1.1 302 Found\r\ncontent-length: 123\r\nlocation: https://example.invalid/x\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 456\r\n'
  run parse_content_length "$headers"
  [ "$status" -eq 0 ]
  [ "$output" = "456" ]
}

@test "parse_content_length is empty without the header" {
  run parse_content_length $'HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "file_size_bytes reports bytes and zero for missing files" {
  local f="$BATS_TEST_TMPDIR/sized"
  printf '0123456789' >"$f"
  run file_size_bytes "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "10" ]
  run file_size_bytes "$BATS_TEST_TMPDIR/does-not-exist"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
}

@test "file_size_bytes falls back to wc when stat is unavailable" {
  stat() { return 1; }
  local f="$BATS_TEST_TMPDIR/fallback"
  printf '0123456789' >"$f"
  run file_size_bytes "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "10" ]
}

@test "step_progress_percent computes halves and clamps overflow" {
  local f="$BATS_TEST_TMPDIR/half"
  head -c 50 /dev/zero >"$f"
  run step_progress_percent "$f" 100
  [ "$status" -eq 0 ]
  [ "$output" = "50" ]
  run step_progress_percent "$f" 10
  [ "$status" -eq 0 ]
  [ "$output" = "100" ]
}

@test "step_progress_percent fails when total is unknown" {
  run step_progress_percent "$BATS_TEST_TMPDIR/anything" ""
  [ "$status" -ne 0 ]
}

@test "step_progress_text renders pct and stays silent without total" {
  local f="$BATS_TEST_TMPDIR/quarter"
  head -c 25 /dev/zero >"$f"
  run step_progress_text "$f" 100
  [ "$status" -eq 0 ]
  [ "$output" = " 25%" ]
  run step_progress_text "$f" ""
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "wave line has no brackets" {
  run grep -F '[%s]' "$INSTALLER"
  [ "$status" -ne 0 ]
}

@test "format_wave_line shows pct without time when total is known" {
  run format_wave_line "Download x" "WAVE" " 42%" 51 600
  [ "$status" -eq 0 ]
  [ "$output" = "● Download x WAVE 42%" ]
  [[ "$output" != *"51s"* ]]
}

@test "format_wave_line falls back to elapsed without pct" {
  run format_wave_line "Verifying package" "WAVE" "" 51 180
  [ "$status" -eq 0 ]
  [ "$output" = "● Verifying package WAVE 51s/180s" ]
  [[ "$output" != *"%"* ]]
}

@test "all download steps go through run_download_step" {
  run grep -c -F 'run_download_step "' "$INSTALLER"
  [ "$status" -eq 0 ]
  [ "$output" = "4" ]
  run grep -n -F 'download "$' "$INSTALLER"
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
}

@test "run_download_step clears progress state on success" {
  download() { printf '0123456789' >"$2"; }
  download_total_bytes() { printf '10\n'; }
  STEP_PROGRESS_DEST=""
  STEP_PROGRESS_TOTAL=""
  run_download_step "Stub download" 30 "https://example.invalid/x" "$BATS_TEST_TMPDIR/stub-out" >/dev/null 2>&1
  [ -f "$BATS_TEST_TMPDIR/stub-out" ]
  [ -z "$STEP_PROGRESS_DEST" ]
  [ -z "$STEP_PROGRESS_TOTAL" ]
}

@test "run_download_step clears progress state and propagates failure" {
  download() { return 42; }
  download_total_bytes() { printf '10\n'; }
  STEP_PROGRESS_DEST=""
  STEP_PROGRESS_TOTAL=""
  local status=0
  run_download_step "Stub failure" 30 "https://example.invalid/x" "$BATS_TEST_TMPDIR/stub-fail" >/dev/null 2>&1 || status=$?
  [ "$status" -eq 42 ]
  [ -z "$STEP_PROGRESS_DEST" ]
  [ -z "$STEP_PROGRESS_TOTAL" ]
}
