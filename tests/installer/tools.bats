#!/usr/bin/env bats

setup() {
  export SPINOSA_INSTALLER_LIB_ONLY=1
  export NO_COLOR=1
  export SPINOSA_LOG_DISABLED=1
  export SPINOSA_HOME="$BATS_TEST_TMPDIR/.spinosa"
  export SPINOSA_METADATA_DIR="$SPINOSA_HOME/metadata"
  export SPINOSA_BIN_DIR="$BATS_TEST_TMPDIR/.local/bin"
  export SPINOSA_STAGING_DIR="$SPINOSA_HOME/.staging"
  mkdir -p "$SPINOSA_STAGING_DIR"
  INSTALLER="$BATS_TEST_DIRNAME/../../install.sh"
  set --
  # shellcheck disable=SC1090
  source "$INSTALLER"
  # NOTE: install.sh resets PLATFORM="" at source time — set it after sourcing.
  export PLATFORM="darwin-arm64"
}

@test "tools_platform_dir nests under home with platform" {
  [ "$(tools_platform_dir)" = "$SPINOSA_HOME/tools/darwin-arm64" ]
}

@test "legacy_ocr_data_complete is always absent (no engine ships)" {
  dir="$BATS_TEST_TMPDIR/ocr-data"
  mkdir -p "$dir"
  touch "$dir/eng.dat" "$dir/ita.dat" "$dir/fra.dat"
  run legacy_ocr_data_complete "$dir"
  [ "$status" -ne 0 ]
}

@test "installer never calls a package manager (standalone contract)" {
  # No engine installs via any package manager.
  run grep -E 'brew install|apt-get install|dnf install|pacman -S' "$INSTALLER"
  [ "$status" -ne 0 ]
  # No package-manager execution paths remain outside comments/echo hints.
  run grep -E '^\s*\$sudo (brew|apt-get|dnf|pacman)|\$\(sudo' "$INSTALLER"
  [ "$status" -ne 0 ]
}

@test "try_package_manager_tools is a fail-closed stub" {
  run try_package_manager_tools
  [ "$status" -ne 0 ]
}

@test "host_ocr_complete is always absent (no engine ships, no host probing)" {
  bindir="$BATS_TEST_TMPDIR/stubbin"
  mkdir -p "$bindir"
  printf '#!/bin/sh\necho "legacy-ocr 5.0"\necho "eng\nita\nfra"\n' > "$bindir/legacy-ocr"
  chmod +x "$bindir/legacy-ocr"
  unset SPINOSA_DEV_HOST_TOOLS
  PATH="$bindir:$PATH" run host_ocr_complete
  [ "$status" -ne 0 ]
  SPINOSA_DEV_HOST_TOOLS=1 PATH="$bindir:$PATH" run host_ocr_complete
  [ "$status" -ne 0 ]
}

@test "no language-data pins remain" {
  run grep -E '^[A-Z_]*PIN_COMMIT=' "$INSTALLER"
  [ "$status" -ne 0 ]
  run grep -E 'traineddata' "$INSTALLER"
  [ "$status" -ne 0 ]
}

@test "write_tools_manifest emits removal JSON" {
  run write_tools_manifest "removed"
  [ "$status" -eq 0 ]
  manifest="$SPINOSA_HOME/tools/TOOLS_MANIFEST.json"
  [ -f "$manifest" ]
  python3 -c "import json,sys; d=json.load(open('$manifest')); assert d['platform']=='darwin-arm64', d; assert d['source']=='removed', d; assert d['ocr']=='removed', d"
}

@test "ensure_bundled_ocr_data is a fail-closed stub (no downloads)" {
  dir="$SPINOSA_HOME/tools/darwin-arm64/ocr-data"
  mkdir -p "$dir"
  touch "$dir/eng.dat" "$dir/ita.dat" "$dir/fra.dat"
  run ensure_bundled_ocr_data
  [ "$status" -ne 0 ]
}

@test "install_bundled_tools is a no-op that records removal" {
  run install_bundled_tools "/nonexistent-checksums"
  [ "$status" -eq 0 ]
  python3 -c "import json; d=json.load(open('$SPINOSA_HOME/tools/TOOLS_MANIFEST.json')); assert d['source']=='removed', d"
}

@test "install_bundled_tools never uses host tools" {
  bindir="$BATS_TEST_TMPDIR/stubbin3"
  mkdir -p "$bindir"
  printf '#!/bin/sh\necho "eng\nita\nfra"\n' > "$bindir/legacy-ocr"
  chmod +x "$bindir/legacy-ocr"
  unset SPINOSA_DEV_HOST_TOOLS
  PATH="$bindir:$PATH" run install_bundled_tools "/nonexistent-checksums"
  [ "$status" -eq 0 ]
  python3 -c "import json; d=json.load(open('$SPINOSA_HOME/tools/TOOLS_MANIFEST.json')); assert d['source']!='host' and d['source']!='package-manager', d"
}

@test "bundled tools provision before staged smoke verification" {
  # The removal-manifest step still runs before staged verification so the
  # ordering invariant keeps holding. Staged verification is split into core
  # gates plus standalone smoke gates — both must come after tools.
  tools_line="$(grep -nF 'install_bundled_tools "$checksums_file"' "$INSTALLER" | cut -d: -f1)"
  verify_line="$(grep -nF 'run_staged_core_checks "$staged_binary"' "$INSTALLER" | cut -d: -f1)"
  smoke_line="$(grep -nF 'run_staged_smoke_checks "$staged_binary"' "$INSTALLER" | cut -d: -f1)"
  [ -n "$tools_line" ]
  [ -n "$verify_line" ]
  [ -n "$smoke_line" ]
  [ "$tools_line" -lt "$verify_line" ]
  [ "$tools_line" -lt "$smoke_line" ]
}
