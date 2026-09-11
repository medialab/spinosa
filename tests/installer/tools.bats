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

@test "host_ocr_complete passes with stubbed binaries and langs" {
  bindir="$BATS_TEST_TMPDIR/stubbin"
  mkdir -p "$bindir"
  printf '#!/bin/sh\necho "tesseract 5.0"\necho "eng\nita\nfra"\n' > "$bindir/tesseract"
  printf '#!/bin/sh\nexit 0\n' > "$bindir/pdftoppm"
  chmod +x "$bindir/tesseract" "$bindir/pdftoppm"
  PATH="$bindir:$PATH" run host_ocr_complete
  [ "$status" -eq 0 ]
}

@test "host_ocr_complete fails when langs are missing" {
  bindir="$BATS_TEST_TMPDIR/stubbin2"
  mkdir -p "$bindir"
  printf '#!/bin/sh\necho "eng\nosd"\n' > "$bindir/tesseract"
  printf '#!/bin/sh\nexit 0\n' > "$bindir/pdftoppm"
  chmod +x "$bindir/tesseract" "$bindir/pdftoppm"
  PATH="$bindir:$PATH" run host_ocr_complete
  [ "$status" -ne 0 ]
}

@test "host_ocr_complete fails when binaries are absent" {
  PATH="/usr/bin:/bin" run host_ocr_complete
  [ "$status" -ne 0 ]
}

@test "write_tools_manifest emits valid JSON with source" {
  run write_tools_manifest "host"
  [ "$status" -eq 0 ]
  manifest="$SPINOSA_HOME/tools/TOOLS_MANIFEST.json"
  [ -f "$manifest" ]
  python3 -c "import json,sys; d=json.load(open('$manifest')); assert d['platform']=='darwin-arm64', d; assert d['source']=='host', d"
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

@test "install_bundled_tools records host source without downloading" {
  bindir="$BATS_TEST_TMPDIR/stubbin3"
  mkdir -p "$bindir"
  printf '#!/bin/sh\necho "eng\nita\nfra"\n' > "$bindir/tesseract"
  printf '#!/bin/sh\nexit 0\n' > "$bindir/pdftoppm"
  chmod +x "$bindir/tesseract" "$bindir/pdftoppm"
  PATH="$bindir:$PATH" run install_bundled_tools "/nonexistent-checksums"
  [ "$status" -eq 0 ]
  python3 -c "import json; assert json.load(open('$SPINOSA_HOME/tools/TOOLS_MANIFEST.json'))['source']=='host'"
}
