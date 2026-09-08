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

@test "map_platform maps Darwin arm64/aarch64 to darwin-arm64" {
  run map_platform Darwin arm64
  [ "$status" -eq 0 ]
  [ "$output" = "darwin-arm64" ]
  run map_platform Darwin aarch64
  [ "$status" -eq 0 ]
  [ "$output" = "darwin-arm64" ]
}

@test "map_platform maps amd64/x86_64 to x64 never amd64" {
  run map_platform Darwin x86_64
  [ "$status" -eq 0 ]
  [ "$output" = "darwin-x64" ]
  run map_platform Linux amd64
  [ "$status" -eq 0 ]
  [ "$output" = "linux-x64" ]
  run map_platform linux x64
  [ "$status" -eq 0 ]
  [ "$output" = "linux-x64" ]
  [[ "$output" != *amd64* ]]
}

@test "map_platform maps Linux arm64 to linux-arm64" {
  run map_platform Linux aarch64
  [ "$status" -eq 0 ]
  [ "$output" = "linux-arm64" ]
}

@test "map_platform rejects unsupported OS and arch" {
  run map_platform Windows x86_64
  [ "$status" -ne 0 ]
  run map_platform Darwin i386
  [ "$status" -ne 0 ]
  run map_platform FreeBSD amd64
  [ "$status" -ne 0 ]
}

@test "classify_musl_linux detects alpine release marker" {
  run classify_musl_linux 1 0 ""
  [ "$status" -eq 0 ]
}

@test "classify_musl_linux detects ld-musl dynamic linker" {
  run classify_musl_linux 0 1 ""
  [ "$status" -eq 0 ]
}

@test "classify_musl_linux detects musl in ldd --version text" {
  run classify_musl_linux 0 0 $'musl libc (x86_64)\nVersion 1.2.4'
  [ "$status" -eq 0 ]
}

@test "classify_musl_linux accepts glibc ldd text" {
  run classify_musl_linux 0 0 $'ldd (GNU libc) 2.39\nCopyright (C) 2024 Free Software Foundation, Inc.'
  [ "$status" -ne 0 ]
}

@test "is_musl_linux is false on non-linux hosts" {
  # Bats typically run on Darwin/glibc CI; refuse_musl must not trip here.
  if [ "$(uname -s | tr '[:upper:]' '[:lower:]')" != "linux" ]; then
    run is_musl_linux
    [ "$status" -ne 0 ]
  else
    skip "live linux host — probe result depends on libc"
  fi
}

