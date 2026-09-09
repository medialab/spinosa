#!/bin/sh
# shellcheck shell=bash
# ── install.sh — Spinosa binary installer (auto-re-execs with bash) ─────────

PINNED_VERSION="1.1.0-beta.8"
PINNED_TAG="beta"
DEFAULT_DOWNLOAD_TIMEOUT_SECONDS="600"
DEFAULT_VERIFY_TIMEOUT_SECONDS="180"
WAVE_WIDTH=6

if [ -z "${BASH_VERSION-}" ]; then
  if command -v bash >/dev/null 2>&1; then
    if [ -n "${0-}" ] && [ -f "${0-}" ]; then
      exec bash "$0" "$@"
    fi
    echo "" >&2
    echo "  This installer must be run under bash." >&2
    echo "  Please use one of the following:" >&2
    echo "    curl -fsSL --connect-timeout 30 --max-time 600 --retry 3 https://github.com/medialab/spinosa/releases/download/stable/install.sh -o /tmp/spinosa-install.sh && bash /tmp/spinosa-install.sh" >&2
    echo "    bash <(curl -fsSL https://github.com/medialab/spinosa/releases/download/stable/install.sh)" >&2
    echo "    curl -fsSL ... -o install.sh && bash install.sh" >&2
    echo "" >&2
    exit 1
  fi
  echo "" >&2
  echo "  Spinosa requires bash. Install it first:" >&2
  if command -v apk >/dev/null 2>&1; then
    echo "    apk add bash" >&2
  elif command -v apt-get >/dev/null 2>&1; then
    echo "    sudo apt-get install bash" >&2
  elif command -v brew >/dev/null 2>&1; then
    echo "    brew install bash" >&2
  else
    echo "    Install bash through your system package manager." >&2
  fi
  echo "" >&2
  exit 1
fi

set -euo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# UNIFIED LOGGING (${SPINOSA_HOME}/logs/spinosa.log)
# ══════════════════════════════════════════════════════════════════════════════

spinosa_log_file() {
  if [ -n "${SPINOSA_LOG_FILE:-}" ]; then
    printf '%s\n' "$SPINOSA_LOG_FILE"
    return 0
  fi
  printf '%s/logs/spinosa.log\n' "${SPINOSA_HOME:-$HOME/.spinosa}"
}

spinosa_log_init() {
  [ "${SPINOSA_LOG_DISABLED:-0}" = "1" ] && return 0
  local component="${1:-install}"
  shift || true
  local log_file
  log_file="$(spinosa_log_file)"
  mkdir -p "$(dirname "$log_file")" 2>/dev/null || return 0
  {
    printf '\n---\n'
    printf '%s component=%s pid=%s ppid=%s shell=%s cwd=%s' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$component" "$$" "$PPID" "${BASH_VERSION:-sh}" "$PWD"
    if [ $# -gt 0 ]; then
      printf ' argv=%q' "$@"
    fi
    printf '\n'
  } >> "$log_file" 2>/dev/null || true
}

spinosa_log() {
  [ "${SPINOSA_LOG_DISABLED:-0}" = "1" ] && return 0
  local level="$1"
  shift || true
  local log_file
  log_file="$(spinosa_log_file)"
  mkdir -p "$(dirname "$log_file")" 2>/dev/null || return 0
  printf '%s level=%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$*" >> "$log_file" 2>/dev/null || true
}

_spinosa_install_err_trap() {
  local exit_code=$? line=$1
  step_end "$exit_code" "${STEP_LABEL:-Install step} failed" 2>/dev/null || true
  spinosa_log ERROR "aborted line=${line} exit=${exit_code} cmd=${BASH_COMMAND:-}"
  restore_binary_backup_if_needed
  printf '\n  %s Install failed at line %s (exit %s). See %s\n\n' \
    "${R:-}✗${RESET:-}" "$line" "$exit_code" "$(spinosa_log_file)" >&2
  exit "$exit_code"
}

_spinosa_cleanup_lock() {
  if [ -n "${INSTALL_LOCKDIR:-}" ] && [ -f "${INSTALL_LOCKDIR}/pid" ]; then
    local _lp
    _lp="$(cat "${INSTALL_LOCKDIR}/pid" 2>/dev/null || true)"
    if [ "$_lp" = "$$" ]; then
      rm -rf "${INSTALL_LOCKDIR}" 2>/dev/null || true
    fi
  elif [ -n "${INSTALL_LOCKDIR:-}" ] && [ -z "$(ls -A "${INSTALL_LOCKDIR}" 2>/dev/null || true)" ]; then
    rmdir "${INSTALL_LOCKDIR}" 2>/dev/null || true
  fi
}

_spinosa_install_signal() {
  local exit_code="${1:-130}"
  trap - INT TERM HUP
  if [ -n "${STEP_COMMAND_PID:-}" ]; then
    kill_process_tree_graceful "$STEP_COMMAND_PID"
    # Wait with deadline — do not hang indefinitely if descendants ignore signals
    local waited=0
    while kill -0 "$STEP_COMMAND_PID" 2>/dev/null && [ "$waited" -lt 10 ]; do
      sleep 0.2
      waited=$((waited + 1))
    done
    wait "$STEP_COMMAND_PID" 2>/dev/null || true
    STEP_COMMAND_PID=""
  fi
  [ -n "${STEP_OUTPUT_FILE:-}" ] && rm -f "$STEP_OUTPUT_FILE" 2>/dev/null || true
  STEP_OUTPUT_FILE=""
  step_end "$exit_code" "${STEP_LABEL:-Install} cancelled" 2>/dev/null || true
  _spinosa_cleanup_lock
  if [ -n "${SPINOSA_EARLY_LOG:-}" ] && [ -f "$SPINOSA_EARLY_LOG" ]; then
    rm -f "$SPINOSA_EARLY_LOG" 2>/dev/null || true
  fi
  exit "$exit_code"
}

if [[ "${SPINOSA_INSTALLER_LIB_ONLY:-0}" != "1" ]]; then
  trap '_spinosa_install_err_trap $LINENO' ERR
fi

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

VERSION="${VERSION:-$PINNED_VERSION}"
DRY_RUN=0
VERIFY_ONLY=0
UPGRADE=0
REINSTALL=0
MIN_DAYS=""
YES=0
PREFIX_MODE=0
FROM_UPGRADE=0
VERBOSE="${VERBOSE:-0}"
if [[ "${SPINOSA_VERBOSE:-0}" == "1" ]]; then
  VERBOSE=1
fi
DEFAULT_SPINOSA_HOME="$HOME/.spinosa"
SPINOSA_HOME="${SPINOSA_HOME:-$DEFAULT_SPINOSA_HOME}"
SPINOSA_METADATA_DIR="${SPINOSA_HOME}/metadata"
SPINOSA_BIN_DIR="${SPINOSA_BIN_DIR:-$HOME/.local/bin}"
SPINOSA_STAGING_DIR="${SPINOSA_HOME}/.staging"
NO_MODIFY_PATH=false
REPO="medialab/spinosa"
PLATFORM=""
ASSET_NAME=""
TEMPLATE_PACK_ID=""
INSTALL_COMPLETED=0
BINARY_BACKUP=""
BINARY_STAGED=""
INSTALL_LOCKDIR=""
SHIM_STAGE_FILE=""
SPINOSA_ENV_FILE=""
SPINOSA_PATH_CONFIG_FILE=""
ACTIVATION_STARTED=0
SHIM_BACKUP=""
CONFIG_BACKUP=""
ENV_BACKUP=""

# ══════════════════════════════════════════════════════════════════════════════
# UI HELPERS
# ══════════════════════════════════════════════════════════════════════════════

if [ -t 2 ] && [ "${NO_COLOR:-}" != "1" ]; then
  G=$'\033[32m' Y=$'\033[31m' R=$'\033[31m' C=$'\033[36m'
  BOLD=$'\033[1m' RESET=$'\033[0m'
else
  G='' Y='' R='' C='' BOLD='' RESET=''
fi

info()  { spinosa_log INFO "$1"; printf '  %s %s\n' "${C}●${RESET}" "$1"; }
vinfo() { [[ "$VERBOSE" == "1" ]] || return 0; info "$1"; }
ok()    { spinosa_log INFO "$1"; printf '  %s %s\n' "${G}●${RESET}" "$1" >&2; }
vok()   { [[ "$VERBOSE" == "1" ]] || return 0; ok "$1"; }
warn()  { spinosa_log WARN "$1"; printf '  %s %s\n' "${Y}●${RESET}" "$1" >&2; }
note()  { spinosa_log INFO "$1"; printf '    %s\n' "$1"; }
vnote() { [[ "$VERBOSE" == "1" ]] || return 0; note "$1"; }
die()   { spinosa_log ERROR "$1"; printf '\n  %s %s\n\n' "${R}●${RESET}" "$1" >&2; exit 1; }
divider() { printf '\n'; }

intro() {
  local title="$1"
  spinosa_log INFO "intro=${title}"
  if [ -t 2 ]; then
    printf '  %s %s\n' "${C}●${RESET}" "$title" >&2
  else
    printf '%s\n' "$title" >&2
  fi
}
outro() {
  local msg="$1"
  spinosa_log INFO "outro=${msg}"
  if [ -t 2 ]; then
    printf '  %s %s\n' "${G}●${RESET}" "$msg" >&2
    printf '\n' >&2
  else
    printf '%s\n' "$msg" >&2
  fi
}

section() {
  local title="$1"
  spinosa_log INFO "section=${title}"
  if [ -t 2 ]; then
    printf '\n  %s %s%s%s\n' "→" "${BOLD}" "$title" "${RESET}"
  else
    printf '\n  → %s\n' "$title"
  fi
}

read_from_tty() {
  if [ -t 0 ]; then
    flush_pending_input
    IFS= read -r "$@"
  elif [ -r /dev/tty ]; then
    flush_pending_input
    IFS= read -r "$@" < /dev/tty
  else
    return 1
  fi
}

flush_pending_input() {
  # Safe bounded drain of pending typeahead on /dev/tty only.
  # The previous implementation drained the script's stdin pipe with
  # `read -t 0` which never consumes input and spins forever on
  # Linux Bash 5.x when stdin is a pipe at EOF. Never drain the
  # installer's script input stream; only discard a bounded amount
  # of pending data from the controlling terminal with a consuming read.
  if [ -r /dev/tty ]; then
    local _discard
    local _count=0
    while [ "$_count" -lt 5 ]; do
      if ! IFS= read -r -t 0.05 _discard </dev/tty 2>/dev/null; then
        break
      fi
      _count=$((_count + 1))
    done
  fi
}

read_tty_or_die() {
  if ! read_from_tty "$1"; then
    die "Cannot read from terminal. Use --yes to skip prompts."
  fi
}

STEP_RENDER_PID=""
STEP_COMMAND_PID=""
STEP_OUTPUT_FILE=""
STEP_LABEL=""
STEP_STARTED_AT=0

wave_string() {
  local frame="$1" wave="" i position level
  local -a glyphs=("▁" "▂" "▃" "▄" "▅" "▆" "▇" "█")
  for ((i = 0; i < WAVE_WIDTH; i++)); do
    position=$(((i + frame) % 14))
    level=$((position <= 6 ? position : 13 - position))
    wave+="${glyphs[level]}"
  done
  printf '%s' "$wave"
}

_render_wave() {
  local label="$1" timeout_seconds="$2" started_at="$3"
  local tick=0 elapsed wave bar
  while :; do
    elapsed=$(( $(date +%s) - started_at ))
    wave="$(wave_string "$tick")"
    bar="$wave"
    printf '\r\033[2K  %s %s [%s] %ss/%ss' "${C}●${RESET}" "$label" "$bar" "$elapsed" "$timeout_seconds" >&2
    tick=$((tick + 1))
    sleep 0.2
  done
}

step_begin() {
  STEP_LABEL="$1"
  local timeout_seconds="$2"
  STEP_STARTED_AT="$(date +%s)"
  spinosa_log INFO "step=start label=${STEP_LABEL} timeout=${timeout_seconds}s"
  if [ -t 2 ]; then
    _render_wave "$STEP_LABEL" "$timeout_seconds" "$STEP_STARTED_AT" &
    STEP_RENDER_PID=$!
  else
    printf '  %s %s (timeout %ss)\n' "${C}●${RESET}" "$STEP_LABEL" "$timeout_seconds" >&2
  fi
}

step_end() {
  local status="$1" message="${2:-$STEP_LABEL}" elapsed
  [ "$STEP_STARTED_AT" -gt 0 ] || return 0
  elapsed=$(( $(date +%s) - STEP_STARTED_AT ))
  if [ -n "$STEP_RENDER_PID" ]; then
    kill "$STEP_RENDER_PID" 2>/dev/null || true
    wait "$STEP_RENDER_PID" 2>/dev/null || true
    STEP_RENDER_PID=""
    printf '\r\033[2K' >&2
  fi
  if [ "$status" -eq 0 ]; then
    printf '  %s %s (%ss)\n' "${G}●${RESET}" "$message" "$elapsed" >&2
    spinosa_log INFO "step=ok label=${STEP_LABEL} elapsed=${elapsed}s"
  else
    printf '  %s %s (%ss)\n' "${R}●${RESET}" "$message" "$elapsed" >&2
    spinosa_log ERROR "step=fail label=${STEP_LABEL} elapsed=${elapsed}s status=${status}"
  fi
  STEP_STARTED_AT=0
  STEP_LABEL=""
}

terminate_process_tree() {
  local pid="$1" sig="${2:-TERM}" child
  # Collect children before signalling parent to avoid race
  local children
  children="$(
    if command -v pgrep >/dev/null 2>&1; then
      pgrep -P "$pid" 2>/dev/null || true
    else
      ps -eo pid=,ppid= 2>/dev/null | awk -v parent="$pid" '$2 == parent { print $1 }'
    fi
  )"
  for child in $children; do
    child="${child//[[:space:]]/}"
    [ -n "$child" ] || continue
    terminate_process_tree "$child" "$sig"
  done
  kill "-${sig}" "$pid" 2>/dev/null || kill "-${sig}" "-$pid" 2>/dev/null || kill -"${sig}" "$pid" 2>/dev/null || true
}

