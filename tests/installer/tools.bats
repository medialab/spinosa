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

@test "tools_tessdata_complete requires all three languages" {
  dir="$BATS_TEST_TMPDIR/tessdata"
  mkdir -p "$dir"
  run tools_tessdata_complete "$dir"
  [ "$status" -ne 0 ]
  touch "$dir/eng.traineddata" "$dir/ita.traineddata"
  run tools_tessdata_complete "$dir"
  [ "$status" -ne 0 ]
  touch "$dir/fra.traineddata"
  run tools_tessdata_complete "$dir"
  [ "$status" -eq 0 ]
  run tools_tessdata_complete ""
  [ "$status" -ne 0 ]
}

@test "installer never calls a package manager (standalone contract)" {
  # No tesseract/poppler installs via any package manager (the bash
  # prerequisite hint is exempt — bash is the installer's own runtime).
  run grep -E 'brew install tesseract|apt-get install .*(tesseract|poppler)|dnf install .*(tesseract|poppler)|pacman -S .*(tesseract|poppler)' "$INSTALLER"
  [ "$status" -ne 0 ]
  # No package-manager execution paths remain outside comments/echo hints.
  run grep -E '^\s*\$sudo (brew|apt-get|dnf|pacman)|\$\(sudo' "$INSTALLER"
  [ "$status" -ne 0 ]
}

@test "try_package_manager_tools is a fail-closed stub" {
  run try_package_manager_tools
  [ "$status" -ne 0 ]
}

@test "host_ocr_complete ignores host PATH in production (bundled only)" {
  bindir="$BATS_TEST_TMPDIR/stubbin"
  mkdir -p "$bindir"
  printf '#!/bin/sh\necho "tesseract 5.0"\necho "eng\nita\nfra"\n' > "$bindir/tesseract"
  chmod +x "$bindir/tesseract"
  unset SPINOSA_DEV_HOST_TOOLS
  PATH="$bindir:$PATH" run host_ocr_complete
  [ "$status" -ne 0 ]
}

@test "host_ocr_complete honors SPINOSA_DEV_HOST_TOOLS=1 developer override" {
  bindir="$BATS_TEST_TMPDIR/stubbin2"
  mkdir -p "$bindir"
  printf '#!/bin/sh\necho "eng\nita\nfra"\n' > "$bindir/tesseract"
  chmod +x "$bindir/tesseract"
  SPINOSA_DEV_HOST_TOOLS=1 PATH="$bindir:$PATH" run host_ocr_complete
  [ "$status" -eq 0 ]
}

@test "tessdata pins an immutable commit (never mutable main)" {
  run grep -E '^TESSDATA_PIN_COMMIT="[0-9a-f]{40}"' "$INSTALLER"
  [ "$status" -eq 0 ]
  run grep -E 'tessdata_fast/raw/main' "$INSTALLER"
  [ "$status" -ne 0 ]
}

@test "write_tools_manifest emits valid JSON with source" {
  run write_tools_manifest "tarball"
  [ "$status" -eq 0 ]
  manifest="$SPINOSA_HOME/tools/TOOLS_MANIFEST.json"
  [ -f "$manifest" ]
  python3 -c "import json,sys; d=json.load(open('$manifest')); assert d['platform']=='darwin-arm64', d; assert d['source']=='tarball', d; assert 'tessdata_commit' in d, d"
}

@test "ensure_bundled_tessdata skips download when complete" {
  dir="$SPINOSA_HOME/tools/darwin-arm64/tessdata"
  mkdir -p "$dir"
  touch "$dir/eng.traineddata" "$dir/ita.traineddata" "$dir/fra.traineddata"
  run ensure_bundled_tessdata
  [ "$status" -eq 0 ]
}

@test "install_bundled_tools honors the skip flag" {
  SPINOSA_SKIP_BUNDLED_TOOLS=1 run install_bundled_tools "/nonexistent-checksums"
  [ "$status" -eq 0 ]
}

@test "install_bundled_tools never uses host tools without dev override" {
  bindir="$BATS_TEST_TMPDIR/stubbin3"
  mkdir -p "$bindir"
  printf '#!/bin/sh\necho "eng\nita\nfra"\n' > "$bindir/tesseract"
  chmod +x "$bindir/tesseract"
  unset SPINOSA_DEV_HOST_TOOLS
  PATH="$bindir:$PATH" run install_bundled_tools "/nonexistent-checksums"
  [ "$status" -eq 0 ]
  python3 -c "import json; d=json.load(open('$SPINOSA_HOME/tools/TOOLS_MANIFEST.json')); assert d['source']!='host' and d['source']!='package-manager', d"
}

@test "bundled tools provision before staged doctor verification" {
  # The staged doctor gate fails closed on missing OCR, so the install flow
  # must provision $SPINOSA_HOME/tools before running staged verification.
  tools_line="$(grep -nF 'install_bundled_tools "$checksums_file"' "$INSTALLER" | cut -d: -f1)"
  verify_line="$(grep -nF 'run_staged_binary_checks "$staged_binary"' "$INSTALLER" | cut -d: -f1)"
  [ -n "$tools_line" ]
  [ -n "$verify_line" ]
  [ "$tools_line" -lt "$verify_line" ]
}
