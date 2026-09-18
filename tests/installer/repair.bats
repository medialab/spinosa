#!/usr/bin/env bats

setup() {
  export SPINOSA_INSTALLER_LIB_ONLY=1
  export NO_COLOR=1
  export SPINOSA_LOG_DISABLED=1
  export SPINOSA_HOME="$BATS_TEST_TMPDIR/.spinosa"
  INSTALLER="$BATS_TEST_DIRNAME/../../install.sh"
  set --
  # shellcheck disable=SC1090
  source "$INSTALLER"
}

@test "prompt_install_repair accepts --yes without a TTY" {
  YES=1
  run prompt_install_repair "Existing Spinosa setup found." "test detail" "Continue?"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Continuing automatically (--yes)"* ]]
  [[ "$output" == *"Existing Spinosa setup found"* ]]
  [[ "$output" == *"test detail"* ]]
  [[ "$output" != *"Installation needs repair"* ]]
}

@test "prompt_install_repair accepts SPINOSA_REPAIR=1" {
  YES=0
  SPINOSA_REPAIR=1
  run prompt_install_repair "Existing Spinosa setup found." "deps" "Continue?"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SPINOSA_REPAIR=1"* ]]
  [[ "$output" != *"Installation needs repair"* ]]
}

@test "is_reclaimable_spinosa_home accepts logs-only debris" {
  mkdir -p "$SPINOSA_HOME/logs"
  : >"$SPINOSA_HOME/logs/spinosa.log"
  run is_reclaimable_spinosa_home "$SPINOSA_HOME"
  [ "$status" -eq 0 ]
}

@test "is_reclaimable_spinosa_home rejects foreign files" {
  mkdir -p "$SPINOSA_HOME"
  : >"$SPINOSA_HOME/other-product.conf"
  run is_reclaimable_spinosa_home "$SPINOSA_HOME"
  [ "$status" -ne 0 ]
}

@test "is_reclaimable_spinosa_home rejects owned config" {
  mkdir -p "$SPINOSA_HOME/metadata"
  printf 'spinosa: true\n' >"$SPINOSA_HOME/metadata/config.yaml"
  run is_reclaimable_spinosa_home "$SPINOSA_HOME"
  [ "$status" -ne 0 ]
}

@test "clear_virgin_install_debris removes only allowlisted paths and keeps home dir" {
  YES=1
  mkdir -p "$SPINOSA_HOME/logs"
  : >"$SPINOSA_HOME/logs/spinosa.log"
  run clear_virgin_install_debris
  [ "$status" -eq 0 ]
  [ -d "$SPINOSA_HOME" ]
  [ ! -e "$SPINOSA_HOME/logs" ]
}

@test "clear_virgin_install_debris refuses owned home" {
  mkdir -p "$SPINOSA_HOME/metadata" "$SPINOSA_HOME/logs"
  printf 'spinosa: true\n' >"$SPINOSA_HOME/metadata/config.yaml"
  : >"$SPINOSA_HOME/logs/spinosa.log"
  run clear_virgin_install_debris
  [ "$status" -ne 0 ]
  [ -f "$SPINOSA_HOME/metadata/config.yaml" ]
  [ -f "$SPINOSA_HOME/logs/spinosa.log" ]
}

@test "clear_virgin_install_debris refuses foreign files and deletes nothing" {
  mkdir -p "$SPINOSA_HOME/logs"
  : >"$SPINOSA_HOME/logs/spinosa.log"
  : >"$SPINOSA_HOME/other-product.conf"
  run clear_virgin_install_debris
  [ "$status" -ne 0 ]
  [ -f "$SPINOSA_HOME/other-product.conf" ]
  [ -f "$SPINOSA_HOME/logs/spinosa.log" ]
}

@test "remove_spinosa_home_entry refuses deleting SPINOSA_HOME itself" {
  run remove_spinosa_home_entry ""
  [ "$status" -ne 0 ]
}

@test "remove_spinosa_home_entry refuses path traversal names" {
  run remove_spinosa_home_entry ".."
  [ "$status" -ne 0 ]
  run remove_spinosa_home_entry "foo/bar"
  [ "$status" -ne 0 ]
}

@test "ensure_spinosa_home clears reclaimable debris with --yes and keeps home" {
  YES=1
  mkdir -p "$SPINOSA_HOME/logs"
  : >"$SPINOSA_HOME/logs/spinosa.log"
  run ensure_spinosa_home
  [ "$status" -eq 0 ]
  [ -d "$SPINOSA_HOME" ]
  [ ! -e "$SPINOSA_HOME/logs/spinosa.log" ]
  [[ "$output" == *"Leftover files from an earlier install attempt"* ]]
  [[ "$output" != *"broken"* ]]
  [[ "$output" != *"needs repair"* ]]
}

@test "ensure_spinosa_home is a no-op on empty home" {
  YES=0
  mkdir -p "$SPINOSA_HOME"
  run ensure_spinosa_home
  [ "$status" -eq 0 ]
  [[ "$output" != *"Installation needs repair"* ]]
  [[ "$output" != *"Existing Spinosa setup found"* ]]
  [ -d "$SPINOSA_HOME" ]
}

@test "ensure_spinosa_home names an existing setup when config is present and the app is missing" {
  YES=1
  mkdir -p "$SPINOSA_HOME/metadata"
  printf 'spinosa: true\n' >"$SPINOSA_HOME/metadata/config.yaml"
  run ensure_spinosa_home
  [ "$status" -eq 0 ]
  [[ "$output" == *"Existing Spinosa setup found"* ]]
  [[ "$output" == *"settings and workspaces"* ]]
  [[ "$output" != *"broken"* ]]
  [[ "$output" != *"needs repair"* ]]
  [[ "$output" != *"cannot run"* ]]
}

@test "ensure_spinosa_home says the app cannot run when the file exists but is not executable" {
  YES=1
  mkdir -p "$SPINOSA_HOME/metadata" "$SPINOSA_HOME/bin"
  printf 'spinosa: true\n' >"$SPINOSA_HOME/metadata/config.yaml"
  : >"$SPINOSA_HOME/bin/spinosa"
  chmod a-x "$SPINOSA_HOME/bin/spinosa"
  run ensure_spinosa_home
  [ "$status" -eq 0 ]
  [[ "$output" == *"The Spinosa app cannot run"* ]]
  [[ "$output" == *"settings and workspaces"* ]]
  [[ "$output" != *"broken"* ]]
  [[ "$output" != *"Existing Spinosa setup found"* ]]
}
