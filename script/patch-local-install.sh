#!/usr/bin/env bash
# Patch ~/.spinosa/versions/<current package.json version> from the local repo
# so the global `spinosa` command runs this checkout directly.
#
# Dev-only. Refuses binary-distribution installs — never overwrite the product
# binary at ~/.spinosa/bin/spinosa with a source forwarder.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(awk -F'"' '/"version":/ { print $4; exit }' "$ROOT/package.json")"
SPINOSA_HOME="${SPINOSA_HOME:-$HOME/.spinosa}"
TARGET="${SPINOSA_HOME}/versions/${VERSION}"
# Real installs put the user-facing shim in ~/.local/bin (see env.sh / install.sh).
# ~/.spinosa/bin/spinosa is the home-local copy; PATH uses SPINOSA_BIN_DIR.
if [[ -z "${SPINOSA_BIN_DIR:-}" && -f "${SPINOSA_HOME}/env.sh" ]]; then
  # shellcheck disable=SC1090
  # Only pull BIN_DIR — do not source the whole file (would mutate caller PATH).
  SPINOSA_BIN_DIR="$(
    awk -F= '/^export SPINOSA_BIN_DIR=/ {
      gsub(/"/, "", $2)
      print $2
      exit
    }' "${SPINOSA_HOME}/env.sh"
  )"
fi
SPINOSA_BIN_DIR="${SPINOSA_BIN_DIR:-$HOME/.local/bin}"

if [ -t 2 ] && [ "${NO_COLOR:-}" != "1" ]; then
  G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' C=$'\033[36m'
  DIM=$'\033[2m' BOLD=$'\033[1m' RESET=$'\033[0m'
else
  G='' Y='' R='' C='' DIM='' BOLD='' RESET=''
fi
_info() { printf '  %s  %s %s\n' "${DIM}│${RESET}" "${C}●${RESET}" "$*"; }
_ok() { printf '  %s  %s %s\n' "${DIM}│${RESET}" "${G}◆${RESET}" "$*" >&2; }
_warn() { printf '  %s  %s %s\n' "${DIM}│${RESET}" "${Y}●${RESET}" "$*" >&2; }
_die() { printf '  %s  %s %s\n' "${DIM}│${RESET}" "${R}✗${RESET}" "$*" >&2; exit 1; }

BUN="${SPINOSA_HOME}/bin/bun"
if [[ ! -x "$BUN" ]]; then
  BUN="$(command -v bun)"
fi
[[ -n "$BUN" && -x "$BUN" ]] || { printf '  %s  %s %s\n' "${DIM}│${RESET}" "${R}✗${RESET}" "bun not found" >&2; exit 1; }

# True when this SPINOSA_HOME is a binary product install that must not be
# overwritten by the source forwarder this script installs.
is_binary_product_install() {
  local config="${SPINOSA_HOME}/metadata/config.yaml"
  local active="${SPINOSA_HOME}/bin/spinosa"
  if [[ -f "$config" ]] && grep -Eq '^[[:space:]]*distribution:[[:space:]]*binary[[:space:]]*$' "$config"; then
    return 0
  fi
  if [[ -f "$active" && -x "$active" ]]; then
    # Compiled product binary (Mach-O / ELF), not a #! script / forwarder.
    local magic
    magic="$(od -An -tx1 -N4 "$active" 2>/dev/null | tr -d ' \n' || true)"
    case "$magic" in
      cffaedfe*|feedfacf*|cefaedfe*|feedface*|7f454c46*) return 0 ;;
    esac
  fi
  return 1
}

if is_binary_product_install; then
  cat >&2 <<EOF
Error: refusing to patch a binary Spinosa install at ${SPINOSA_HOME}.

  metadata/config.yaml has distribution: binary and/or
  ${SPINOSA_HOME}/bin/spinosa is a compiled product executable.

  patch-local-install.sh is for legacy/dev source installs only.
  Overwriting the product binary with a source forwarder would break
  the install. Use install.sh (or upgrade) for binary distributions.
EOF
  exit 1
fi

_info "Patching ${SPINOSA_HOME} with local repo v${VERSION}"
printf '  %s    %s\n' "${DIM}│${RESET}" "Shim dir: ${SPINOSA_BIN_DIR}"

mkdir -p "${SPINOSA_HOME}/versions" "${SPINOSA_HOME}/bin" "${SPINOSA_HOME}/metadata" "${SPINOSA_BIN_DIR}"
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.trash/' \
  --exclude '.cursor/' \
  --exclude 'terminals/' \
  "$ROOT/" "$TARGET/"

mkdir -p "${TARGET}/metadata" "${TARGET}/workspace-template/.bin"
printf '%s\n' "$VERSION" > "${TARGET}/metadata/version"
install -m 755 "${ROOT}/workspace-template/.bin/spinosa" "${TARGET}/workspace-template/.bin/spinosa"
install -m 755 "${ROOT}/workspace-template/.bin/spinosa" "${SPINOSA_HOME}/bin/spinosa"
install -m 755 "${ROOT}/workspace-template/.bin/spinosa" "${SPINOSA_BIN_DIR}/spinosa"

link_workspace_packages() {
  local root="$1" nm="${1}/node_modules/@spinosa"
  mkdir -p "$nm"
  for _pkg in "$root"/packages/*/; do
    [[ -f "${_pkg}package.json" ]] || continue
    _scoped="$(awk -F'"' '/"name":/ { print $4; exit }' "${_pkg}package.json")"
    [[ "$_scoped" == @spinosa/* ]] || continue
    _short="${_scoped#@spinosa/}"
    ln -sfn "../../packages/$(basename "$_pkg")" "${nm}/${_short}"
  done
}

_info "Installing dependencies in ${TARGET}"
(cd "$TARGET" && "$BUN" install --no-summary)
link_workspace_packages "$TARGET"

printf '%s %s\n' "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${TARGET}/.spinosa-install-complete"

bun "$ROOT/script/patch-local-install-metadata.ts" "$VERSION"

_info "Verifying patched runtime"
SPINOSA_HOME="$SPINOSA_HOME" SPINOSA_TEMPLATE_ROOT="$TARGET" \
  "$BUN" run "${TARGET}/packages/spinosa-kernel/src/index.ts" version

_ok "Patched ${SPINOSA_HOME} to local v${VERSION}"
printf '  %s    %s\n' "${DIM}│${RESET}" "Shim: ${SPINOSA_BIN_DIR}/spinosa"
printf '  %s    %s\n' "${DIM}│${RESET}" "Run: spinosa version"
printf '  %s    %s\n' "${DIM}│${RESET}" "Run: spinosa upgrade --check"
printf '  %s    %s\n' "${DIM}│${RESET}" "If command not found: source ${SPINOSA_HOME}/env.sh  (or open a new shell)"
