#!/usr/bin/env bash
# Stage release assets and/or run a virgin Linux install smoke inside Lima.
#
# See docs/release/lima-linux-soak.md
#
# Usage:
#   bash script/lima-linux-soak.sh --dist dist/vX.Y.Z --stage-only
#   bash script/lima-linux-soak.sh --dist dist/vX.Y.Z --instance spinosa-linux-arm64 --smoke
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST=""
INSTANCE=""
STAGE_ONLY=0
SMOKE=0
SKIP_COPY=0

if [ -t 2 ] && [ "${NO_COLOR:-}" != "1" ]; then
  G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' C=$'\033[36m'
  DIM=$'\033[2m' BOLD=$'\033[1m' RESET=$'\033[0m'
else
  G='' Y='' R='' C='' DIM='' BOLD='' RESET=''
fi

die() { printf '  %s  %s %s\n' "${DIM}│${RESET}" "${R}✗${RESET}" "$*" >&2; exit 1; }
info() { printf '  %s  %s %s\n' "${DIM}│${RESET}" "${C}●${RESET}" "$*"; }
ok() { printf '  %s  %s %s\n' "${DIM}│${RESET}" "${G}◆${RESET}" "$*" >&2; }
warn() { printf '  %s  %s %s\n' "${DIM}│${RESET}" "${Y}●${RESET}" "$*" >&2; }

usage() {
  cat <<'EOF'
Usage:
  bash script/lima-linux-soak.sh --dist <dir> --stage-only
  bash script/lima-linux-soak.sh --dist <dir> --instance <lima-name> --smoke

Options:
  --dist DIR       Immutable release dir (binaries + optional install.sh)
  --instance NAME  Lima instance (must already exist / be startable)
  --stage-only     Patch install.sh + write checksums.txt on the host; exit
  --smoke          Copy linux assets into the VM and run virgin install smoke
  --skip-copy      Reuse /tmp/spinosa-dist already present in the guest
  -h, --help       Show this help

Env:
  SPINOSA_LIMA_HTTP_PORT   Guest HTTP port (default 8765)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dist)
      [ $# -ge 2 ] || die "--dist requires a directory"
      DIST="$2"
      shift 2
      ;;
    --instance)
      [ $# -ge 2 ] || die "--instance requires a name"
      INSTANCE="$2"
      shift 2
      ;;
    --stage-only) STAGE_ONLY=1; shift ;;
    --smoke) SMOKE=1; shift ;;
    --skip-copy) SKIP_COPY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$DIST" ] || die "--dist is required"
DIST="$(cd "$DIST" && pwd)" || die "dist not found: $DIST"
VERSION="$(jq -r .version "$ROOT/package.json")"
HTTP_PORT="${SPINOSA_LIMA_HTTP_PORT:-8765}"

stage_assets() {
  local channel pinned_tag install_src
  if [[ "$VERSION" == *-* ]]; then
    channel=beta
    pinned_tag=beta
  else
    channel=stable
    pinned_tag="v${VERSION}"
  fi

  info "staging install.sh + checksums into $DIST (v${VERSION}, channel=${channel})"
  install_src="$ROOT/install.sh"
  [ -f "$install_src" ] || die "missing $install_src"

  # Keep PINNED_VERSION / PINNED_TAG in sync with this tree (same idea as release stages).
  sed \
    -e "s/^PINNED_VERSION=\".*\"/PINNED_VERSION=\"${VERSION}\"/" \
    -e "s/^PINNED_TAG=\".*\"/PINNED_TAG=\"${pinned_tag}\"/" \
    "$install_src" >"$DIST/install.sh"
  chmod 755 "$DIST/install.sh"

  if [ ! -f "$DIST/build-manifest.json" ]; then
    info "writing minimal build-manifest.json"
    cat >"$DIST/build-manifest.json" <<EOF
{
  "product": "spinosa",
  "version": "${VERSION}",
  "channel": "${channel}",
  "templatePackId": "soak-local",
  "assets": {
    "darwin-arm64": "spinosa-darwin-arm64",
    "darwin-x64": "spinosa-darwin-x64",
    "linux-arm64": "spinosa-linux-arm64",
    "linux-x64": "spinosa-linux-x64"
  }
}
EOF
  fi

  local hashed=(install.sh build-manifest.json)
  local name
  for name in spinosa-darwin-arm64 spinosa-darwin-x64 spinosa-linux-arm64 spinosa-linux-x64; do
    if [ -f "$DIST/$name" ]; then
      hashed+=("$name")
      chmod 755 "$DIST/$name" || true
    else
      warn "missing $name (ok for partial soak trees)"
    fi
  done

  (
    cd "$DIST"
    shasum -a 256 "${hashed[@]}" | awk '{ print $1 "  " $2 }' >checksums.txt
  )
  ok "staged $DIST/install.sh + checksums.txt"
}