kill_process_tree_graceful() {
  local pid="$1"
  terminate_process_tree "$pid" TERM
  sleep 2
  if kill -0 "$pid" 2>/dev/null; then
    terminate_process_tree "$pid" KILL
    sleep 0.5
  fi
  # Reap any remaining descendants
  local remaining
  remaining="$(
    if command -v pgrep >/dev/null 2>&1; then
      pgrep -P "$pid" 2>/dev/null || true
    else
      ps -eo pid=,ppid= 2>/dev/null | awk -v parent="$pid" '$2 == parent { print $1 }'
    fi
  )"
  for child in $remaining; do
    kill -KILL "$child" 2>/dev/null || true
  done
  kill -KILL "$pid" 2>/dev/null || true
}

run_timed_step() {
  local label="$1" timeout_seconds="$2"
  shift 2
  [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || die "Invalid timeout for ${label}: ${timeout_seconds}"
  local output_file pid started status=0
  output_file="$(mktemp "${TMPDIR:-/tmp}/spinosa-step.XXXXXX")"
  STEP_OUTPUT_FILE="$output_file"
  step_begin "$label" "$timeout_seconds"
  started="$(date +%s)"
  (trap - ERR; "$@") >"$output_file" 2>&1 &
  pid=$!
  STEP_COMMAND_PID="$pid"
  while kill -0 "$pid" 2>/dev/null; do
    if (( $(date +%s) - started >= timeout_seconds )); then
      kill_process_tree_graceful "$pid"
      wait "$pid" 2>/dev/null || true
      STEP_COMMAND_PID=""
      step_end 124 "${label} timed out after ${timeout_seconds}s"
      while IFS= read -r line; do spinosa_log ERROR "$line"; done < "$output_file"
      tail -n 20 "$output_file" >&2 || true
      spinosa_log ERROR "${label} timed out after ${timeout_seconds}s — last 20 lines preserved above"
      rm -f "$output_file"
      STEP_OUTPUT_FILE=""
      return 124
    fi
    sleep 0.2
  done
  wait "$pid" || status=$?
  STEP_COMMAND_PID=""
  while IFS= read -r line; do spinosa_log INFO "${label}: ${line}"; done < "$output_file"
  if [ "$status" -ne 0 ]; then
    step_end "$status" "${label} failed"
    tail -n 20 "$output_file" >&2
    rm -f "$output_file"
    STEP_OUTPUT_FILE=""
    return "$status"
  fi
  rm -f "$output_file"
  STEP_OUTPUT_FILE=""
  step_end 0 "$label"
}

spinner_start() { step_begin "$1" "${2:-30}"; }
spinner_stop() { step_end 0 "${1:-$STEP_LABEL}"; }

# ══════════════════════════════════════════════════════════════════════════════
# FLAG PARSING
# ══════════════════════════════════════════════════════════════════════════════

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || die "--version requires a value (use X.Y.Z or 'latest')"
      VERSION="$2"; shift 2
      if [[ "$VERSION" != "latest" && ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$ ]]; then
        die "Invalid version: $VERSION (use X.Y.Z, X.Y.Z-pre, or 'latest')"
      fi
      ;;
    --latest)     VERSION="latest"; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --upgrade)    UPGRADE=1; shift ;;
    --reinstall)  REINSTALL=1; shift ;;
    --no-bundled-tools|--no-gum)
      warn "--no-bundled-tools is deprecated and ignored (binary distribution does not install Bun)"
      shift
      ;;
    --no-modify-path) NO_MODIFY_PATH=true; shift ;;
    --launch)     die "--launch is not supported by the installer; run 'spinosa' after installation" ;;
    --no-launch)  shift ;;
    --min-days)
      [ $# -ge 2 ] || die "--min-days requires a positive integer"
      MIN_DAYS="$2"; shift 2 ;;
    --prefix)
      [ $# -ge 2 ] || die "--prefix requires a directory path"
      SPINOSA_HOME="$2"
      SPINOSA_METADATA_DIR="${SPINOSA_HOME}/metadata"
      SPINOSA_STAGING_DIR="${SPINOSA_HOME}/.staging"
      PREFIX_MODE=1
      shift 2
      ;;
    --bin-dir)
      [ $# -ge 2 ] || die "--bin-dir requires a directory path"
      SPINOSA_BIN_DIR="$2"; shift 2 ;;
    --dev)        die "--dev is not implemented; clone the repository and follow DEVELOPMENT.md" ;;
    --from-upgrade) FROM_UPGRADE=1; shift ;;
    --verbose)    VERBOSE=1; shift ;;
    --yes|-y)     YES=1; shift ;;
    --)           shift; break ;;
    --help|-h)
      echo "Usage: bash install.sh [options]"
      echo ""
      echo "Install / Upgrade:"
      echo "  --version X.Y.Z   Install specific version (default: $PINNED_VERSION)"
      echo "  --latest          Use latest release instead of pinned version"
      echo "  --upgrade         Upgrade if a newer version is available"
      echo "  --reinstall       Reinstall even if same version"
      echo "  --dry-run         Show what would happen without doing it"
      echo "  --verify-only     Verify installed binary, do not install"
      echo "  --yes             Skip prompts; auto-upgrade and auto-repair if needed"
      echo "  --no-launch       Compatibility flag; the installer never auto-launches"
      echo "  --verbose         Show detailed progress (debug)"
      echo ""
      echo "Security:"
      echo "  --min-days N      Reject releases newer than N days old"
      echo ""
      echo "Environment:"
      echo "  SPINOSA_REPAIR=1            Auto-repair without prompting"
      echo "  SPINOSA_RELEASE_BASE_URL    Override release asset base URL (local smoke)"
      echo ""
      echo "Paths:"
      echo "  --no-modify-path  Don't modify shell config files (~/.zshrc, etc.)"
      echo "  --prefix PATH     Install root (default: ~/.spinosa)"
      echo "  --bin-dir PATH    Shim directory (default: ~/.local/bin)"
      echo "  --no-bundled-tools  Deprecated no-op (kept for transition scripts)"
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
done

# Allow Node caller (spinosa upgrade) to signal that it already showed the outer intro/logo
if [[ "${SPINOSA_UPGRADE:-0}" == "1" ]]; then
  FROM_UPGRADE=1
fi

# ══════════════════════════════════════════════════════════════════════════════
# PLATFORM / ASSETS
# ══════════════════════════════════════════════════════════════════════════════

# Map host OS/arch to a canonical product target (x64, never amd64 in asset names).
map_platform() {
  local os_raw="$1" arch_raw="$2"
  local os arch
  os_raw="$(printf '%s' "$os_raw" | tr '[:upper:]' '[:lower:]')"
  arch_raw="$(printf '%s' "$arch_raw" | tr '[:upper:]' '[:lower:]')"

  case "$os_raw" in
    darwin|macos|osx) os="darwin" ;;
    linux) os="linux" ;;
    *)
      printf '\n  %s %s\n' "${Y}●${RESET}" "Your OS \"$1\" is not supported." >&2
      printf '    %s\n' "Spinosa currently supports macOS (Apple Silicon & Intel) and Linux (glibc) on arm64 and x64." >&2
      printf '    %s\n' "See https://github.com/medialab/spinosa#requirements for alternatives." >&2
      printf 'Unsupported OS for binary distribution: %s\n' "$1" >&2
      return 1
      ;;
  esac

  case "$arch_raw" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64|x64) arch="x64" ;;
    *)
      printf '\n  %s %s\n' "${Y}●${RESET}" "Your CPU architecture \"$2\" is not supported." >&2
      printf '    %s\n' "Spinosa currently supports arm64 and x64 (amd64) on macOS and Linux (glibc)." >&2
      printf '    %s\n' "See https://github.com/medialab/spinosa#requirements for alternatives." >&2
      printf 'Unsupported architecture for binary distribution: %s\n' "$2" >&2
      return 1
      ;;
  esac

  printf '%s-%s\n' "$os" "$arch"
}

# Pure probe classifier (testable). Args: alpine_release(0|1) ld_musl(0|1) ldd_version_text
classify_musl_linux() {
  local alpine_release="${1:-0}"
  local ld_musl="${2:-0}"
  local ldd_text="${3:-}"
  [ "$alpine_release" = "1" ] && return 0
  [ "$ld_musl" = "1" ] && return 0
  printf '%s\n' "$ldd_text" | grep -qi musl && return 0
  return 1
}

