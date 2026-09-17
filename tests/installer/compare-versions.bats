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

@test "compare_versions orders stable releases numerically" {
  compare_versions "1.10.0" "1.9.0" || cmp=$?
  [ "${cmp:-0}" -eq 1 ]
}

@test "compare_versions orders prerelease build numbers" {
  compare_versions "1.0.0-beta.2" "1.0.0-beta.10" || cmp=$?
  [ "${cmp:-0}" -eq 2 ]
}

@test "compare_versions prefers stable over prerelease" {
  compare_versions "1.0.0" "1.0.0-rc.1" || cmp=$?
  [ "${cmp:-0}" -eq 1 ]
}

@test "compare_versions treats equal versions as equal" {
  compare_versions "1.0.2-beta.14" "1.0.2-beta.14" || cmp=$?
  [ "${cmp:-0}" -eq 0 ]
}
