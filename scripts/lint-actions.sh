#!/usr/bin/env bash
# Lint GitHub Actions workflows with actionlint (expressions, syntax, runner
# labels). Self-provisions a pinned actionlint binary when none is installed,
# so clean runners and local checkouts behave identically: missing tooling is
# provisioned, never a reason to weaken the gate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACTIONLINT_VERSION="1.7.12"

if [ -t 2 ] && [ "${NO_COLOR:-}" != "1" ]; then
  G=$'\033[32m' R=$'\033[31m' RESET=$'\033[0m'
else
  G='' R='' RESET=''
fi

resolve_actionlint() {
  if command -v actionlint >/dev/null 2>&1; then
    command -v actionlint
    return 0
  fi
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) printf '  %s %s\n' "${R}✗${RESET}" "actionlint: unsupported OS $(uname -s)" >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="amd64" ;;
    *) printf '  %s %s\n' "${R}✗${RESET}" "actionlint: unsupported arch $(uname -m)" >&2; return 1 ;;
  esac
  local dir="${XDG_CACHE_HOME:-$HOME/.cache}/spinosa/actionlint-$ACTIONLINT_VERSION"
  local bin="$dir/actionlint"
  if [ ! -x "$bin" ]; then
    mkdir -p "$dir"
    local url="https://github.com/rhysd/actionlint/releases/download/v$ACTIONLINT_VERSION/actionlint_${ACTIONLINT_VERSION}_${os}_${arch}.tar.gz"
    printf 'actionlint %s not installed — downloading %s\n' "$ACTIONLINT_VERSION" "$url" >&2
    curl -fsSL "$url" | tar -xz -C "$dir" actionlint
    chmod +x "$bin"
  fi
  printf '%s\n' "$bin"
}

BIN="$(resolve_actionlint)"
"$BIN" "$ROOT"/.github/workflows/*.yml
printf '  %s %s\n' "${G}◆${RESET}" "actionlint passed" >&2