# Detect musl/Alpine Linux before download. Darwin and glibc Linux return false.
is_musl_linux() {
  local os_raw alpine=0 ld_musl=0 ldd_text=""
  os_raw="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  [ "$os_raw" = "linux" ] || return 1

  [ -f /etc/alpine-release ] && alpine=1
  # Dynamic linker path used by musl (e.g. /lib/ld-musl-x86_64.so.1).
  if compgen -G '/lib/ld-musl-*' > /dev/null 2>&1; then
    ld_musl=1
  fi
  if command -v ldd >/dev/null 2>&1; then
    ldd_text="$(ldd --version 2>&1 || true)"
  fi
  classify_musl_linux "$alpine" "$ld_musl" "$ldd_text"
}

refuse_musl_linux() {
  if is_musl_linux; then
    die "musl/Alpine Linux is unsupported; Spinosa needs glibc Linux (or macOS). Binary assets are glibc-only."
  fi
}

detect_platform() {
  local mapped
  refuse_musl_linux
  mapped="$(map_platform "$(uname -s)" "$(uname -m)")" \
    || die "Unsupported platform: $(uname -s) $(uname -m) — Spinosa supports macOS (Apple Silicon & Intel) and Linux (glibc) on arm64/x64 only. See https://github.com/medialab/spinosa#requirements"
  PLATFORM="$mapped"
  ASSET_NAME="spinosa-${PLATFORM}"
  vinfo "Platform: ${PLATFORM}"
}

release_asset_base() {
  if [ -n "${SPINOSA_RELEASE_BASE_URL:-}" ]; then
    printf '%s\n' "${SPINOSA_RELEASE_BASE_URL%/}"
  else
    printf 'https://github.com/%s/releases/download/v%s\n' "$REPO" "$VERSION"
  fi
}

channel_install_url() {
  local channel="$1"
  if [ -n "${SPINOSA_RELEASE_BASE_URL:-}" ]; then
    printf '%s/install.sh\n' "${SPINOSA_RELEASE_BASE_URL%/}"
    return 0
  fi
  case "$channel" in
    stable) printf 'https://github.com/%s/releases/download/stable/install.sh\n' "$REPO" ;;
    beta|dev) printf 'https://github.com/%s/releases/download/beta/install.sh\n' "$REPO" ;;
    *) die "Unknown release channel: ${channel}" ;;
  esac
}

# ══════════════════════════════════════════════════════════════════════════════
# OWNERSHIP / PATH GUARDS
# ══════════════════════════════════════════════════════════════════════════════

