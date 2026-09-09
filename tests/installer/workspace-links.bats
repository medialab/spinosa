#!/usr/bin/env bats
# Replaced OpenTUI/workspace link tests — binary distribution has no package links.

setup() {
  export SPINOSA_INSTALLER_LIB_ONLY=1
  export NO_COLOR=1
  export SPINOSA_LOG_DISABLED=1
  export SPINOSA_HOME="$BATS_TEST_TMPDIR/.spinosa"
  export SPINOSA_METADATA_DIR="$SPINOSA_HOME/metadata"
  export SPINOSA_BIN_DIR="$BATS_TEST_TMPDIR/.local/bin"
  INSTALLER="$BATS_TEST_DIRNAME/../../install.sh"
  set --
  # shellcheck disable=SC1090
  source "$INSTALLER"
}

@test "installer no longer defines source package link helpers" {
  ! declare -F ensure_workspace_links >/dev/null
  ! declare -F ensure_opentui_links >/dev/null
  ! declare -F install_bundled_bun >/dev/null
}

@test "release_asset_base uses GitHub immutable release by default" {
  VERSION="1.0.3-beta.9"
  unset SPINOSA_RELEASE_BASE_URL || true
  run release_asset_base
  [ "$status" -eq 0 ]
  [ "$output" = "https://github.com/medialab/spinosa/releases/download/v1.0.3-beta.9" ]
}

@test "release_asset_base honors SPINOSA_RELEASE_BASE_URL override" {
  export SPINOSA_RELEASE_BASE_URL="http://127.0.0.1:8765/dist/"
  run release_asset_base
  [ "$status" -eq 0 ]
  [ "$output" = "http://127.0.0.1:8765/dist" ]
}

@test "spinosa_home_needs_repair detects owned home missing binary" {
  mkdir -p "$SPINOSA_METADATA_DIR"
  printf 'spinosa: true\n' >"$SPINOSA_METADATA_DIR/config.yaml"
  run spinosa_home_needs_repair "$SPINOSA_HOME"
  [ "$status" -eq 0 ]
}

@test "spinosa_home_needs_repair is quiet when binary present" {
  mkdir -p "$SPINOSA_METADATA_DIR" "$SPINOSA_HOME/bin"
  printf 'spinosa: true\n' >"$SPINOSA_METADATA_DIR/config.yaml"
  : >"$SPINOSA_HOME/bin/spinosa"
  chmod +x "$SPINOSA_HOME/bin/spinosa"
  run spinosa_home_needs_repair "$SPINOSA_HOME"
  [ "$status" -ne 0 ]
}