guest_linux_asset() {
  limactl shell "$INSTANCE" -- bash -lc 'uname -m' | tr -d '\r'
}

ensure_instance() {
  command -v limactl >/dev/null 2>&1 || die "limactl not found — brew install lima"
  limactl list -q | grep -qx "$INSTANCE" || die "Lima instance not found: $INSTANCE (limactl start --name $INSTANCE template://ubuntu)"
  local status
  status="$(limactl list -f '{{.Name}} {{.Status}}' | awk -v n="$INSTANCE" '$1==n {print $2}')"
  if [ "$status" != "Running" ]; then
    info "starting Lima instance $INSTANCE"
    limactl start "$INSTANCE"
  fi
}

copy_into_guest() {
  local arch asset
  arch="$(guest_linux_asset)"
  case "$arch" in
    aarch64|arm64) asset=spinosa-linux-arm64 ;;
    x86_64|amd64) asset=spinosa-linux-x64 ;;
    *) die "unsupported guest arch: $arch" ;;
  esac
  [ -f "$DIST/$asset" ] || die "missing $DIST/$asset for guest arch $arch"
  [ -f "$DIST/install.sh" ] || die "missing $DIST/install.sh — run --stage-only first"
  [ -f "$DIST/checksums.txt" ] || die "missing $DIST/checksums.txt — run --stage-only first"

  info "copying $asset + installer into ${INSTANCE}:/tmp/spinosa-dist/"
  limactl shell "$INSTANCE" -- bash -lc 'rm -rf /tmp/spinosa-dist && mkdir -p /tmp/spinosa-dist'
  limactl copy \
    "$DIST/$asset" \
    "$DIST/install.sh" \
    "$DIST/checksums.txt" \
    "$DIST/build-manifest.json" \
    "${INSTANCE}:/tmp/spinosa-dist/"
  ok "assets in guest /tmp/spinosa-dist"
}

run_smoke() {
  info "virgin install smoke in $INSTANCE (HOME=/tmp/spinosa-virgin-user)"
  limactl shell "$INSTANCE" -- bash -lc "
set -euo pipefail
cd /tmp/spinosa-dist
if [ -f /tmp/spinosa-http.pid ]; then
  kill \"\$(cat /tmp/spinosa-http.pid)\" 2>/dev/null || true
  rm -f /tmp/spinosa-http.pid
fi
python3 -m http.server ${HTTP_PORT} >/tmp/spinosa-http.log 2>&1 &
echo \$! >/tmp/spinosa-http.pid
sleep 0.5
export HOME=/tmp/spinosa-virgin-user
export SPINOSA_HOME=\"\$HOME/.spinosa\"
export SPINOSA_BIN_DIR=\"\$HOME/.local/bin\"
export SPINOSA_RELEASE_BASE_URL=http://127.0.0.1:${HTTP_PORT}
rm -rf \"\$HOME\"
mkdir -p \"\$HOME\" \"\$SPINOSA_BIN_DIR\"
bash ./install.sh --yes --no-launch
\"\$SPINOSA_HOME/bin/spinosa\" version
\"\$SPINOSA_HOME/bin/spinosa\" doctor
# Optional tiny PDF fixture (non-fatal if new needs more flags on this cut)
mkdir -p /tmp/spinosa-tiny-corpus
printf '%%PDF-1.1\\n1 0 obj<<>>endobj\\ntrailer<<>>\\n%%%%EOF\\n' >/tmp/spinosa-tiny-corpus/tiny.pdf
\"\$SPINOSA_HOME/bin/spinosa\" new /tmp/spinosa-tiny-corpus --extensions pdf --cli other --launch copy --no-color \\
  || echo 'note: tiny pdf workspace create skipped/failed (doctor already exercised PDF probe)'
kill \"\$(cat /tmp/spinosa-http.pid)\" 2>/dev/null || true
rm -f /tmp/spinosa-http.pid
"
  ok "Linux virgin smoke finished on $INSTANCE"
}

# --- main ---
if [ "$STAGE_ONLY" -eq 0 ] && [ "$SMOKE" -eq 0 ]; then
  die "pass --stage-only and/or --smoke"
fi

stage_assets

if [ "$STAGE_ONLY" -eq 1 ] && [ "$SMOKE" -eq 0 ]; then
  exit 0
fi

[ -n "$INSTANCE" ] || die "--instance is required with --smoke"
ensure_instance
if [ "$SKIP_COPY" -eq 0 ]; then
  copy_into_guest
else
  info "skipping copy (--skip-copy)"
fi
run_smoke