is_owned_spinosa_shim() {
  local shim="$1"
  [ -f "$shim" ] || return 1
  grep -Fqx '# Managed by Spinosa install.sh' "$shim" 2>/dev/null && return 0

  # Legacy pre-marker / bash-forwarder shapes.
  # shellcheck disable=SC2016
  if grep -Fq 'target="${home}/bin/spinosa"' "$shim" 2>/dev/null \
    || grep -Fq 'target="$home/bin/spinosa"' "$shim" 2>/dev/null; then
    # shellcheck disable=SC2016
    if grep -Fq 'exec bash "$target" "$@"' "$shim" 2>/dev/null \
      || grep -Fq 'exec "$target" "$@"' "$shim" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

preflight_tools() {
  local tool
  for tool in awk sed grep mktemp find mkdir mv chmod; do
    command -v "$tool" >/dev/null 2>&1 || die "Required tool not found: ${tool}"
  done
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 \
    || die "Neither curl nor wget found. Please install one."
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 \
    || die "No SHA-256 tool found (sha256sum or shasum)"
}

prompt_install_repair() {
  local detail="${1:-Something in the Spinosa install needs fixing.}"
  printf '\n' >&2
  printf '  %s %s\n' "${Y}●${RESET}" "Installation needs repair." >&2
  printf '    %s\n' "$detail" >&2
  if [ "${SPINOSA_REPAIR:-}" = "1" ]; then
    info "Repairing automatically (SPINOSA_REPAIR=1)..."
    return 0
  fi
  if [ "$YES" -eq 1 ]; then
    info "Repairing automatically (--yes)..."
    return 0
  fi
  printf '  %s %s [Y/n]: ' "${C}?${RESET}" "Repair now?" >&2
  local reply
  if ! read_from_tty reply; then
    printf '\n' >&2
    warn "No terminal for repair prompt. Re-run with --yes to auto-repair."
    return 1
  fi
  reply="${reply:-Y}"
  case "$reply" in
    n|N|no|NO)
      info "Repair cancelled."
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

is_legacy_spinosa_home() {
  local home="$1"
  # v0.5/v0.6: metadata/install.yaml with install record
  if [ -f "${home}/metadata/install.yaml" ] && grep -q 'last_installed_version' "${home}/metadata/install.yaml" 2>/dev/null; then
    return 0
  fi
  # v0.7/v0.8: completion stamp under versions tree
  if [ -d "${home}/versions" ]; then
    local _entry
    for _entry in "${home}/versions"/*; do
      [ -e "$_entry" ] || continue
      [ -f "${_entry}/.spinosa-install-complete" ] && return 0
    done
  fi
  # v0.8 config without spinosa:true but with last_installed_version
  if [ -f "${home}/metadata/config.yaml" ] && grep -q 'last_installed_version' "${home}/metadata/config.yaml" 2>/dev/null; then
    if ! grep -q '^spinosa: true$' "${home}/metadata/config.yaml" 2>/dev/null; then
      return 0
    fi
  fi
  # Root-level legacy metadata (pre-metadata dir migration)
  if [ -f "${home}/config.yaml" ] && grep -q 'last_installed_version' "${home}/config.yaml" 2>/dev/null; then
    return 0
  fi
  if [ -f "${home}/install.yaml" ] && grep -q 'last_installed_version' "${home}/install.yaml" 2>/dev/null; then
    return 0
  fi
  return 1
}

is_reclaimable_spinosa_home() {
  local home="$1"
  local entry base
  [ -d "$home" ] || return 1
  # Legacy installs must never be treated as disposable debris
  if is_legacy_spinosa_home "$home"; then
    return 1
  fi
  if grep -q '^spinosa: true$' "${home}/metadata/config.yaml" 2>/dev/null \
    || [ -f "${home}/metadata/workspaces.json" ] \
    || [ -f "${home}/workspace_cache.txt" ]; then
    return 1
  fi
  if [ -x "${home}/bin/spinosa" ]; then
    return 1
  fi
  if [ -d "${home}/versions" ]; then
    for entry in "${home}/versions"/*; do
      [ -e "$entry" ] || continue
      [ -d "$entry" ] || continue
      base="$(basename "$entry")"
      case "$base" in
        .|..|.install.lock) continue ;;
      esac
      if [[ "$base" == .* ]]; then
        continue
      fi
      if [ -f "${entry}/.spinosa-install-complete" ]; then
        return 1
      fi
    done
  fi
  local found=0
  for entry in "$home"/* "$home"/.[!.]* "$home"/..?*; do
    [ -e "$entry" ] || continue
    base="$(basename "$entry")"
    case "$base" in
      .|..) continue ;;
      logs|versions|bin|lib|metadata|env.sh|templates|.staging)
        found=1
        continue
        ;;
      *) return 1 ;;
    esac
  done
  [ "$found" -eq 1 ]
}

spinosa_home_is_owned() {
  local home="${1:-$SPINOSA_HOME}"
  grep -q '^spinosa: true$' "${home}/metadata/config.yaml" 2>/dev/null \
    || [ -f "${home}/metadata/workspaces.json" ] \
    || [ -f "${home}/workspace_cache.txt" ] \
    || is_legacy_spinosa_home "$home"
}

legacy_source_runtime_present() {
  local home="${1:-$SPINOSA_HOME}"
  [ -d "${home}/versions" ]
}

spinosa_home_needs_repair() {
  local home="${1:-$SPINOSA_HOME}"

  [ -d "$home" ] || return 1

  if is_reclaimable_spinosa_home "$home"; then
    return 0
  fi

  if spinosa_home_is_owned "$home"; then
    if [ ! -x "${home}/bin/spinosa" ]; then
      return 0
    fi
  fi
  return 1
}

validate_install_paths() {
  local path
  for path in "$SPINOSA_HOME" "$SPINOSA_BIN_DIR"; do
    [ -n "$path" ] || die "Install paths must not be empty"
    case "$path" in
      /*) ;;
      *) die "Install paths must be absolute: ${path}" ;;
    esac
    case "$path" in
      /|/bin|/sbin|/usr|/usr/bin|/usr/sbin|/etc|/var|/lib|/lib64|/System|/Applications)
        die "Refusing unsafe install path: ${path}" ;;
    esac
  done

  if [ -d "$SPINOSA_HOME" ] \
    && [ -n "$(find "$SPINOSA_HOME" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ] \
    && ! spinosa_home_is_owned "$SPINOSA_HOME" \
    && ! is_reclaimable_spinosa_home "$SPINOSA_HOME"; then
    die "Install root is not an owned Spinosa directory: ${SPINOSA_HOME}. Choose an empty directory."
  fi

  if [ "$PREFIX_MODE" -eq 0 ] && [ -e "${SPINOSA_BIN_DIR}/spinosa" ] \
    && ! is_owned_spinosa_shim "${SPINOSA_BIN_DIR}/spinosa"; then
    die "Refusing to overwrite non-Spinosa command: ${SPINOSA_BIN_DIR}/spinosa. Move it or choose --bin-dir."
  fi
}

assert_spinosa_home_path_safe() {
  local home="${1:-$SPINOSA_HOME}"
  [ -n "$home" ] || die "SPINOSA_HOME is unset — refusing destructive repair"
  case "$home" in
    /*) ;;
    *) die "SPINOSA_HOME must be absolute — refusing destructive repair: ${home}" ;;
  esac
  case "$home" in
    /|/bin|/sbin|/usr|/usr/bin|/usr/sbin|/etc|/var|/lib|/lib64|/home|/Users|"$HOME")
      die "Refusing destructive repair on unsafe SPINOSA_HOME: ${home}"
      ;;
  esac
  [ "$home" = "$SPINOSA_HOME" ] \
    || die "Refusing destructive repair outside configured SPINOSA_HOME (${SPINOSA_HOME})"
}

assert_path_inside_spinosa_home() {
  local candidate="$1"
  local home="$SPINOSA_HOME"
  local home_phys candidate_phys

  assert_spinosa_home_path_safe "$home"
  [ -n "$candidate" ] || die "Refusing empty path in Spinosa home"

  case "$candidate" in
    "$home"|"$home"/*) ;;
    *) die "Refusing path outside SPINOSA_HOME: ${candidate}" ;;
  esac

  if [ -e "$home" ] && [ -e "$candidate" ]; then
    home_phys="$(cd "$home" && pwd -P 2>/dev/null || printf '%s\n' "$home")"
    if [ -d "$candidate" ]; then
      candidate_phys="$(cd "$candidate" && pwd -P 2>/dev/null || printf '%s\n' "$candidate")"
    else
      candidate_phys="$(cd "$(dirname "$candidate")" && pwd -P 2>/dev/null)/$(basename "$candidate")"
    fi
    case "$candidate_phys" in
      "$home_phys"|"$home_phys"/*) ;;
      *) die "Refusing path that escapes SPINOSA_HOME via resolution: ${candidate}" ;;
    esac
  fi
}

remove_spinosa_home_entry() {
  local rel="$1"
  local target
  case "$rel" in
    ''|'.'|'..'|*'/'*|*'..'*)
      die "Refusing unsafe relative entry name: ${rel}"
      ;;
  esac
  target="${SPINOSA_HOME}/${rel}"
  assert_path_inside_spinosa_home "$target"
  [ "$target" != "$SPINOSA_HOME" ] || die "Refusing to delete SPINOSA_HOME itself"
  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -rf "$target"
  fi
}

clear_virgin_install_debris() {
  local home="$SPINOSA_HOME"
  local rel

  assert_spinosa_home_path_safe "$home"

  if spinosa_home_is_owned "$home"; then
    die "Refusing to clear owned Spinosa home: ${home}"
  fi

  is_reclaimable_spinosa_home "$home" \
    || die "Refusing virgin debris clear — home is not reclaimable installer debris"

  for rel in logs env.sh bin lib metadata versions templates .staging; do
    if spinosa_home_is_owned "$home"; then
      die "Refusing virgin debris clear — home became owned mid-repair"
    fi
    remove_spinosa_home_entry "$rel"
  done

  [ -d "$home" ] || mkdir -p "$home"
  ok "Removed virgin install debris under ${home} (home directory preserved)"
}

ensure_spinosa_home() {
  local detail=""

  assert_spinosa_home_path_safe "$SPINOSA_HOME"

  if is_reclaimable_spinosa_home "$SPINOSA_HOME"; then
    detail="Installer debris was found under ${SPINOSA_HOME} (likely a failed earlier attempt). Only known debris paths will be removed — your home directory is kept."
  elif spinosa_home_needs_repair "$SPINOSA_HOME"; then
    detail="An incomplete or broken Spinosa binary install was found under ${SPINOSA_HOME}. The installer will re-download the platform binary; workspace metadata is kept."
    REINSTALL=1
  else
    return 0
  fi

  if ! prompt_install_repair "$detail"; then
    die "Installation needs repair. Re-run with --yes (or SPINOSA_REPAIR=1) to allow repair, or choose an empty --prefix."
  fi

  if is_reclaimable_spinosa_home "$SPINOSA_HOME"; then
    clear_virgin_install_debris
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# DOWNLOAD / CHECKSUMS
# ══════════════════════════════════════════════════════════════════════════════

download() {
  local url="$1" dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fSL --retry 3 --retry-delay 3 --silent --show-error --max-time 600 --connect-timeout 30 "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=30 --tries=4 "$url" -O "$dest"
  else
    die "Neither curl nor wget found. Please install one."
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "No SHA-256 tool (sha256sum or shasum) found. Cannot verify checksums."
  fi
}

verify_checksum() {
  local file="$1" expected="$2"
  local actual
  actual="$(sha256_file "$file")"
  if [ "$actual" = "$expected" ]; then
    return 0
  fi
  return 1
}

# Exact asset checksum lookup: rejects missing, duplicate, and malformed entries.
lookup_asset_checksum() {
  local filename="$1" checksums_file="$2"
  local hash name count=0 expected=""

  [ -f "$checksums_file" ] || die "Checksums file missing: ${checksums_file}"

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -n "$line" ] || continue
    case "$line" in
      \#*) continue ;;
    esac
    local hash="" name="" extra=""
    # shellcheck disable=SC2034
    read -r hash name extra <<<"$line" || true
    if [ -z "$hash" ] || [ -z "$name" ] || [ -n "$extra" ]; then
      die "Malformed checksums entry: ${line}"
    fi
    if [[ ! "$hash" =~ ^[0-9a-fA-F]{64}$ ]]; then
      die "Malformed checksum hash: ${line}"
    fi
    if [ "$name" = "$filename" ]; then
      count=$((count + 1))
      expected="$hash"
    fi
  done < "$checksums_file"

  if [ "$count" -eq 0 ]; then
    die "${filename} not found in checksums file — aborting for safety"
  fi
  if [ "$count" -gt 1 ]; then
    die "Duplicate checksum entries for ${filename} — aborting for safety"
  fi
  printf '%s\n' "$expected"
}

verify_asset_checksum() {
  local file="$1" filename="$2" checksums_file="$3" label="$4"
  local expected_hash
  expected_hash="$(lookup_asset_checksum "$filename" "$checksums_file")"
  if verify_checksum "$file" "$expected_hash"; then
    vok "${label} checksum verified"
  else
    die "${label} checksum mismatch — aborting for safety"
  fi
}

available_disk_bytes() {
  local path="$1"
  if df -kP "$path" >/dev/null 2>&1; then
    df -kP "$path" | awk 'NR==2 { print $4 * 1024; exit }'
  elif df -k "$path" >/dev/null 2>&1; then
    df -k "$path" | awk 'NR==2 { print $4 * 1024; exit }'
  fi
}

check_download_disk_space() {
  local required_bytes=$((100 * 1024 * 1024))
  local check_path free_bytes
  for check_path in "${TMPDIR:-/tmp}" "${SPINOSA_HOME}" "${SPINOSA_BIN_DIR}"; do
    mkdir -p "$check_path" 2>/dev/null || true
    free_bytes="$(available_disk_bytes "$check_path" 2>/dev/null || true)"
    [[ "$free_bytes" =~ ^[0-9]+$ ]] || continue
    if (( free_bytes < required_bytes )); then
      die "Need ~100MB free on $(dirname "$check_path") ($check_path), have $((free_bytes / 1024 / 1024))MB"
    fi
  done
}

# ══════════════════════════════════════════════════════════════════════════════
# METADATA / VERSION
# ══════════════════════════════════════════════════════════════════════════════

installer_release_channel() {
  case "$PINNED_TAG" in
    stable) printf '%s\n' "stable" ;;
    beta|dev) printf '%s\n' "beta" ;;
    v*)
      if [[ "$PINNED_VERSION" == *-* ]]; then
        printf '%s\n' "beta"
      else
        printf '%s\n' "stable"
      fi
      ;;
    *)
      if [[ "$PINNED_VERSION" == *-* ]]; then
        printf '%s\n' "beta"
      else
        printf '%s\n' "stable"
      fi
      ;;
  esac
}

installer_beta_toggle() {
  case "$(installer_release_channel)" in
    beta) printf '%s\n' "true" ;;
    *) printf '%s\n' "false" ;;
  esac
}

init_global_metadata() {
  mkdir -p "$SPINOSA_METADATA_DIR"
  local name legacy current
  for name in config.yaml workspace_cache.txt workspaces.json workspaces.txt; do
    legacy="${SPINOSA_HOME}/${name}"
    current="${SPINOSA_METADATA_DIR}/${name}"
    if [ -f "$legacy" ] && [ ! -f "$current" ]; then
      if mv "$legacy" "$current" 2>/dev/null; then
        spinosa_log INFO "migrated ${legacy} to ${current} via mv"
      elif cp "$legacy" "$current" 2>/dev/null; then
        spinosa_log INFO "migrated ${legacy} to ${current} via cp"
        rm -f "$legacy" 2>/dev/null || true
      else
        warn "Failed to migrate ${legacy} to ${current} — original preserved; manual review may be needed"
        spinosa_log WARN "metadata migration failed legacy=${legacy} current=${current}"
        # Do not remove legacy; leave it for manual recovery and do not treat as fatal yet.
      fi
      if [ ! -f "$current" ]; then
        spinosa_log ERROR "metadata migration left no current file at ${current}"
      fi
    fi
  done
}

config_set_key() {
  local config="$1" key="$2" value="$3"
  local tmp="${config}.tmp.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key ":") == 1 { print key ": " value; found = 1; next }
    { print }
    END { if (!found) print key ": " value }
  ' "$config" > "$tmp"
  mv "$tmp" "$config"
}

config_delete_key() {
  local config="$1" key="$2"
  [ -f "$config" ] || return 0
  local tmp="${config}.tmp.$$"
  awk -v key="$key" 'index($0, key ":") != 1 { print }' "$config" > "$tmp"
  mv "$tmp" "$config"
}

write_install_metadata() {
  mkdir -p "$SPINOSA_METADATA_DIR"
  # Backup config for rollback before mutating
  CONFIG_BACKUP=""
  local config="${SPINOSA_METADATA_DIR}/config.yaml"
  if [ -f "$config" ]; then
    CONFIG_BACKUP="${SPINOSA_STAGING_DIR}/config.backup.$$"
    cp "$config" "$CONFIG_BACKUP" 2>/dev/null || CONFIG_BACKUP=""
  fi
  local install_tmp="${SPINOSA_METADATA_DIR}/install.yaml.tmp.$$"
  cat > "$install_tmp" << EOF
# Install state — machine-generated
install_root: "${SPINOSA_HOME}"
bin_dir: "${SPINOSA_BIN_DIR}"
distribution: binary
EOF
  if ! mv "$install_tmp" "${SPINOSA_METADATA_DIR}/install.yaml"; then
    restore_binary_backup_if_needed
    die "Failed to write install.yaml"
  fi

  if [ ! -f "$config" ]; then
    local config_tmp="${config}.tmp.$$"
    cat > "$config_tmp" << CONFIG_EOF
# Spinosa installation marker — do not remove
spinosa: true
beta: $(installer_beta_toggle)
auto_upgrade: true
distribution: binary
last_installed_version: "${VERSION}"
CONFIG_EOF
    if [ -n "${TEMPLATE_PACK_ID:-}" ]; then
      printf 'template_pack_id: "%s"\n' "$TEMPLATE_PACK_ID" >> "$config_tmp"
    fi
    if legacy_source_runtime_present; then
      printf 'legacy_source_runtime: true\n' >> "$config_tmp"
    fi
    mv "$config_tmp" "$config"
  else
    config_set_key "$config" "spinosa" "true"
    config_set_key "$config" "beta" "$(installer_beta_toggle)"
    config_delete_key "$config" "release_channel"
    config_set_key "$config" "distribution" "binary"
    config_set_key "$config" "last_installed_version" "\"${VERSION}\""
    if [ -n "${TEMPLATE_PACK_ID:-}" ]; then
      config_set_key "$config" "template_pack_id" "\"${TEMPLATE_PACK_ID}\""
    fi
    if legacy_source_runtime_present; then
      config_set_key "$config" "legacy_source_runtime" "true"
    else
      config_delete_key "$config" "legacy_source_runtime"
    fi
  fi
}

read_last_installed_version() {
  local file="${SPINOSA_METADATA_DIR}/config.yaml"
  [ -f "$file" ] || return 1
  awk '$1 == "last_installed_version:" { gsub(/"/, "", $2); print $2; exit }' "$file"
}

compare_versions() {
  if [ "$1" = "$2" ]; then return 0; fi
  local a="${1%%+*}" b="${2%%+*}" a_core b_core a_pre="" b_pre=""
  a_core="${a%%-*}"; b_core="${b%%-*}"
  [[ "$a" == *-* ]] && a_pre="${a#*-}"
  [[ "$b" == *-* ]] && b_pre="${b#*-}"

  local -a a_parts b_parts a_ids b_ids
  local index av bv max
  IFS=. read -r -a a_parts <<< "$a_core"
  IFS=. read -r -a b_parts <<< "$b_core"
  for index in 0 1 2; do
    av=$((10#${a_parts[index]:-0})); bv=$((10#${b_parts[index]:-0}))
    (( av < bv )) && return 2
    (( av > bv )) && return 1
  done

  [ -z "$a_pre" ] && return 1
  [ -z "$b_pre" ] && return 2
  IFS=. read -r -a a_ids <<< "$a_pre"
  IFS=. read -r -a b_ids <<< "$b_pre"
  max=${#a_ids[@]}; (( ${#b_ids[@]} > max )) && max=${#b_ids[@]}
  for ((index = 0; index < max; index++)); do
    (( index < ${#a_ids[@]} )) || return 2
    (( index < ${#b_ids[@]} )) || return 1
    av="${a_ids[index]}"; bv="${b_ids[index]}"
    [ "$av" = "$bv" ] && continue
    if [[ "$av" =~ ^[0-9]+$ && "$bv" =~ ^[0-9]+$ ]]; then
      (( 10#$av < 10#$bv )) && return 2 || return 1
    fi
    [[ "$av" =~ ^[0-9]+$ ]] && return 2
    [[ "$bv" =~ ^[0-9]+$ ]] && return 1
    [[ "$av" < "$bv" ]] && return 2 || return 1
  done
  return 0
}

parse_version_output() {
  local raw="$1"
  local line json_ver
  json_ver="$(printf '%s\n' "$raw" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if [ -n "$json_ver" ]; then
    printf '%s\n' "$json_ver"
    return 0
  fi
  line="$(printf '%s\n' "$raw" | head -1 | tr -d '\r')"
  line="${line#spinosa }"
  line="${line#v}"
  line="$(printf '%s' "$line" | awk '{print $1}')"
  if [[ "$line" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$ ]]; then
    printf '%s\n' "$line"
    return 0
  fi
  return 1
}

extract_template_pack_id() {
  local raw="$1"
  local pack
  pack="$(printf '%s\n' "$raw" | sed -n 's/.*"template_pack_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if [ -z "$pack" ]; then
    pack="$(printf '%s\n' "$raw" | sed -n 's/.*"templatePackId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  fi
  [ -n "$pack" ] && printf '%s\n' "$pack"
}

probe_spinosa_version_output() {
  local binary="$1"
  local out_file pid waited
  out_file="$(mktemp "${TMPDIR:-/tmp}/spinosa-probe.XXXXXX")"
  (
    "$binary" version --json 2>/dev/null || "$binary" version 2>/dev/null || true
  ) >"$out_file" 2>&1 &
  pid=$!
  waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge 25 ]; then
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      rm -f "$out_file"
      return 1
    fi
    sleep 0.2
    waited=$((waited + 1))
  done
  wait "$pid" 2>/dev/null || true
  cat "$out_file" 2>/dev/null || true
  rm -f "$out_file"
}

get_installed_version() {
  local meta_ver=""
  meta_ver="$(read_last_installed_version 2>/dev/null || true)"
  if [ -x "${SPINOSA_HOME}/bin/spinosa" ] && [ -n "$meta_ver" ]; then
    printf '%s\n' "$meta_ver"
    return 0
  fi
  if [ -x "${SPINOSA_HOME}/bin/spinosa" ]; then
    local out ver
    if out="$(probe_spinosa_version_output "${SPINOSA_HOME}/bin/spinosa" 2>/dev/null || true)"; then
      if [ -n "$out" ] && ver="$(parse_version_output "$out")"; then
        printf '%s\n' "$ver"
        return 0
      fi
    fi
    # Probe timed out or failed — treat as unhealthy, fall through to metadata
    spinosa_log WARN "version probe timed out or failed for ${SPINOSA_HOME}/bin/spinosa"
  fi
  if [ -n "$meta_ver" ]; then
    printf '%s\n' "$meta_ver"
    return 0
  fi
  return 0
}

resolve_pinned_version_from_installer() {
  local channel="$1" url="$2"
  local installer_file resolved
  installer_file="$(mktemp "${TMPDIR:-/tmp}/spinosa-channel.XXXXXX")"
  run_timed_step "Resolve latest ${channel} release" 60 download "$url" "$installer_file" \
    || { rm -f "$installer_file"; die "Could not resolve latest ${channel} version. Use --version."; }
  resolved="$(awk -F'"' '/^PINNED_VERSION=/ { print $2; exit }' "$installer_file" || true)"
  rm -f "$installer_file"
  [[ "$resolved" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$ ]] \
    || die "${channel} channel returned an invalid version: ${resolved:-missing}"
  printf '%s\n' "$resolved"
}

resolve_version() {
  if [ "$VERSION" = "latest" ]; then
    local channel url resolved
    channel="$(installer_release_channel)"
    url="$(channel_install_url "$channel")"
    resolved="$(resolve_pinned_version_from_installer "$channel" "$url")"
    VERSION="$resolved"
    info "Latest ${channel} version: ${VERSION}"
  fi
}

check_release_age() {
  local version="$1" min_days="$2"
  [ -n "$min_days" ] || return 0
  [ "$min_days" -gt 0 ] 2>/dev/null || die "--min-days must be a positive integer (got: $min_days)"

  if [ -n "${SPINOSA_RELEASE_BASE_URL:-}" ]; then
    warn "--min-days skipped when SPINOSA_RELEASE_BASE_URL is set"
    return 0
  fi

  local api_url="https://api.github.com/repos/${REPO}/releases/tags/v${version}"
  local release_file published_at
  release_file="$(mktemp "${TMPDIR:-/tmp}/spinosa-release.XXXXXX")"
  run_timed_step "Verify release age" 60 download "$api_url" "$release_file" \
    || { rm -f "$release_file"; die "Could not fetch release metadata for v${version}."; }
  published_at="$(grep '"published_at":' "$release_file" | head -1 | sed 's/.*"published_at": "\([^"]*\)".*/\1/')" || true
  rm -f "$release_file"

  if [ -z "$published_at" ]; then
    die "Could not verify age for immutable release v${version}. Retry later, or omit --min-days."
  fi

  local release_ts current_ts
  release_ts=""
  if release_ts="$(date -d "$published_at" +%s 2>/dev/null)"; then
    :
  elif release_ts="$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$published_at" +%s 2>/dev/null)"; then
    :
  else
    die "Could not parse release date '$published_at'. Cannot enforce --min-days."
  fi

  current_ts="$(date +%s)"
  local days_old=$(( (current_ts - release_ts) / 86400 ))

  if [ "$days_old" -lt "$min_days" ]; then
    die "Release v${version} is only ${days_old} day(s) old. Minimum required: ${min_days} day(s). Wait or lower --min-days."
  fi

  vok "Release age verified: ${days_old} day(s) old (minimum: ${min_days})"
}