@test "lookup_asset_checksum returns exact hash" {
  local sums="$BATS_TEST_TMPDIR/checksums.txt"
  cat >"$sums" <<EOF
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  spinosa-darwin-arm64
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  spinosa-linux-x64
EOF
  run lookup_asset_checksum "spinosa-linux-x64" "$sums"
  [ "$status" -eq 0 ]
  [ "$output" = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" ]
}

@test "lookup_asset_checksum rejects missing asset" {
  local sums="$BATS_TEST_TMPDIR/checksums-missing.txt"
  printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  other\n' >"$sums"
  run lookup_asset_checksum "spinosa-darwin-arm64" "$sums"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not found"* ]]
}

@test "lookup_asset_checksum rejects duplicate asset entries" {
  local sums="$BATS_TEST_TMPDIR/checksums-dup.txt"
  cat >"$sums" <<EOF
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  spinosa-linux-x64
cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  spinosa-linux-x64
EOF
  run lookup_asset_checksum "spinosa-linux-x64" "$sums"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Duplicate"* ]]
}

@test "lookup_asset_checksum rejects malformed lines" {
  local sums="$BATS_TEST_TMPDIR/checksums-bad.txt"
  printf 'not-a-hash  spinosa-linux-x64\n' >"$sums"
  run lookup_asset_checksum "spinosa-linux-x64" "$sums"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Malformed"* ]]
}

@test "verify_checksum detects mismatch" {
  local f="$BATS_TEST_TMPDIR/blob"
  printf 'hello\n' >"$f"
  run verify_checksum "$f" "0000000000000000000000000000000000000000000000000000000000000000"
  [ "$status" -ne 0 ]
}

@test "is_owned_spinosa_shim recognizes new direct exec shim" {
  mkdir -p "$SPINOSA_BIN_DIR"
  cat >"$SPINOSA_BIN_DIR/spinosa" <<'EOF'
#!/bin/sh
# Managed by Spinosa install.sh
home="${SPINOSA_HOME:-$HOME/.spinosa}"
target="$home/bin/spinosa"
if [ ! -x "$target" ]; then
  echo "spinosa: installation needs repair" >&2
  exit 1
fi
exec "$target" "$@"
EOF
  run is_owned_spinosa_shim "$SPINOSA_BIN_DIR/spinosa"
  [ "$status" -eq 0 ]
}

@test "is_owned_spinosa_shim recognizes legacy bash exec shim" {
  mkdir -p "$SPINOSA_BIN_DIR"
  cat >"$SPINOSA_BIN_DIR/spinosa" <<EOF
#!/bin/sh
# Managed by Spinosa install.sh
home="${SPINOSA_HOME}"
target="\${home}/bin/spinosa"
exec bash "\$target" "\$@"
EOF
  run is_owned_spinosa_shim "$SPINOSA_BIN_DIR/spinosa"
  [ "$status" -eq 0 ]
}

@test "is_owned_spinosa_shim rejects foreign shim" {
  mkdir -p "$SPINOSA_BIN_DIR"
  cat >"$SPINOSA_BIN_DIR/spinosa" <<'EOF'
#!/bin/sh
echo other-tool
EOF
  run is_owned_spinosa_shim "$SPINOSA_BIN_DIR/spinosa"
  [ "$status" -ne 0 ]
}

@test "validate_install_paths refuses foreign SPINOSA_HOME" {
  mkdir -p "$SPINOSA_HOME"
  : >"$SPINOSA_HOME/other-product.conf"
  PREFIX_MODE=0
  run validate_install_paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"not an owned Spinosa directory"* ]]
}

@test "validate_install_paths refuses unsafe paths" {
  SPINOSA_HOME="/"
  SPINOSA_BIN_DIR="/usr/bin"
  PREFIX_MODE=0
  run validate_install_paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"unsafe"* ]]
}

@test "validate_install_paths refuses unowned shim" {
  mkdir -p "$SPINOSA_HOME" "$SPINOSA_BIN_DIR" "$SPINOSA_METADATA_DIR"
  printf 'spinosa: true\n' >"$SPINOSA_METADATA_DIR/config.yaml"
  cat >"$SPINOSA_BIN_DIR/spinosa" <<'EOF'
#!/bin/sh
echo foreign
EOF
  PREFIX_MODE=0
  run validate_install_paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"non-Spinosa command"* ]]
}

@test "handle_dry_run reports binary asset URLs with x64 naming" {
  VERSION="1.0.3-beta.9"
  PLATFORM="linux-x64"
  ASSET_NAME="spinosa-linux-x64"
  PREFIX_MODE=0
  unset SPINOSA_RELEASE_BASE_URL || true
  run handle_dry_run
  [ "$status" -eq 0 ]
  [[ "$output" == *"checksums.txt"* ]]
  [[ "$output" == *"spinosa-linux-x64"* ]]
  [[ "$output" != *amd64* ]]
  [[ "$output" != *".tar.gz"* ]]
  [[ "$output" == *"${SPINOSA_HOME}/bin/spinosa"* ]]
}

@test "handle_dry_run respects SPINOSA_RELEASE_BASE_URL" {
  VERSION="9.9.9"
  PLATFORM="darwin-arm64"
  ASSET_NAME="spinosa-darwin-arm64"
  PREFIX_MODE=1
  export SPINOSA_RELEASE_BASE_URL="http://127.0.0.1:9/v9.9.9"
  run handle_dry_run
  [ "$status" -eq 0 ]
  [[ "$output" == *"http://127.0.0.1:9/v9.9.9/checksums.txt"* ]]
  [[ "$output" == *"http://127.0.0.1:9/v9.9.9/spinosa-darwin-arm64"* ]]
}

