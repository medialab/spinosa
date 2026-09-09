#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=(
  "$ROOT/install.sh"
  "$ROOT/workspace-template/.bin/spinosa"
)

if [ -t 2 ] && [ "${NO_COLOR:-}" != "1" ]; then
  G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' C=$'\033[36m'
  DIM=$'\033[2m' BOLD=$'\033[1m' RESET=$'\033[0m'
else
  G='' Y='' R='' C='' DIM='' BOLD='' RESET=''
fi

if ! command -v shellcheck >/dev/null 2>&1; then
  printf '  %s %s\n' "${R}✗${RESET}" "shellcheck is required for release validation but was not found" >&2
  printf '    %s\n' "Install with: brew install shellcheck" >&2
  exit 1
fi

shellcheck "${TARGETS[@]}"
printf '  %s %s\n' "${G}◆${RESET}" "shellcheck passed" >&2