# ══════════════════════════════════════════════════════════════════════════════
# PROMPTS
# ══════════════════════════════════════════════════════════════════════════════

prompt_upgrade() {
  local installed="$1" target="$2"

  local cmp=0
  compare_versions "$target" "$installed" || cmp=$?

  if [ "$cmp" -eq 0 ]; then
    if [ "$REINSTALL" -eq 1 ]; then
      if [ "$YES" -eq 1 ]; then
        info "Reinstalling v${target} (--yes)..."
      else
        info "Reinstalling v${target}..."
      fi
      return 0
    fi
    if [ "$UPGRADE" -eq 1 ]; then
      info "Already on v${target}. No upgrade needed."
      return 1
    fi
    printf '  %s %s\n' "${Y}●${RESET}" "Spinosa v${installed} is already installed." >&2
    if [ "$YES" -eq 1 ]; then
      info "Skipping reinstall prompt (--yes)."
      return 1
    fi
    printf '  %s %s [y/N]: ' "${C}?${RESET}" "Reinstall?" >&2
    local reply
    read_tty_or_die reply
    case "$reply" in
      y|Y|yes|YES) return 0 ;;
      *) info "Install cancelled." ; return 1 ;;
    esac
  elif [ "$cmp" -eq 1 ]; then
    if [ "$UPGRADE" -eq 1 ]; then
      if [ "$YES" -eq 1 ]; then
        info "Upgrading v${installed} → v${target} (--yes)..."
      else
        info "Upgrading v${installed} → v${target}..."
      fi
      return 0
    fi
    if [ "$REINSTALL" -eq 1 ]; then
      info "Installing v${target} (over v${installed})..."
      return 0
    fi
    printf '  %s %s\n' "${C}●${RESET}" "Spinosa v${installed} is installed. v${target} is available." >&2
    if [ "$YES" -eq 1 ]; then
      info "Auto-upgrading (--yes)."
      return 0
    fi
    printf '  %s %s [Y/n]: ' "${C}?${RESET}" "Upgrade?" >&2
    local reply
    read_tty_or_die reply
    reply="${reply:-Y}"
    case "$reply" in
      n|N|no|NO) info "Upgrade cancelled." ; return 1 ;;
      *) return 0 ;;
    esac
  else
    if [ "$UPGRADE" -eq 1 ]; then
      warn "Installed v${installed} is newer than target v${target}. Skipping upgrade."
      return 1
    fi
    if [ "$REINSTALL" -eq 1 ]; then
      if [ "$YES" -eq 1 ]; then
        info "Downgrading v${installed} → v${target} (--yes)..."
      else
        info "Downgrading v${installed} → v${target}..."
      fi
      return 0
    fi
    printf '  %s %s\n' "${Y}●${RESET}" "Installed v${installed} is newer than target v${target}." >&2
    if [ "$YES" -eq 1 ]; then
      info "Skipping downgrade (--yes)."
      return 1
    fi
    printf '  %s %s [y/N]: ' "${C}?${RESET}" "Downgrade?" >&2
    local reply
    read_tty_or_die reply
    case "$reply" in
      y|Y|yes|YES) return 0 ;;
      *) info "Install cancelled." ; return 1 ;;
    esac
  fi
}

confirm_install() {
  local version="$1"
  if [ "$YES" -eq 1 ]; then
    return 0
  fi
  printf '  %s %s [Y/n]: ' "${C}?${RESET}" "Install Spinosa v${version}?" >&2
  local reply
  read_tty_or_die reply
  reply="${reply:-Y}"
  case "$reply" in
    n|N|no|NO) info "Install cancelled." ; return 1 ;;
  esac
  return 0
}

should_install() {
  local version="$1"
  if [ "$DRY_RUN" -eq 0 ] && [ "$VERIFY_ONLY" -eq 0 ]; then
    local installed_version
    installed_version="$(get_installed_version)"
    if [ -n "$installed_version" ]; then
      prompt_upgrade "$installed_version" "$version" || return 1
    else
      confirm_install "$version" || return 1
    fi
  fi
  return 0
}

# ══════════════════════════════════════════════════════════════════════════════
# BINARY STAGING / ACTIVATION
# ══════════════════════════════════════════════════════════════════════════════