@test "source migration helpers preserve versions and set binary distribution metadata" {
  mkdir -p "$SPINOSA_HOME/versions/1.0.2" "$SPINOSA_METADATA_DIR" "$SPINOSA_HOME/bin"
  printf 'spinosa: true\nlast_installed_version: "1.0.2"\n' >"$SPINOSA_METADATA_DIR/config.yaml"
  printf '{"schemaVersion":1,"workspaces":[]}\n' >"$SPINOSA_METADATA_DIR/workspaces.json"
  : >"$SPINOSA_HOME/versions/1.0.2/.spinosa-install-complete"
  VERSION="1.0.3-beta.9"
  TEMPLATE_PACK_ID="abc123"
  write_install_metadata
  [ -d "$SPINOSA_HOME/versions/1.0.2" ]
  [ -f "$SPINOSA_METADATA_DIR/workspaces.json" ]
  grep -q '^distribution: binary$' "$SPINOSA_METADATA_DIR/config.yaml"
  grep -q 'legacy_source_runtime: true' "$SPINOSA_METADATA_DIR/config.yaml"
  grep -q 'last_installed_version: "1.0.3-beta.9"' "$SPINOSA_METADATA_DIR/config.yaml"
}

@test "migrate_workspace_launchers rewrites managed source and preserves modified" {
  local ws1="$BATS_TEST_TMPDIR/ws-managed"
  local ws2="$BATS_TEST_TMPDIR/ws-modified"
  mkdir -p "$ws1/.bin" "$ws2/.bin" "$SPINOSA_METADATA_DIR"
  cat >"$ws1/.bin/spinosa" <<'EOF'
#!/bin/bash
# Resolves the framework root and Bun runtime
candidate="${SCRIPT_DIR}/.."
installed_release=false
ensure_opentui_links
packages/spinosa-kernel/src/index.ts
EOF
  cat >"$ws2/.bin/spinosa" <<'EOF'
#!/bin/sh
echo custom-user-launcher
EOF
  cat >"$SPINOSA_METADATA_DIR/workspaces.json" <<EOF
{"schemaVersion":1,"workspaces":[{"path":"$ws1"},{"path":"$ws2"}]}
EOF
  migrate_workspace_launchers
  grep -Fq '# Managed by Spinosa binary distribution.' "$ws1/.bin/spinosa"
  grep -Fq 'exec "$target"' "$ws1/.bin/spinosa"
  grep -Fq 'custom-user-launcher' "$ws2/.bin/spinosa"
}

@test "install_shims writes direct exec target without bash" {
  PREFIX_MODE=0
  mkdir -p "$SPINOSA_HOME/bin" "$SPINOSA_BIN_DIR"
  : >"$SPINOSA_HOME/bin/spinosa"
  chmod +x "$SPINOSA_HOME/bin/spinosa"
  install_shims
  [ -x "$SPINOSA_BIN_DIR/spinosa" ]
  grep -Fq '# Managed by Spinosa install.sh' "$SPINOSA_BIN_DIR/spinosa"
  grep -Fq 'exec "$target" "$@"' "$SPINOSA_BIN_DIR/spinosa"
  ! grep -Fq 'exec bash' "$SPINOSA_BIN_DIR/spinosa"
}

@test "fresh shell resolves default and custom SPINOSA_HOME with spaces" {
  local test_home="$BATS_TEST_TMPDIR/Hôme With Space"
  local case_home path_line

  for case_home in "$test_home/.spinosa" "$test_home/Custom Spinosa Ω"; do
    SPINOSA_HOME="$case_home"
    SPINOSA_METADATA_DIR="$SPINOSA_HOME/metadata"
    SPINOSA_BIN_DIR="$test_home/bin $(basename "$case_home")"
    SPINOSA_ENV_FILE=""
    mkdir -p "$SPINOSA_HOME/bin" "$SPINOSA_BIN_DIR"
    cat >"$SPINOSA_HOME/bin/spinosa" <<EOF
#!/bin/sh
[ "\$SPINOSA_HOME" = "$SPINOSA_HOME" ] || exit 1
printf 'ok\n'
EOF
    chmod +x "$SPINOSA_HOME/bin/spinosa"
    PREFIX_MODE=0
    install_shims
    write_spinosa_env_file
    path_line="$(spinosa_path_source_line bash)"

    run env -i HOME="$test_home" PATH="/usr/bin:/bin" bash -c "$path_line; exec \"$SPINOSA_BIN_DIR/spinosa\""
    [ "$status" -eq 0 ]
    [ "$output" = "ok" ]
  done
}

