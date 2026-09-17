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
  run prompt_install_repair "test detail"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Repairing automatically (--yes)"* ]]
  [[ "$output" == *"Installation needs repair"* ]]
  [[ "$output" == *"test detail"* ]]
}

@test "prompt_install_repair accepts SPINOSA_REPAIR=1" {
  YES=0
  SPINOSA_REPAIR=1
  run prompt_install_repair "deps"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SPINOSA_REPAIR=1"* ]]
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
}

@test "ensure_spinosa_home is a no-op on empty home" {
  YES=0
  mkdir -p "$SPINOSA_HOME"
  run ensure_spinosa_home
  [ "$status" -eq 0 ]
  [[ "$output" != *"Installation needs repair"* ]]
  [ -d "$SPINOSA_HOME" ]
}