binary_workspace_launcher_body() {
  cat <<'LAUNCHER_EOF'
#!/bin/sh
# Managed by Spinosa binary distribution.
# Forwards to the installed product binary. Never searches version trees or Bun.
set -eu

home="${SPINOSA_HOME:-$HOME/.spinosa}"
target="$home/bin/spinosa"

if [ ! -x "$target" ]; then
  echo "spinosa: installed binary is missing or not executable" >&2
  echo "spinosa: re-run the installer to repair the installation" >&2
  exit 1
fi

exec "$target" "$@"
LAUNCHER_EOF
}

classify_workspace_launcher() {
  local launcher="$1"
  local body hits=0

  if [ ! -e "$launcher" ]; then
    printf '%s\n' "missing"
    return 0
  fi
  # Only read regular files with bounded size; FIFOs, sockets, directories or
  # unreadable files must not block the installer.
  if [ ! -f "$launcher" ]; then
    printf '%s\n' "unreadable"
    return 0
  fi
  if ! body="$(head -c 16384 "$launcher" 2>/dev/null)"; then
    printf '%s\n' "unreadable"
    return 0
  fi

  if printf '%s\n' "$body" | grep -Fq '# Managed by Spinosa binary distribution.'; then
    printf '%s\n' "managed-binary"
    return 0
  fi

  printf '%s\n' "$body" | grep -Fq 'Resolves the framework root and Bun runtime' && hits=$((hits + 1))
  # shellcheck disable=SC2016
  printf '%s\n' "$body" | grep -Fq 'candidate="${SCRIPT_DIR}/.."' && hits=$((hits + 1))
  printf '%s\n' "$body" | grep -Fq 'installed_release=false' && hits=$((hits + 1))
  printf '%s\n' "$body" | grep -Fq 'ensure_opentui_links' && hits=$((hits + 1))
  printf '%s\n' "$body" | grep -Fq 'packages/spinosa-kernel/src/index.ts' && hits=$((hits + 1))
  # Also treat PATH-shim style managed markers / source launcher as owned.
  if printf '%s\n' "$body" | grep -Fq '# Managed by Spinosa'; then
    hits=$((hits + 2))
  fi

  if [ "$hits" -ge 2 ]; then
    printf '%s\n' "managed-source"
    return 0
  fi
  printf '%s\n' "modified"
}

list_registered_workspace_paths() {
  local registry="${SPINOSA_METADATA_DIR}/workspaces.json"
  [ -f "$registry" ] || return 0
  # Prefer jq when available; fall back to a conservative sed extract of "path" values.
  if command -v jq >/dev/null 2>&1; then
    jq -r '.workspaces[]?.path // empty' "$registry" 2>/dev/null || true
    return 0
  fi
  sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$registry" 2>/dev/null || true
}

migrate_workspace_launchers() {
  local workspace launcher status
  local migrated=0 preserved=0

  while IFS= read -r workspace; do
    [ -n "$workspace" ] || continue
    vinfo "Finding workspace: ${workspace}"
    launcher="${workspace}/.bin/spinosa"
    status="$(classify_workspace_launcher "$launcher")"
    case "$status" in
      missing|managed-source)
        mkdir -p "$(dirname "$launcher")"
        binary_workspace_launcher_body > "${launcher}.tmp.$$"
        chmod +x "${launcher}.tmp.$$"
        mv "${launcher}.tmp.$$" "$launcher"
        migrated=$((migrated + 1))
        vnote "Migrated workspace launcher: ${launcher}"
        ;;
      managed-binary)
        ;;
      modified|unreadable)
        preserved=$((preserved + 1))
        [[ "$VERBOSE" == "1" ]] && warn "Preserved modified workspace launcher: ${launcher} (status: ${status})"
        ;;
    esac
  done < <(list_registered_workspace_paths)

  if [ "$migrated" -gt 0 ] || [ "$preserved" -gt 0 ]; then
    vinfo "Workspace launchers: migrated=${migrated} preserved=${preserved}"
  fi
}

run_staged_binary_checks() {
  local binary="$1"
  local out ver
  local version_ok=0

  [ -x "$binary" ] || die "Staged binary is not executable: ${binary}"

  if out="$(probe_spinosa_version_output "$binary" 2>/dev/null || true)"; then
    if [ -n "$out" ] && ver="$(parse_version_output "$out")"; then
      version_ok=1
    fi
  fi
  if [ "$version_ok" -eq 0 ]; then
    # Fallback already included in probe (tries both --json and plain); if still not ok, fail
    [ -n "${ver:-}" ] || die "Staged binary failed version check"
  fi

  if [ "$ver" != "$VERSION" ]; then
    die "Staged binary version mismatch: got ${ver}, expected ${VERSION}"
  fi
  vok "Staged binary reports version ${ver}"

  local pack
  pack="$(extract_template_pack_id "$out" || true)"
  if [ -n "$pack" ]; then
    TEMPLATE_PACK_ID="$pack"
  fi

  # Activation gates (binary-distribution-contract): template ensure/verify + doctor
  # must pass before the staged binary is activated. Fail closed — never soft-continue.
  # Preserve diagnostics in the log instead of discarding to /dev/null.
  local gate_tmp
  gate_tmp="$(mktemp "${TMPDIR:-/tmp}/spinosa-gate.XXXXXX")"
  if "$binary" internal template ensure --json >"$gate_tmp" 2>&1; then
    spinosa_log INFO "template ensure output: $(cat "$gate_tmp" 2>/dev/null | head -c 4096)"
    vok "Template ensure succeeded"
    if "$binary" internal template verify --json >"$gate_tmp" 2>&1; then
      spinosa_log INFO "template verify output: $(cat "$gate_tmp" 2>/dev/null | head -c 4096)"
      vok "Template verify succeeded"
    else
      spinosa_log ERROR "template verify failed: $(cat "$gate_tmp" 2>/dev/null | head -c 4096)"
      rm -f "$gate_tmp"
      die "Template verify failed — refusing to activate staged binary"
    fi
  else
    spinosa_log ERROR "template ensure failed: $(cat "$gate_tmp" 2>/dev/null | head -c 4096)"
    rm -f "$gate_tmp"
    die "Template ensure failed — refusing to activate staged binary"
  fi
  rm -f "$gate_tmp"
  gate_tmp="$(mktemp "${TMPDIR:-/tmp}/spinosa-doctor.XXXXXX")"
  if "$binary" doctor >"$gate_tmp" 2>&1; then
    spinosa_log INFO "doctor output: $(cat "$gate_tmp" 2>/dev/null | head -c 4096)"
    vok "Doctor passed"
  else
    spinosa_log ERROR "doctor failed: $(cat "$gate_tmp" 2>/dev/null | head -c 4096)"
    rm -f "$gate_tmp"
    die "Doctor reported issues — refusing to activate staged binary"
  fi
  rm -f "$gate_tmp"
}

restore_binary_backup_if_needed() {
  [ "${ACTIVATION_STARTED:-0}" -eq 1 ] || return 0
  [ "${INSTALL_COMPLETED:-0}" -eq 0 ] || return 0
  local active="${SPINOSA_HOME}/bin/spinosa"
  local shim="${SPINOSA_BIN_DIR}/spinosa"
  local config="${SPINOSA_METADATA_DIR}/config.yaml"
  local env_file="${SPINOSA_HOME}/env.sh"
  local restored=0
  if [ -n "${BINARY_BACKUP:-}" ] && [ -e "$BINARY_BACKUP" ]; then
    spinosa_log WARN "restoring previous binary from ${BINARY_BACKUP}"
    if rm -f "$active" 2>/dev/null && mv "$BINARY_BACKUP" "$active" 2>/dev/null; then
      chmod +x "$active" 2>/dev/null || true
      restored=1
    else
      spinosa_log ERROR "failed to restore binary backup from ${BINARY_BACKUP}"
    fi
    BINARY_BACKUP=""
  fi
  if [ -n "${BINARY_STAGED:-}" ] && [ -e "$BINARY_STAGED" ]; then
    rm -f "$BINARY_STAGED" 2>/dev/null || true
    BINARY_STAGED=""
  fi
  if [ -n "${SHIM_BACKUP:-}" ] && [ -e "$SHIM_BACKUP" ]; then
    spinosa_log WARN "restoring previous shim from ${SHIM_BACKUP}"
    if ! mv "$SHIM_BACKUP" "$shim" 2>/dev/null; then
      spinosa_log ERROR "failed to restore shim backup from ${SHIM_BACKUP}"
    fi
    SHIM_BACKUP=""
  elif [ -n "${SHIM_BACKUP:-}" ] && [ ! -e "$shim" ]; then
    # Backup was empty file marker for non-existent shim — remove newly created shim
    rm -f "$shim" 2>/dev/null || true
    SHIM_BACKUP=""
  fi
  if [ -n "${CONFIG_BACKUP:-}" ] && [ -e "$CONFIG_BACKUP" ]; then
    spinosa_log WARN "restoring previous config from ${CONFIG_BACKUP}"
    if ! mv "$CONFIG_BACKUP" "$config" 2>/dev/null; then
      spinosa_log ERROR "failed to restore config backup from ${CONFIG_BACKUP}"
    fi
    CONFIG_BACKUP=""
  fi
  if [ -n "${ENV_BACKUP:-}" ] && [ -e "$ENV_BACKUP" ]; then
    spinosa_log WARN "restoring previous env.sh from ${ENV_BACKUP}"
    if ! mv "$ENV_BACKUP" "$env_file" 2>/dev/null; then
      spinosa_log ERROR "failed to restore env backup from ${ENV_BACKUP}"
    fi
    ENV_BACKUP=""
  fi
  # Verify restoration consistency
  if [ "$restored" -eq 1 ]; then
    local out ver
    if out="$(probe_spinosa_version_output "$active" 2>/dev/null || true)" && ver="$(parse_version_output "$out" 2>/dev/null || true)" && [ -n "$ver" ]; then
      spinosa_log INFO "restored binary verifies as v${ver}"
    else
      spinosa_log WARN "restored binary failed to verify — manual repair may be needed"
    fi
  fi
  # Clean up any remaining staged shim file
  if [ -n "${SHIM_STAGE_FILE:-}" ] && [ -e "$SHIM_STAGE_FILE" ]; then
    rm -f "$SHIM_STAGE_FILE" 2>/dev/null || true
    SHIM_STAGE_FILE=""
  fi
}

activate_binary() {
  local staged="$1"
  local active="${SPINOSA_HOME}/bin/spinosa"
  local backup="${SPINOSA_STAGING_DIR}/spinosa.backup.$$"

  mkdir -p "${SPINOSA_HOME}/bin" "$SPINOSA_STAGING_DIR"
  BINARY_BACKUP=""
  ACTIVATION_STARTED=0

  if [ -e "$active" ] || [ -L "$active" ]; then
    assert_path_inside_spinosa_home "$active"
    mv "$active" "$backup"
    BINARY_BACKUP="$backup"
  fi

  ACTIVATION_STARTED=1
  if ! mv "$staged" "$active"; then
    restore_binary_backup_if_needed
    die "Failed to activate staged binary"
  fi
  BINARY_STAGED=""
  chmod +x "$active"
  vok "Activated binary at ${active}"
}