@test "parse_version_output accepts json and plain forms" {
  run parse_version_output '{"version":"1.0.3-beta.9"}'
  [ "$status" -eq 0 ]
  [ "$output" = "1.0.3-beta.9" ]
  run parse_version_output "1.0.3-beta.9"
  [ "$status" -eq 0 ]
  [ "$output" = "1.0.3-beta.9" ]
}

@test "handle_verify_only fails when no binary is installed" {
  mkdir -p "$SPINOSA_METADATA_DIR"
  printf 'spinosa: true\n' >"$SPINOSA_METADATA_DIR/config.yaml"
  run handle_verify_only
  [ "$status" -ne 0 ]
  [[ "$output" == *"No Spinosa binary installation found"* ]]
}

@test "run_staged_binary_checks fails closed when template verify fails" {
  VERSION="1.0.3-beta.9"
  local fake="$BATS_TEST_TMPDIR/fake-spinosa"
  cat >"$fake" <<'EOF'
#!/bin/sh
if [ "$1" = "version" ]; then
  printf '{"version":"1.0.3-beta.9","templatePackId":"abc"}\n'
  exit 0
fi
if [ "$1" = "internal" ] && [ "$2" = "template" ] && [ "$3" = "ensure" ]; then
  exit 0
fi
if [ "$1" = "internal" ] && [ "$2" = "template" ] && [ "$3" = "verify" ]; then
  exit 1
fi
if [ "$1" = "doctor" ]; then
  exit 0
fi
exit 0
EOF
  chmod +x "$fake"
  run run_staged_binary_checks "$fake"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Template verify failed"* ]]
}

@test "run_staged_binary_checks fails closed when template ensure fails" {
  VERSION="1.0.3-beta.9"
  local fake="$BATS_TEST_TMPDIR/fake-spinosa-ensure"
  cat >"$fake" <<'EOF'
#!/bin/sh
if [ "$1" = "version" ]; then
  printf '{"version":"1.0.3-beta.9"}\n'
  exit 0
fi
if [ "$1" = "internal" ] && [ "$2" = "template" ] && [ "$3" = "ensure" ]; then
  exit 1
fi
exit 0
EOF
  chmod +x "$fake"
  run run_staged_binary_checks "$fake"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Template ensure failed"* ]]
}

@test "run_staged_binary_checks fails closed when doctor fails" {
  VERSION="1.0.3-beta.9"
  local fake="$BATS_TEST_TMPDIR/fake-spinosa-doctor"
  cat >"$fake" <<'EOF'
#!/bin/sh
if [ "$1" = "version" ]; then
  printf '{"version":"1.0.3-beta.9"}\n'
  exit 0
fi
if [ "$1" = "internal" ] && [ "$2" = "template" ]; then
  exit 0
fi
if [ "$1" = "doctor" ]; then
  exit 1
fi
exit 0
EOF
  chmod +x "$fake"
  run run_staged_binary_checks "$fake"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Doctor reported issues"* ]]
}

@test "run_staged_binary_checks passes when version templates and doctor succeed" {
  VERSION="1.0.3-beta.9"
  local fake="$BATS_TEST_TMPDIR/fake-spinosa-ok"
  cat >"$fake" <<'EOF'
#!/bin/sh
if [ "$1" = "version" ]; then
  printf '{"version":"1.0.3-beta.9","templatePackId":"pack1"}\n'
  exit 0
fi
if [ "$1" = "internal" ] && [ "$2" = "template" ]; then
  exit 0
fi
if [ "$1" = "doctor" ]; then
  exit 0
fi
exit 0
EOF
  chmod +x "$fake"
  run run_staged_binary_checks "$fake"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Doctor passed"* ]]
  [[ "$output" == *"Template verify succeeded"* ]]
}