verify_active_binary() {
  local active="${SPINOSA_HOME}/bin/spinosa"
  local out ver
  [ -x "$active" ] || die "Active binary missing or not executable after activation"
  if ! out="$(probe_spinosa_version_output "$active" 2>/dev/null || true)"; then
    restore_binary_backup_if_needed
    die "Active binary failed version verification after activation (probe timed out). See $(spinosa_log_file)"
  fi
  if [ -z "$out" ]; then
    restore_binary_backup_if_needed
    die "Active binary failed version verification after activation (no output). See $(spinosa_log_file)"
  fi
  ver="$(parse_version_output "$out")" || {
    restore_binary_backup_if_needed
    die "Active binary failed version verification after activation. See $(spinosa_log_file)"
  }
  if [ "$ver" != "$VERSION" ]; then
    restore_binary_backup_if_needed
    die "Active binary version mismatch after activation (got ${ver}). See $(spinosa_log_file)"
  fi
  vok "Active binary verified (v${ver})"
}

install_shims() {
  if [ "$PREFIX_MODE" -eq 1 ]; then
    info "Custom install root (--prefix) — skipping global shim."
    info "  Run Spinosa from: ${SPINOSA_HOME}/bin/spinosa"
    return 0
  fi
  local shim="${SPINOSA_BIN_DIR}/spinosa"
  if [ -e "$shim" ] && ! is_owned_spinosa_shim "$shim"; then
    die "Refusing to overwrite non-Spinosa command: ${shim}. Move it or choose --bin-dir."
  fi
  mkdir -p "$SPINOSA_BIN_DIR"
  # Backup shim for transactional rollback before mutating
  SHIM_BACKUP=""
  if [ -e "$shim" ]; then
    SHIM_BACKUP="${SPINOSA_STAGING_DIR}/shim.backup.$$"
    cp "$shim" "$SHIM_BACKUP" 2>/dev/null || SHIM_BACKUP=""
  else
    SHIM_BACKUP="${SPINOSA_STAGING_DIR}/shim.backup.$$"
    : > "$SHIM_BACKUP" 2>/dev/null || SHIM_BACKUP=""
  fi
  local shim_tmp="${shim}.tmp.$$"
  SHIM_STAGE_FILE="$shim_tmp"
  cat > "$shim_tmp" <<'SHIM_EOF'
#!/bin/sh
# Managed by Spinosa install.sh
home="${SPINOSA_HOME:-$HOME/.spinosa}"
target="$home/bin/spinosa"
if [ ! -x "$target" ]; then
  echo "spinosa: installation needs repair" >&2
  exit 1
fi
exec "$target" "$@"
SHIM_EOF
  chmod +x "$shim_tmp"
  mv "$shim_tmp" "$shim"
  SHIM_STAGE_FILE=""
  vok "Created wrapper script: ${shim}"
}

write_spinosa_env_file() {
  SPINOSA_ENV_FILE="${SPINOSA_HOME}/env.sh"
  mkdir -p "$SPINOSA_HOME"
  # Backup env.sh for rollback
  ENV_BACKUP=""
  if [ -f "$SPINOSA_ENV_FILE" ]; then
    ENV_BACKUP="${SPINOSA_STAGING_DIR}/env.backup.$$"
    cp "$SPINOSA_ENV_FILE" "$ENV_BACKUP" 2>/dev/null || ENV_BACKUP=""
  fi
  local env_tmp="${SPINOSA_ENV_FILE}.tmp.$$"
  cat > "$env_tmp" << EOF
# Spinosa CLI environment — managed by install.sh
export SPINOSA_HOME="${SPINOSA_HOME}"
export SPINOSA_BIN_DIR="${SPINOSA_BIN_DIR}"
export PATH="${SPINOSA_BIN_DIR}:\$PATH"
EOF
  if ! mv "$env_tmp" "$SPINOSA_ENV_FILE"; then
    restore_binary_backup_if_needed
    die "Failed to write env.sh"
  fi
}

shell_path_default_config() {
  local current_shell="$1"
  case "$current_shell" in
    fish) printf '%s\n' "$HOME/.config/fish/config.fish" ;;
    zsh)  printf '%s\n' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [[ "$(uname -s)" == "Darwin" ]]; then
        printf '%s\n' "$HOME/.bash_profile"
      else
        printf '%s\n' "$HOME/.bashrc"
      fi
      ;;
    *) printf '%s\n' "$HOME/.profile" ;;
  esac
}

spinosa_path_block_present() {
  local config_file="$1" path_line="${2:-}"
  [[ -f "$config_file" ]] || return 1
  grep -q '# Spinosa' "$config_file" 2>/dev/null || return 1
  if [[ -n "$path_line" ]]; then
    local line
    while IFS= read -r line || [[ -n "$line" ]]; do
      [ -z "$line" ] && continue
      grep -Fqx "$line" "$config_file" 2>/dev/null || return 1
    done <<< "$path_line"
    return 0
  else
    grep -Eq 'env\.sh|fish_add_path|SPINOSA_BIN_DIR|SPINOSA_HOME' "$config_file" 2>/dev/null
  fi
}

spinosa_path_source_line() {
  local current_shell="$1"
  local env_file="${SPINOSA_ENV_FILE:-${SPINOSA_HOME}/env.sh}"
  case "$current_shell" in
    fish)
      printf 'set -gx SPINOSA_HOME %q\n' "$SPINOSA_HOME"
      printf 'fish_add_path %q\n' "$SPINOSA_BIN_DIR"
      ;;
    *)
      printf '[[ -f %q ]] && . %q\n' "$env_file" "$env_file"
      ;;
  esac
}

activate_spinosa_path_for_session() {
  if [[ -f "${SPINOSA_HOME}/env.sh" ]]; then
    # shellcheck source=/dev/null
    . "${SPINOSA_HOME}/env.sh"
    vok "Activated Spinosa PATH from ${SPINOSA_HOME}/env.sh"
  else
    export SPINOSA_BIN_DIR="${SPINOSA_BIN_DIR}"
    export PATH="${SPINOSA_BIN_DIR}:$PATH"
    vok "Activated Spinosa PATH for this install session"
  fi
  hash -r 2>/dev/null || true
}

setup_shell_path() {
  [[ "${NO_MODIFY_PATH:-false}" == "true" ]] && return 0

  local current_shell config_file default_config candidate path_line wrote=0
  local -a candidates
  current_shell="$(basename "${SHELL:-/bin/sh}")"
  path_line="$(spinosa_path_source_line "$current_shell")"
  default_config="$(shell_path_default_config "$current_shell")"
  config_file=""

  case "$current_shell" in
    fish) candidates=("$HOME/.config/fish/config.fish") ;;
    zsh)
      if [[ "$(uname -s)" == "Darwin" ]]; then
        candidates=("${ZDOTDIR:-$HOME}/.zshrc" "${ZDOTDIR:-$HOME}/.zprofile" "${ZDOTDIR:-$HOME}/.zshenv")
      else
        candidates=("${ZDOTDIR:-$HOME}/.zshrc" "${ZDOTDIR:-$HOME}/.zshenv")
      fi
      ;;
    bash)
      if [[ "$(uname -s)" == "Darwin" ]]; then
        candidates=("$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.profile")
      else
        candidates=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile")
      fi
      ;;
    *) candidates=("$HOME/.profile") ;;
  esac

  for candidate in "${candidates[@]}"; do
    if spinosa_path_block_present "$candidate" "$path_line"; then
      config_file="$candidate"
      vok "Spinosa PATH already configured in ${candidate}"
      break
    fi
  done

  if [[ -z "$config_file" ]]; then
    for candidate in "${candidates[@]}"; do
      if [[ -f "$candidate" ]]; then
        config_file="$candidate"
        break
      fi
    done
  fi

  if [[ -z "$config_file" ]]; then
    config_file="$default_config"
    mkdir -p "$(dirname "$config_file")"
    : > "$config_file"
    vok "Created shell config: ${config_file}"
  fi

  if [[ -w "$config_file" ]]; then
    if ! spinosa_path_block_present "$config_file" "$path_line"; then
      {
        printf '\n# Spinosa\n'
        printf '%s' "$path_line"
      } >> "$config_file"
      vok "Added ${SPINOSA_BIN_DIR} to ${config_file}"
      wrote=1
    fi
    SPINOSA_PATH_CONFIG_FILE="$config_file"
  else
    warn "Cannot write to ${config_file} — add this manually:"
    note "${path_line}"
  fi

  if [[ "$wrote" -eq 1 && "$current_shell" == "zsh" && "$(uname -s)" == "Darwin" \
        && "$config_file" != "${ZDOTDIR:-$HOME}/.zprofile" \
        && -f "${ZDOTDIR:-$HOME}/.zprofile" ]] \
      && ! spinosa_path_block_present "${ZDOTDIR:-$HOME}/.zprofile" "$path_line"; then
    {
      printf '\n# Spinosa\n'
      printf '%s' "$path_line"
    } >> "${ZDOTDIR:-$HOME}/.zprofile"
    note "Also added PATH to ${ZDOTDIR:-$HOME}/.zprofile (macOS login shells)"
  fi
}

install_stdin_is_piped() {
  [[ ! -t 0 ]]
}

shell_reload_hint() {
  local env_file="${1:-${SPINOSA_ENV_FILE:-${SPINOSA_HOME}/env.sh}}"
  if [[ -n "${SPINOSA_PATH_CONFIG_FILE:-}" ]]; then
    printf 'source %s' "${SPINOSA_PATH_CONFIG_FILE}"
  elif [[ -f "$env_file" ]]; then
    printf 'source %s' "$env_file"
  else
    # shellcheck disable=SC2016
    printf 'export PATH="%s:$PATH"' "${SPINOSA_BIN_DIR}"
  fi
}

print_path_instructions() {
  local fallback_bin="$SPINOSA_BIN_DIR" env_file="${SPINOSA_ENV_FILE:-${SPINOSA_HOME}/env.sh}"
  local reload_hint
  reload_hint="$(shell_reload_hint "$env_file")"
  # shellcheck disable=SC2016
  [[ "$fallback_bin" == "$HOME/.local/bin" ]] && fallback_bin='$HOME/.local/bin'

  spinosa_log INFO "Run Spinosa with: spinosa"
  printf '  %s Run Spinosa with: %s%s%s\n' "${C}●${RESET}" "${BOLD}" "spinosa" "${RESET}"

  if "${SPINOSA_BIN_DIR}/spinosa" version >/dev/null 2>&1 \
    || "${SPINOSA_HOME}/bin/spinosa" version >/dev/null 2>&1; then
    vok "Command 'spinosa' is ready in this install session"
  elif command -v spinosa >/dev/null 2>&1; then
    warn "Command 'spinosa' is on PATH but not runnable — run: ${reload_hint}"
  else
    warn "Command 'spinosa' is still not on PATH in this session"
    note "Run: ${reload_hint}"
  fi

  if install_stdin_is_piped; then
    note "Pipe install (curl|bash) — your interactive shell still needs PATH"
    note "In your terminal, run: ${reload_hint}"
    note "Or open a new terminal window"
  elif [[ -n "${SPINOSA_PATH_CONFIG_FILE:-}" || -f "$env_file" ]]; then
    vnote "In new terminals: ${reload_hint}"
  else
    note "If needed: export PATH=\"${fallback_bin}:\$PATH\""
  fi
}

print_banner() {
  printf '\n\n\n'
  printf '  %s\n' '███████╗██████╗ ██╗███╗   ██╗ ██████╗ ███████╗ █████╗'
  printf '  %s\n' '██╔════╝██╔══██╗██║████╗  ██║██╔═══██╗██╔════╝██╔══██╗'
  printf '  %s\n' '███████╗██████╔╝██║██╔██╗ ██║██║   ██║███████╗███████║'
  printf '  %s\n' '╚════██║██╔═══╝ ██║██║╚██╗██║██║   ██║╚════██║██╔══██║'
  printf '  %s\n' '███████║██║     ██║██║ ╚████║╚██████╔╝███████║██║  ██║'
  printf '  %s\n' '╚══════╝╚═╝     ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝'
  printf '  %s\n\n' 'Binary Installer'
}

handle_verify_only() {
  local existing_version
  existing_version="$(get_installed_version)"
  if [ -z "$existing_version" ] || [ ! -x "${SPINOSA_HOME}/bin/spinosa" ]; then
    die "No Spinosa binary installation found at ${SPINOSA_HOME}"
  fi
  VERSION="$existing_version"
  run_timed_step "Verify Spinosa v${existing_version}" "$DEFAULT_VERIFY_TIMEOUT_SECONDS" \
    run_staged_binary_checks "${SPINOSA_HOME}/bin/spinosa" \
    || die "Spinosa v${existing_version} failed verification"
  ok "Verified Spinosa v${existing_version}"
}

handle_dry_run() {
  local base asset_url checksums_url
  base="$(release_asset_base)"
  asset_url="${base}/${ASSET_NAME}"
  checksums_url="${base}/checksums.txt"
  info "Dry run — would download:"
  info "  ${checksums_url}"
  info "  ${asset_url}"
  info "Would install binary to: ${SPINOSA_HOME}/bin/spinosa"
  if [ "$PREFIX_MODE" -eq 0 ]; then
    info "Would create shim: ${SPINOSA_BIN_DIR}/spinosa"
  fi
  info "Would write metadata under: ${SPINOSA_METADATA_DIR}/"
  if legacy_source_runtime_present; then
    info "Would preserve legacy versions/ and set distribution: binary"
  fi
  echo ""
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

main() {
  local base checksums_url asset_url
  local checksums_file staged_binary

  SPINOSA_LOG_DISABLED=1
  SPINOSA_METADATA_DIR="${SPINOSA_HOME}/metadata"
  SPINOSA_STAGING_DIR="${SPINOSA_HOME}/.staging"
  # Early attempt log before home validation/lock — ensures a hang before
  # persistent logging is still diagnosable. Display path immediately.
  local early_log="${TMPDIR:-/tmp}/spinosa-install-$$.log"
  SPINOSA_EARLY_LOG="$early_log"
  {
    printf '\n---\n'
    printf '%s early component=install pid=%s ppid=%s shell=%s cwd=%s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$PPID" "${BASH_VERSION:-sh}" "$PWD"
    printf 'argv=%q\n' "$0 $*"
    printf 'version=%s home=%s bin=%s\n' "${VERSION:-}" "${SPINOSA_HOME:-}" "${SPINOSA_BIN_DIR:-}"
  } >> "$early_log" 2>/dev/null || true
  vinfo "install attempt log: $early_log"

  validate_install_paths
  preflight_tools
  detect_platform
  resolve_version

  base="$(release_asset_base)"
  checksums_url="${base}/checksums.txt"
  asset_url="${base}/${ASSET_NAME}"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    handle_dry_run
    return 0
  fi
  if [[ "$VERIFY_ONLY" -eq 1 ]]; then
    handle_verify_only
    return 0
  fi

  if [[ "$FROM_UPGRADE" -eq 1 ]]; then
    : # from spinosa upgrade — parent already did intro/logo, no second banner
  elif [[ "$YES" -eq 0 ]]; then
    print_banner
  fi
  section "System check"

  ensure_spinosa_home

  INSTALL_LOCKDIR="${SPINOSA_STAGING_DIR}/.install.lock"
  local lockdir="$INSTALL_LOCKDIR"
  mkdir -p "$(dirname "$lockdir")"
  if ! mkdir "$lockdir" 2>/dev/null; then
    local stale=0
    if [ -f "$lockdir/pid" ]; then
      local lock_pid
      lock_pid=$(cat "$lockdir/pid") 2>/dev/null || true
      if [[ "$lock_pid" =~ ^[1-9][0-9]*$ ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
        stale=1
      fi
    else
      # Lock dir exists but no pid file — treat as stale if older than 1h
      local age
      if age=$(find "$lockdir" -maxdepth 0 -mmin +60 2>/dev/null); then
        [ -n "$age" ] && stale=1
      fi
    fi
    if [ "$stale" -eq 1 ]; then
      rm -rf "$lockdir"
      info "Removed stale lock from previous install attempt"
      mkdir "$lockdir" 2>/dev/null || die "Another Spinosa installer is running. Wait and retry, or remove stale lock: rm -rf '${lockdir}'"
    else
      die "Another Spinosa installer is running. Wait and retry, or remove stale lock: rm -rf '${lockdir}'"
    fi
  fi
  printf '%s\n' "$$" > "${lockdir}/pid"
  trap 'restore_binary_backup_if_needed; _spinosa_cleanup_lock; if [ -n "${SHIM_STAGE_FILE:-}" ]; then rm -f "$SHIM_STAGE_FILE"; fi; if [ -n "${SPINOSA_EARLY_LOG:-}" ] && [ -f "$SPINOSA_EARLY_LOG" ]; then rm -f "$SPINOSA_EARLY_LOG"; fi' EXIT
  trap '_spinosa_install_signal 130' INT TERM HUP

  init_global_metadata

  SPINOSA_LOG_DISABLED=0
  spinosa_log_init "install.sh" "$0" "$@"
  # Merge early attempt log into persistent log
  if [ -n "${SPINOSA_EARLY_LOG:-}" ] && [ -f "$SPINOSA_EARLY_LOG" ]; then
    cat "$SPINOSA_EARLY_LOG" >> "$(spinosa_log_file)" 2>/dev/null || true
    spinosa_log INFO "merged early log from ${SPINOSA_EARLY_LOG}"
  fi
  spinosa_log INFO "version=${VERSION} home=${SPINOSA_HOME} bin=${SPINOSA_BIN_DIR} platform=${PLATFORM} distribution=binary"

  check_release_age "$VERSION" "$MIN_DAYS"

  info "Local version at ${SPINOSA_HOME}/bin/spinosa: ${VERSION}"
  vinfo "Install root: ${SPINOSA_HOME}"
  vinfo "Bin directory: ${SPINOSA_BIN_DIR}"
  vinfo "Asset: ${ASSET_NAME}"
  echo ""

  should_install "$VERSION" || { rm -rf "$lockdir"; trap - EXIT INT TERM HUP; return 0; }
  mkdir -p "${SPINOSA_HOME}/bin" "$SPINOSA_STAGING_DIR" "$SPINOSA_BIN_DIR"

  section "Download & verify"

  checksums_file="${SPINOSA_STAGING_DIR}/checksums.txt"
  staged_binary="${SPINOSA_STAGING_DIR}/${ASSET_NAME}"
  BINARY_STAGED="$staged_binary"
  rm -f "$checksums_file" "$staged_binary"

  run_timed_step "Download checksums" 60 \
    download "$checksums_url" "$checksums_file" \
    || die "Failed to download checksums.txt from ${checksums_url}"
  run_timed_step "Download ${ASSET_NAME}" "$DEFAULT_DOWNLOAD_TIMEOUT_SECONDS" \
    download "$asset_url" "$staged_binary" \
    || die "Failed to download ${ASSET_NAME}"
  verify_asset_checksum "$staged_binary" "$ASSET_NAME" "$checksums_file" "${ASSET_NAME}"
  chmod +x "$staged_binary"

  _install_activate() {
    activate_binary "$staged_binary"
    verify_active_binary || {
      restore_binary_backup_if_needed
      die "Post-activation verification failed. Previous binary restored. See $(spinosa_log_file)"
    }
    install_shims
    write_spinosa_env_file
    write_install_metadata
  }
  [[ "$VERBOSE" == "1" ]] && section "Stage checks"
  run_timed_step "Verifying package" "$DEFAULT_VERIFY_TIMEOUT_SECONDS" \
    run_staged_binary_checks "$staged_binary" \
    || die "Staged binary failed verification"

  [[ "$VERBOSE" == "1" ]] && section "Activate"
  run_timed_step "Installing" 30 _install_activate \
    || die "Installation failed — see $(spinosa_log_file)"

  INSTALL_COMPLETED=1
  ACTIVATION_STARTED=0
  for _bk in "${BINARY_BACKUP:-}" "${SHIM_BACKUP:-}" "${CONFIG_BACKUP:-}" "${ENV_BACKUP:-}"; do
    [ -n "$_bk" ] && [ -e "$_bk" ] && rm -f "$_bk" 2>/dev/null || true
  done
  BINARY_BACKUP=""; SHIM_BACKUP=""; CONFIG_BACKUP=""; ENV_BACKUP=""
  rm -f "$checksums_file"
  rm -f "${SPINOSA_EARLY_LOG:-}" 2>/dev/null || true

  if legacy_source_runtime_present; then
    vnote "Legacy source runtime remains under ${SPINOSA_HOME}/versions/ (not deleted)."
    vnote "Distribution is now binary; dormant source trees can be removed manually later."
  fi

  rm -rf "$lockdir"
  INSTALL_LOCKDIR=""
  trap - EXIT INT TERM HUP

  if [ "$PREFIX_MODE" -eq 0 ]; then
    if [[ "$VERBOSE" == "1" ]]; then
      run_timed_step "Configure shell PATH" 15 setup_shell_path \
        || warn "Shell PATH configuration timed out or failed — add ${SPINOSA_BIN_DIR} to PATH manually; see $(spinosa_log_file)"
    else
      setup_shell_path 2>/dev/null || true
    fi
    activate_spinosa_path_for_session 2>/dev/null || true
  fi

  echo ""
  if [[ "$FROM_UPGRADE" -eq 1 ]]; then
    printf '  %s %s\n' "${G}●${RESET}" "${BOLD}✨ Spinosa installed successfully! ✨${RESET}" >&2
  else
    printf '  %s%s%s\n\n' "${BOLD}" "✨ Spinosa installed successfully! ✨" "${RESET}"
  fi

  spinosa_log INFO "install complete version=${VERSION} home=${SPINOSA_HOME} distribution=binary"
  local log_file
  log_file="$(spinosa_log_file)"
  if [ -t 2 ] && [ "${NO_COLOR:-}" != "1" ]; then
    printf '  %s Install log: \033]8;;file://%s\033\\%s\033]8;;\033\\\n' "${C}●${RESET}" "$log_file" "$log_file"
  else
    info "Install log: $log_file"
  fi
  if [ "$PREFIX_MODE" -eq 1 ]; then
    info "Run Spinosa from: ${SPINOSA_HOME}/bin/spinosa"
  else
    print_path_instructions
  fi
  echo ""
  return 0
}

if [[ "${SPINOSA_INSTALLER_LIB_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
