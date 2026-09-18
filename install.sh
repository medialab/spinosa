#!/bin/sh
# shellcheck shell=bash
# ── install.sh — Spinosa binary installer (auto-re-execs with bash) ─────────

PINNED_VERSION="1.2.0-beta.6"
PINNED_TAG="beta"
DEFAULT_DOWNLOAD_TIMEOUT_SECONDS="600"
# Staged-verify budget for slow hosts (qemu linux-x64 needs 100s+ for template
# ensure/verify + doctor cold-start). Override per machine with
# SPINOSA_VERIFY_TIMEOUT_SECONDS (must be a positive integer).
DEFAULT_VERIFY_TIMEOUT_SECONDS="${SPINOSA_VERIFY_TIMEOUT_SECONDS:-400}"
# Per-smoke staged budget (catalog, natives, PDF, TUI worker, parser).
# Each smoke gets this many seconds. They do not share one timer.
# A per-smoke timeout is a missing verdict, not a failure — install proceeds
# flagged as unverified (see handle_smoke_gate_result).
DEFAULT_SMOKE_TIMEOUT_SECONDS="${SPINOSA_SMOKE_TIMEOUT_SECONDS:-300}"
# Version probe after a 150MB binary lands. Cold page cache on qemu linux-x64
# can spend most of this. Nested inside the activate timed step — activate
# budget must stay strictly larger.
DEFAULT_PROBE_TIMEOUT_SECONDS="${SPINOSA_PROBE_TIMEOUT_SECONDS:-30}"
# Activate: rename + version probe + shims + metadata. Must exceed the probe
# budget so the outer timer cannot kill a still-running probe. qemu linux-x64
# spent 33s here against a 30s wrap.
DEFAULT_ACTIVATE_TIMEOUT_SECONDS="${SPINOSA_ACTIVATE_TIMEOUT_SECONDS:-300}"
DEFAULT_PATH_TIMEOUT_SECONDS="${SPINOSA_PATH_TIMEOUT_SECONDS:-60}"
DEFAULT_CHECKSUMS_TIMEOUT_SECONDS="${SPINOSA_CHECKSUMS_TIMEOUT_SECONDS:-180}"
WAVE_WIDTH=6

if [ -z "${BASH_VERSION-}" ]; then
  if command -v bash >/dev/null 2>&1; then
    if [ -n "${0-}" ] && [ -f "${0-}" ]; then
      exec bash "$0" "$@"
    fi
    echo "" >&2
    echo "This installer must be run under bash." >&2
    echo "Please use one of the following:" >&2
    echo "curl -fsSL --connect-timeout 30 --max-time 600 --retry 3 https://github.com/medialab/spinosa/releases/download/stable/install.sh -o /tmp/spinosa-install.sh && bash /tmp/spinosa-install.sh" >&2
    echo "bash <(curl -fsSL https://github.com/medialab/spinosa/releases/download/stable/install.sh)" >&2
    echo "curl -fsSL ... -o install.sh && bash install.sh" >&2
    echo "" >&2
    exit 1
  fi
  echo "" >&2
  echo "Spinosa requires bash. Install it first through your system package manager," >&2
  echo "then re-run the installer with bash (see commands above)." >&2
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

# Replace the user home with ~ so installer lines keep product paths only.
# Quote the tilde: bash 5 expands an unquoted ~ in ${var/pat/~} to $HOME.
redact_user_home() {
  local msg="${1:-}"
  local home="${2:-${HOME:-}}"
  local tilde="~"
  if [ -n "$home" ]; then
    msg="${msg//"$home"/$tilde}"
  fi
  printf '%s' "$msg"
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
      "$component" "$$" "$PPID" "${BASH_VERSION:-sh}" "$(redact_user_home "$PWD")"
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
  printf '%s level=%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$(redact_user_home "$*")" >> "$log_file" 2>/dev/null || true
}

_spinosa_install_err_trap() {
  local exit_code=$? line=$1
  step_end "$exit_code" "${STEP_LABEL:-Install step} failed" 2>/dev/null || true
  spinosa_log ERROR "aborted line=${line} exit=${exit_code} cmd=${BASH_COMMAND:-}"
  restore_binary_backup_if_needed
  printf '\n%s Install failed at line %s (exit %s). See %s\n\n' \
    "${R:-}●${RESET:-}" "$line" "$exit_code" "$(spinosa_log_file)" >&2
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
  if [ -n "${STEP_OUTPUT_FILE:-}" ]; then
    rm -f "$STEP_OUTPUT_FILE" 2>/dev/null || true
  fi
  STEP_OUTPUT_FILE=""
  # Timed-step temp registry (see timed_register_temp): the payload dies with
  # the killed tree, so drain its registered temp files/dirs from the parent.
  if [ -n "${STEP_TEMP_REGISTRY:-}" ]; then
    _timed_cleanup_registered_temps "$STEP_TEMP_REGISTRY"
    STEP_TEMP_REGISTRY=""
  fi
  # Stray direct-shell version probe (see get_installed_version): timed-step
  # trees are covered by STEP_COMMAND_PID above, but a probe started directly
  # in the main shell is not — reap its tree so cancel leaves no strays behind.
  if [ -n "${PROBE_PID:-}" ]; then
    kill_process_tree_graceful "$PROBE_PID"
    wait "$PROBE_PID" 2>/dev/null || true
    PROBE_PID=""
  fi
  step_end "$exit_code" "${STEP_LABEL:-Install} cancelled" || true
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
# Empty until resolve_spinosa_bin_dir: env and --bin-dir win; otherwise OS default.
SPINOSA_BIN_DIR="${SPINOSA_BIN_DIR:-}"
SPINOSA_STAGING_DIR="${SPINOSA_HOME}/.staging"
NO_MODIFY_PATH=false
REPO="medialab/spinosa"
PLATFORM=""
ASSET_NAME=""
TEMPLATE_PACK_ID=""
# Set to "timeout" when the staged smoke gates time out: install proceeds with
# an orange warning and records doctor_unverified in install metadata.
DOCTOR_UNVERIFIED=""
# Staged smoke-gate temps (see run_staged_smoke_checks): globals so a timeout
# that kills the payload subshell can still surface output (SMOKE_GATE_TMP)
# and remove the working dir (SMOKE_CWD) from the parent/signal paths.
SMOKE_GATE_TMP=""
SMOKE_CWD=""
# Background version-probe pid when started directly in the main shell
# (get_installed_version); reaped by the signal handler on cancel.
PROBE_PID=""
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
  G=$'\033[32m' R=$'\033[31m' C=$'\033[36m' Y=$'\033[33m'
  BOLD=$'\033[1m' RESET=$'\033[0m'
else
  G='' R='' C='' Y='' BOLD='' RESET=''
fi

info()  { spinosa_log INFO "$1"; printf '%s %s\n' "${C}●${RESET}" "$1"; }
vinfo() { [[ "$VERBOSE" == "1" ]] || return 0; info "$1"; }
ok()    { spinosa_log INFO "$1"; printf '%s %s\n' "${G}●${RESET}" "$1" >&2; }
vok()   { [[ "$VERBOSE" == "1" ]] || return 0; ok "$1"; }
warn()  { spinosa_log WARN "$1"; printf '%s %s\n' "${R}●${RESET}" "$1" >&2; }
# Amber (orange) warning: same log level as warn, but visually distinct from
# fatal red — used for non-blocking degradations (e.g. unverified doctor).
amber() { spinosa_log WARN "$1"; printf '%s %s\n' "${Y}●${RESET}" "$1" >&2; }
note()  { spinosa_log INFO "$1"; printf '%s\n' "$1"; }
vnote() { [[ "$VERBOSE" == "1" ]] || return 0; note "$1"; }
# Live gate progress for staged verification (run_staged_binary_checks).
# run_timed_step captures this function's stdout/stderr into a temp file that is
# only tailed on failure/timeout — without explicit start markers a timeout log
# cannot tell which gate hung (and verbose-gated vok lines vanish entirely by
# default). Each marker is always logged and captured; it is additionally
# mirrored to the controlling terminal when the caller exports
# SPINOSA_GATE_TTY (interactive installs only — direct function calls in tests
# leave it unset, so nothing ever writes to a tty from here).
gate_note() {
  local msg="$1"
  spinosa_log INFO "$msg"
  printf '%s %s\n' "${C}●${RESET}" "$msg"
  if [ -n "${SPINOSA_GATE_TTY:-}" ] && [ -c "${SPINOSA_GATE_TTY}" ]; then
    # Leading newline: the wave renderer leaves its progress line unterminated
    # (\r redraws), so without this the note glues onto it ("…s/400s● …").
    printf '\n%s %s\n' "${C}●${RESET}" "$msg" >"${SPINOSA_GATE_TTY}" 2>/dev/null || true
  fi
}
die()   { spinosa_log ERROR "$1"; printf '\n%s %s\n\n' "${R}●${RESET}" "$1" >&2; exit 1; }
divider() { printf '\n'; }

intro() {
  local title="$1"
  spinosa_log INFO "intro=${title}"
  if [ -t 2 ]; then
    printf '%s %s\n' "${C}●${RESET}" "$title" >&2
  else
    printf '%s\n' "$title" >&2
  fi
}
outro() {
  local msg="$1"
  spinosa_log INFO "outro=${msg}"
  if [ -t 2 ]; then
    printf '%s %s\n' "${G}●${RESET}" "$msg" >&2
    printf '\n' >&2
  else
    printf '%s\n' "$msg" >&2
  fi
}

section() {
  local title="$1"
  spinosa_log INFO "section=${title}"
  if [ -t 2 ]; then
    printf '\n%s %s%s%s\n' "→" "${BOLD}" "$title" "${RESET}"
  else
    printf '\n→ %s\n' "$title"
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
STEP_TEMP_REGISTRY=""
STEP_LABEL=""
STEP_STARTED_AT=0
STEP_PROGRESS_DEST=""
STEP_PROGRESS_TOTAL=""

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

# Pure line formatter (testable): % when the total is known, elapsed/timeout otherwise.
format_wave_line() {
  local label="$1" wave="$2" pct_text="$3" elapsed="$4" timeout_seconds="$5"
  if [ -n "$pct_text" ]; then
    printf '%s %s %s%s' "${C}●${RESET}" "$label" "$wave" "$pct_text"
  else
    printf '%s %s %s %ss/%ss' "${C}●${RESET}" "$label" "$wave" "$elapsed" "$timeout_seconds"
  fi
}

_render_wave() {
  local label="$1" timeout_seconds="$2" started_at="$3" progress_dest="${4:-}" progress_total="${5:-}"
  local tick=0 elapsed wave pct_text
  while :; do
    elapsed=$(( $(date +%s) - started_at ))
    wave="$(wave_string "$tick")"
    pct_text="$(step_progress_text "$progress_dest" "$progress_total" 2>/dev/null || true)"
    printf '\r\033[2K%s' "$(format_wave_line "$label" "$wave" "$pct_text" "$elapsed" "$timeout_seconds")" >&2
    tick=$((tick + 1))
    sleep 0.2
  done
}

# Portable file size (bytes). Prints 0 when the file is missing/unreadable.
file_size_bytes() {
  local f="$1" sz
  [ -f "$f" ] || { printf '0'; return 0; }
  # BSD/macOS stat first, then GNU stat, then wc fallback.
  if sz="$(stat -f%z "$f" 2>/dev/null)" && [[ "$sz" =~ ^[0-9]+$ ]]; then printf '%s' "$sz"; return 0; fi
  if sz="$(stat -c%s "$f" 2>/dev/null)" && [[ "$sz" =~ ^[0-9]+$ ]]; then printf '%s' "$sz"; return 0; fi
  if sz="$(wc -c <"$f" 2>/dev/null | tr -cd '0-9')" && [ -n "$sz" ]; then printf '%s' "$sz"; return 0; fi
  printf '0'
}

# Pure percent math: prints 0-100 for dest bytes vs total, clamped. Fails when total is unknown.
step_progress_percent() {
  local dest="$1" total="$2" current pct
  [[ "$total" =~ ^[1-9][0-9]*$ ]] || return 1
  current="$(file_size_bytes "$dest" 2>/dev/null || true)"
  [[ "$current" =~ ^[0-9]+$ ]] || current=0
  pct=$(( current * 100 / total ))
  if (( pct < 0 )); then pct=0; fi
  if (( pct > 100 )); then pct=100; fi
  printf '%s' "$pct"
}

# Render fragment for the wave line: "" when total is unknown, else " 42%".
# Always succeeds so the background renderer never trips `set -e`.
step_progress_text() {
  local dest="${1:-}" total="${2:-}" pct=""
  [[ "$total" =~ ^[1-9][0-9]*$ ]] || return 0
  [ -n "$dest" ] || return 0
  pct="$(step_progress_percent "$dest" "$total" 2>/dev/null || true)"
  [ -n "$pct" ] || return 0
  printf ' %s%%' "$pct"
}

step_begin() {
  STEP_LABEL="$1"
  local timeout_seconds="$2"
  STEP_STARTED_AT="$(date +%s)"
  spinosa_log INFO "step=start label=${STEP_LABEL} timeout=${timeout_seconds}s"
  if [ -t 2 ]; then
    _render_wave "$STEP_LABEL" "$timeout_seconds" "$STEP_STARTED_AT" "${STEP_PROGRESS_DEST:-}" "${STEP_PROGRESS_TOTAL:-}" &
    STEP_RENDER_PID=$!
  else
    printf '%s %s (timeout %ss)\n' "${C}●${RESET}" "$STEP_LABEL" "$timeout_seconds" >&2
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
    printf '%s %s (%ss)\n' "${G}●${RESET}" "$message" "$elapsed" >&2
    spinosa_log INFO "step=ok label=${STEP_LABEL} elapsed=${elapsed}s"
  else
    printf '%s %s (%ss)\n' "${R}●${RESET}" "$message" "$elapsed" >&2
    spinosa_log ERROR "step=fail label=${STEP_LABEL} elapsed=${elapsed}s status=${status}"
  fi
  STEP_STARTED_AT=0
  STEP_LABEL=""
  STEP_PROGRESS_DEST=""
  STEP_PROGRESS_TOTAL=""
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
  # Direct-pid kill only: never fall back to a process-GROUP kill (-$pid).
  # Timed payloads and direct-shell probes share the caller's process group
  # (no job control in non-interactive shells), so a group kill murders the
  # installer/test caller itself — observed as a silent step_end plus a
  # SIGINT-dead parent on Linux. A racy already-dead pid stays harmless.
  kill "-${sig}" "$pid" 2>/dev/null || true
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

# Globals that must survive run_timed_step subshell execution. Timed steps
# run the payload in a background subshell, so assignments made inside
# (TEMPLATE_PACK_ID from staged checks; BINARY_BACKUP/SHIM_BACKUP/... from
# activation) would otherwise be lost in the parent — dropping template_pack_id
# from metadata, leaking shim.backup files, and breaking EXIT-trap rollback.
# SMOKE_CWD joins SMOKE_GATE_TMP so a smoke-gate timeout can clean the temp
# working dir (not just surface partial output) from the parent.
TIMED_EXPORT_VARS="TEMPLATE_PACK_ID BINARY_BACKUP BINARY_STAGED ACTIVATION_STARTED SHIM_BACKUP CONFIG_BACKUP ENV_BACKUP SHIM_STAGE_FILE SMOKE_GATE_TMP SMOKE_CWD"

_timed_export_state() {
  [ -n "${SPINOSA_TIMED_STATE_FILE:-}" ] || return 0
  {
    for _k in $TIMED_EXPORT_VARS; do
      printf '%s=%q\n' "$_k" "${!_k:-}"
    done
  } > "$SPINOSA_TIMED_STATE_FILE" 2>/dev/null || true
}

_timed_import_state() {
  [ -n "${1:-}" ] && [ -f "$1" ] || return 0
  # Values are %q-quoted paths/flags we wrote ourselves; safe to eval.
  eval "$(cat "$1" 2>/dev/null || true)"
  rm -f "$1"
}

# Generic timed-step temp cleanup registry: payloads register every temp file
# or dir they create via timed_register_temp; run_timed_step deletes all
# registered paths on success, failure, timeout, and signal paths. Fixes the
# one-tempfile-at-a-time leak (e.g. the smoke-gate working dir died with the
# killed subprocess and never reached its rm -rf). Idempotent (rm -rf -f), so
# payloads keep their own explicit cleanup too. No-op outside a timed step.
timed_register_temp() {
  [ -n "${SPINOSA_TIMED_TEMP_REGISTRY:-}" ] || return 0
  [ -n "${1:-}" ] || return 0
  printf '%s\n' "$1" >> "$SPINOSA_TIMED_TEMP_REGISTRY" 2>/dev/null || true
}

_timed_cleanup_registered_temps() {
  [ -n "${1:-}" ] && [ -f "$1" ] || return 0
  while IFS= read -r _p || [ -n "$_p" ]; do
    if [ -n "$_p" ]; then
      rm -rf "$_p" 2>/dev/null || true
    fi
  done < "$1"
  rm -f "$1" 2>/dev/null || true
}

run_timed_step() {
  local label="$1" timeout_seconds="$2"
  shift 2
  [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || die "Invalid timeout for ${label}: ${timeout_seconds}"
  local output_file pid started status=0
  output_file="$(mktemp "${TMPDIR:-/tmp}/spinosa-step.XXXXXX")"
  local state_file
  state_file="$(mktemp "${TMPDIR:-/tmp}/spinosa-state.XXXXXX")"
  local temp_registry
  temp_registry="$(mktemp "${TMPDIR:-/tmp}/spinosa-temps.XXXXXX")"
  STEP_OUTPUT_FILE="$output_file"
  step_begin "$label" "$timeout_seconds"
  started="$(date +%s)"
  export SPINOSA_TIMED_STATE_FILE="$state_file"
  export SPINOSA_TIMED_TEMP_REGISTRY="$temp_registry"
  # EXIT alone is not enough: SIGTERM kills bash without running EXIT traps,
  # and the timeout path below kills the payload tree. Trap TERM/INT too so
  # partial state (e.g. BINARY_BACKUP set before a hang) still reaches the
  # parent for rollback. SIGKILL remains best-effort by nature.
  (trap '_timed_export_state' EXIT; trap '_timed_export_state; exit 143' TERM INT; trap - ERR; "$@") >"$output_file" 2>&1 &
  pid=$!
  unset SPINOSA_TIMED_STATE_FILE
  unset SPINOSA_TIMED_TEMP_REGISTRY
  STEP_COMMAND_PID="$pid"
  STEP_TEMP_REGISTRY="$temp_registry"
  while kill -0 "$pid" 2>/dev/null; do
    if (( $(date +%s) - started >= timeout_seconds )); then
      kill_process_tree_graceful "$pid"
      wait "$pid" 2>/dev/null || true
      STEP_COMMAND_PID=""
      _timed_import_state "$state_file"
      _timed_cleanup_registered_temps "$temp_registry"
      STEP_TEMP_REGISTRY=""
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
  _timed_import_state "$state_file"
  _timed_cleanup_registered_temps "$temp_registry"
  STEP_TEMP_REGISTRY=""
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
       echo "  SPINOSA_VERIFY_TIMEOUT_SECONDS  Override staged verify timeout (default: $DEFAULT_VERIFY_TIMEOUT_SECONDS)"
       echo "  SPINOSA_SMOKE_TIMEOUT_SECONDS  Override per-smoke timeout (default: $DEFAULT_SMOKE_TIMEOUT_SECONDS; budgets do not add up)"
       echo "  SPINOSA_ACTIVATE_TIMEOUT_SECONDS  Override activate timeout (default: $DEFAULT_ACTIVATE_TIMEOUT_SECONDS; must exceed probe)"
       echo "  SPINOSA_PATH_TIMEOUT_SECONDS  Override PATH-setup timeout (default: $DEFAULT_PATH_TIMEOUT_SECONDS)"
       echo "  SPINOSA_PROBE_TIMEOUT_SECONDS  Override version-probe timeout (default: $DEFAULT_PROBE_TIMEOUT_SECONDS)"
      echo ""
      echo "Paths:"
      echo "  --no-modify-path  Don't modify shell config files (~/.zshrc, etc.)"
      echo "  --prefix PATH     Install root (default: ~/.spinosa)"
      echo "  --bin-dir PATH    Shim directory (default: ~/.local/bin; Homebrew bin on macOS when writable)"
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
      printf '\n%s %s\n' "${R}●${RESET}" "Your OS \"$1\" is not supported." >&2
      printf '%s\n' "Spinosa currently supports macOS (Apple Silicon & Intel) and Linux (glibc) on arm64 and x64." >&2
      printf '%s\n' "See https://github.com/medialab/spinosa#requirements for alternatives." >&2
      printf 'Unsupported OS for binary distribution: %s\n' "$1" >&2
      return 1
      ;;
  esac

  case "$arch_raw" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64|x64) arch="x64" ;;
    *)
      printf '\n%s %s\n' "${R}●${RESET}" "Your CPU architecture \"$2\" is not supported." >&2
      printf '%s\n' "Spinosa currently supports arm64 and x64 (amd64) on macOS and Linux (glibc)." >&2
      printf '%s\n' "See https://github.com/medialab/spinosa#requirements for alternatives." >&2
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

# Pure default for the PATH shim directory (testable).
# Args: os home xdg_bin_home brew_bin usr_local_bin keep_local(0|1)
default_spinosa_bin_dir() {
  local os="${1:-}"
  local home="${2:-}"
  local xdg_bin="${3:-}"
  local brew="${4:-}"
  local usr_local="${5:-}"
  local keep_local="${6:-0}"
  if [ "$keep_local" = "1" ]; then
    printf '%s/.local/bin\n' "$home"
    return 0
  fi
  case "$os" in
    Darwin|darwin)
      if [ -n "$brew" ]; then
        printf '%s\n' "$brew"
        return 0
      fi
      if [ -n "$usr_local" ]; then
        printf '%s\n' "$usr_local"
        return 0
      fi
      ;;
  esac
  if [ -n "$xdg_bin" ]; then
    printf '%s\n' "$xdg_bin"
    return 0
  fi
  printf '%s/.local/bin\n' "$home"
}

resolve_spinosa_bin_dir() {
  [ -n "${SPINOSA_BIN_DIR:-}" ] && return 0
  local os brew="" usr="" keep=0
  os="$(uname -s 2>/dev/null || printf linux)"
  if is_owned_spinosa_shim "${HOME}/.local/bin/spinosa"; then
    keep=1
  fi
  if [ -d /opt/homebrew/bin ] && [ -w /opt/homebrew/bin ]; then
    brew="/opt/homebrew/bin"
  fi
  if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    usr="/usr/local/bin"
  fi
  SPINOSA_BIN_DIR="$(default_spinosa_bin_dir "$os" "$HOME" "${XDG_BIN_HOME:-}" "$brew" "$usr" "$keep")"
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

# ══════════════════════════════════════════════════════════════════════════════
# LOCAL OCR — none ships. Users transcribe scans via a selected vision model,
# or copy files as-is; digital PDFs always extract via the internal pdf.js
# engine (no model needed). The installer provisions no OCR assets. Stale
# $SPINOSA_HOME/tools/ dirs from previous versions are ignored (nothing reads
# them) — safe to delete by hand. Function names below are kept so existing
# tests/call sites keep working; every resolver reports absent and
# install_bundled_tools is a no-op.
# ══════════════════════════════════════════════════════════════════════════════

tools_platform_dir() {
  [ -n "${PLATFORM:-}" ] || return 1
  printf '%s/tools/%s' "$SPINOSA_HOME" "$PLATFORM"
}

legacy_ocr_data_complete() {
  # No local engine ships: language data is never provisioned, never complete.
  return 1
}

# No local OCR engine ships: always absent (no host probing — nothing to complete).
host_ocr_complete() {
  return 1
}

write_tools_manifest() {
  local source="$1" manifest dir
  : "$source"
  dir="$(tools_platform_dir)" || return 1
  manifest="${SPINOSA_HOME}/tools/TOOLS_MANIFEST.json"
  mkdir -p "$(dirname "$manifest")" "$dir/bin" 2>/dev/null || true
  cat > "$manifest" <<EOF_JSON
{"platform":"${PLATFORM}","source":"removed","ocr":"removed","note":"No local OCR engine ships — vision model or copy-as-is; digital PDFs via pdf.js","installed_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF_JSON
}

# Tier 1 (REMOVED): no per-platform OCR tool archives are published anymore.
# Kept as a fail-closed stub so any lingering call sites fail safe.
try_tools_tarball() {
  return 1
}

# Tier 2 (REMOVED — standalone contract): the production installer must never
# modify the host system. That path is deleted. Host tools are only
# detected for development behind SPINOSA_DEV_HOST_TOOLS=1, never installed.
# Kept as a fail-closed stub so any lingering call sites fail safe.
try_package_manager_tools() {
  vinfo "Package-manager OCR install is disabled: Spinosa is standalone and never modifies the host system."
  vinfo "Resolution order: 1) Spinosa bundled tools 2) SPINOSA_DEV_HOST_TOOLS=1 developer override 3) unavailable."
  return 1
}

# Language data top-up (REMOVED): no language data is provisioned anymore.
# Kept as a fail-closed stub so any lingering call sites fail safe.
ensure_bundled_ocr_data() {
  vinfo "No local OCR engine ships — no language data to stage (vision model or copy-as-is; digital PDFs via pdf.js)."
  return 1
}

install_bundled_tools() {
  local checksums_file="$1"
  : "$checksums_file"
  vinfo "No local OCR engine ships — skipping OCR tools (pick a vision model to transcribe scans, or copy files as-is)."
  write_tools_manifest "removed" 2>/dev/null || true
  return 0
}

prompt_install_repair() {  local detail="${1:-Something in the Spinosa install needs fixing.}"
  printf '\n' >&2
  printf '%s %s\n' "${R}●${RESET}" "Installation needs repair." >&2
  printf '%s\n' "$detail" >&2
  if [ "${SPINOSA_REPAIR:-}" = "1" ]; then
    info "Repairing automatically (SPINOSA_REPAIR=1)..."
    return 0
  fi
  if [ "$YES" -eq 1 ]; then
    info "Repairing automatically (--yes)..."
    return 0
  fi
  printf '%s %s [Y/n]: ' "${C}?${RESET}" "Repair now?" >&2
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
  local home="$SPINOSA_HOME"
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

# Pure parser: last Content-Length value from HTTP header text, or empty.
parse_content_length() {
  printf '%s\n' "${1:-}" | grep -i '^content-length:' | tail -n 1 | tr -cd '0-9' || true
}

# Best-effort expected download size via HEAD (follows redirects for
# GitHub release CDN URLs). Prints bytes, or nothing when unknown.
# Never fails the install — callers treat empty as "no % available".
download_total_bytes() {
  local url="$1" headers len
  case "${url:-}" in http://*|https://*) ;; *) return 1 ;; esac
  command -v curl >/dev/null 2>&1 || return 1
  headers="$(curl -sIL --max-time 10 --connect-timeout 5 "$url" 2>/dev/null || true)"
  [ -n "$headers" ] || return 1
  len="$(parse_content_length "$headers")"
  [[ "$len" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$len"
}

# Download wrapped in a timed step with live % on the wave line.
# Falls back to the plain elapsed/timeout display when the total size
# is unknown (e.g. wget path, missing Content-Length, local file URL).
run_download_step() {
  local label="$1" timeout_seconds="$2" url="$3" dest="$4" total="" status=0
  total="$(download_total_bytes "$url" 2>/dev/null || true)"
  STEP_PROGRESS_DEST="$dest"
  STEP_PROGRESS_TOTAL="$total"
  run_timed_step "$label" "$timeout_seconds" download "$url" "$dest" || status=$?
  STEP_PROGRESS_DEST=""
  STEP_PROGRESS_TOTAL=""
  return "$status"
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
  local tmp
  tmp="$(mktemp "${config}.tmp.XXXXXX")" || die "Cannot create temp file for ${config}"
  trap 'rm -f "$tmp"' RETURN
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key ":") == 1 { print key ": " value; found = 1; next }
    { print }
    END { if (!found) print key ": " value }
  ' "$config" > "$tmp"
  mv "$tmp" "$config"
  trap - RETURN
}

config_delete_key() {
  local config="$1" key="$2"
  [ -f "$config" ] || return 0
  local tmp
  tmp="$(mktemp "${config}.tmp.XXXXXX")" || die "Cannot create temp file for ${config}"
  trap 'rm -f "$tmp"' RETURN
  awk -v key="$key" 'index($0, key ":") != 1 { print }' "$config" > "$tmp"
  mv "$tmp" "$config"
  trap - RETURN
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
  local install_tmp
  install_tmp="$(mktemp "${SPINOSA_METADATA_DIR}/install.yaml.tmp.XXXXXX")" || die "Cannot stage install.yaml"
  trap 'rm -f "$install_tmp"' RETURN
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
  trap - RETURN

  if [ ! -f "$config" ]; then
    local config_tmp beta_toggle legacy_runtime
    # Hoisted above the RETURN trap: under functrace (e.g. bats) RETURN traps
    # fire on every nested function return (including command substitutions),
    # so any function call here would run the cleanup early and delete the
    # staged config. No function calls may run while the trap is armed.
    beta_toggle="$(installer_beta_toggle)"
    legacy_runtime=""
    if legacy_source_runtime_present; then legacy_runtime=1; fi
    config_tmp="$(mktemp "${config}.tmp.XXXXXX")" || die "Cannot stage spinosa config"
    trap 'rm -f "$config_tmp"' RETURN
    cat > "$config_tmp" << CONFIG_EOF
# Spinosa installation marker — do not remove
spinosa: true
beta: ${beta_toggle}
auto_upgrade: true
distribution: binary
last_installed_version: "${VERSION}"
CONFIG_EOF
    if [ -n "${TEMPLATE_PACK_ID:-}" ]; then
      printf 'template_pack_id: "%s"\n' "$TEMPLATE_PACK_ID" >> "$config_tmp"
    fi
    if [ -n "$legacy_runtime" ]; then
      printf 'legacy_source_runtime: true\n' >> "$config_tmp"
    fi
    mv "$config_tmp" "$config"
    trap - RETURN
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
  # Staged-doctor verdict: a timeout installs anyway (orange) and records why;
  # a green doctor clears any previous flag. Applies to fresh and existing homes.
  if [ -n "${DOCTOR_UNVERIFIED:-}" ]; then
    config_set_key "$config" "doctor_unverified" "\"${DOCTOR_UNVERIFIED}\""
  else
    config_delete_key "$config" "doctor_unverified"
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
  local err_sink="${2:-/dev/null}"
  local out rc
  # Overridable for tests; default 30s budget per attempt (a freshly
  # downloaded 150MB+ binary cold-starts slowly — Gatekeeper assessment on
  # the new inode, cold page cache, and a loaded host easily exceed the old
  # 5s and killed healthy binaries). Worst case is ~2x budget: the fallback
  # runs only after the first attempt failed FAST, never after a timeout.
  local budget_seconds="${SPINOSA_PROBE_TIMEOUT_SECONDS:-$DEFAULT_PROBE_TIMEOUT_SECONDS}"
  [[ "$budget_seconds" =~ ^[1-9][0-9]*$ ]] || budget_seconds="$DEFAULT_PROBE_TIMEOUT_SECONDS"
  local out_file
  out_file="$(mktemp "${TMPDIR:-/tmp}/spinosa-probe.XXXXXX")"
  timed_register_temp "$out_file"
  : >"$err_sink" 2>/dev/null || true
  # Phase 1 (--json). A timeout is terminal: the tree is reaped and we stop.
  # Falling back from inside the dying shell would orphan a fresh subtree —
  # the killed first invocation's `||` wakes the wrapper into a second
  # invocation whose children outlive it (see timed-step.bats tree-kill test).
  rc=0
  probe_one_version_command "$budget_seconds" "$out_file" "$err_sink" \
    "$binary" version --json || rc=$?
  if [ "$rc" -eq 1 ]; then
    rm -f "$out_file"
    return 1
  fi
  out="$(cat "$out_file" 2>/dev/null || true)"
  if [ -n "$out" ] && [ "$rc" -eq 0 ]; then
    printf '%s\n' "$out"
    rm -f "$out_file"
    return 0
  fi
  # Normal failure (fast exit, unusable output) — fallback allowed: the first
  # tree already exited, so a fresh budgeted attempt cannot orphan anything.
  rc=0
  probe_one_version_command "$budget_seconds" "$out_file" "$err_sink" \
    "$binary" version || rc=$?
  if [ "$rc" -eq 1 ]; then
    rm -f "$out_file"
    return 1
  fi
  cat "$out_file" 2>/dev/null || true
  rm -f "$out_file"
}

# Single bounded probe invocation: runs one command (never a fallback chain)
# in the background with stdout to out_file and stderr appended to err_sink.
# Polls every 0.2s so a trapped INT stays responsive. Returns 0 when the
# command exited in budget (inspect the output file for success), 2 when it
# exited nonzero fast (caller may fall back), 1 on timeout — the whole tree
# is reaped and the caller must NOT start fallback work (it would orphan).
probe_one_version_command() {
  local budget_seconds="${1:-30}"
  local out_file="$2"
  local err_sink="$3"
  shift 3
  [[ "$budget_seconds" =~ ^[1-9][0-9]*$ ]] || budget_seconds=30
  local pid waited status
  ( "$@" ) >"$out_file" 2>>"$err_sink" &
  pid=$!
  waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge $(( budget_seconds * 5 )) ]; then
      # Tree kill: the command may have spawned children (e.g. a shim
      # re-exec) that would otherwise outlive the wrapper pid.
      kill_process_tree_graceful "$pid"
      wait "$pid" 2>/dev/null || true
      return 1
    fi
    sleep 0.2
    waited=$((waited + 1))
  done
  wait "$pid" 2>/dev/null || status=$?
  if [ "${status:-0}" -eq 0 ]; then
    return 0
  fi
  return 2
}

# Bounded poll for a background pid. Returns 0 when it exits within budget,
# 1 on timeout (the caller kills and reaps). Poll sleeps are short foreground
# children, so a trapped INT is serviced within ~0.2s instead of blacking out
# for the whole budget inside a command substitution (see get_installed_version).
wait_for_pid() {
  local pid="$1" budget_seconds="$2"
  local waited=0
  [[ "$budget_seconds" =~ ^[1-9][0-9]*$ ]] || return 1
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge $(( budget_seconds * 5 )) ]; then
      return 1
    fi
    sleep 0.2
    waited=$((waited + 1))
  done
  wait "$pid" 2>/dev/null || true
  return 0
}

# Async probe variant for direct main-shell callers: starts ONE version command
# in the background and echoes only its pid (fast — no waiting), writing
# output to the caller-provided file. The caller polls with wait_for_pid so
# CTRL+C stays responsive; a plain out="$(probe...)" here would ignore CTRL+C
# for up to 30s because background children ignore SIGINT while the shell
# sits in the substitution.
# Single command only, never a fallback chain: if the caller times out and
# tree-kills the pid, nothing inside can wake into fresh work (which would
# orphan). Fallback across commands is orchestrated by the caller, in the
# parent shell, only after a fast failure — never after a timeout.
# Usage: probe_spinosa_version_output_async <binary> <err_sink> <out_file> <version-args...>
probe_spinosa_version_output_async() {
  local binary="$1"
  local err_sink="${2:-/dev/null}"
  local out_file="$3"
  shift 3
  : >"$err_sink" 2>/dev/null || true
  ( "$binary" "$@" || true ) >"$out_file" 2>>"$err_sink" &
  printf '%s\n' "$!"
}

# Version probe without command-substitution scope loss.
# Usage: get_installed_version [RESULT_VAR]
# With RESULT_VAR: assigns the version (possibly empty) to the named parent-shell
# variable and prints nothing — callers must use this form so PROBE_PID stays
# visible to the INT/TERM handler (a `$(get_installed_version)` call runs in a
# subshell where PROBE_PID assignments are lost). Without args: prints to
# stdout (legacy/test helper only — never use from installer flows).
get_installed_version() {
  local __result_var="${1:-}"
  local __version=""
  local meta_ver=""
  meta_ver="$(read_last_installed_version 2>/dev/null || true)"
  if [ -x "${SPINOSA_HOME}/bin/spinosa" ] && [ -n "$meta_ver" ]; then
    __version="$meta_ver"
  elif [ -x "${SPINOSA_HOME}/bin/spinosa" ]; then
    local out ver probe_out probe_pid timed_out
    local probe_budget="${SPINOSA_PROBE_TIMEOUT_SECONDS:-$DEFAULT_PROBE_TIMEOUT_SECONDS}"
    [[ "$probe_budget" =~ ^[1-9][0-9]*$ ]] || probe_budget="$DEFAULT_PROBE_TIMEOUT_SECONDS"
    probe_out="$(mktemp "${TMPDIR:-/tmp}/spinosa-probe.XXXXXX")"
    timed_register_temp "$probe_out"
    out=""
    timed_out=0
    # Phase 1 (--json), async + polled so CTRL+C stays responsive; the
    # signal handler reaps PROBE_PID's tree on cancel.
    probe_pid="$(probe_spinosa_version_output_async "${SPINOSA_HOME}/bin/spinosa" /dev/null "$probe_out" version --json || true)"
    PROBE_PID="${probe_pid:-}"
    if [ -n "${probe_pid:-}" ] && wait_for_pid "$probe_pid" "$probe_budget"; then
      out="$(cat "$probe_out" 2>/dev/null || true)"
    else
      # Timeout: tree-kill and stop. No fallback — the reaped tree must not
      # be followed by fresh work that would orphan on the next kill.
      timed_out=1
      if [ -n "${probe_pid:-}" ]; then
        kill_process_tree_graceful "$probe_pid"
        wait "$probe_pid" 2>/dev/null || true
      fi
      out=""
    fi
    # Fallback (plain version) only after a FAST failure with unusable
    # output — same async discipline, fresh budget, same terminal timeout.
    if [ "$timed_out" -eq 0 ] && [ -z "$(parse_version_output "$out" 2>/dev/null || true)" ]; then
      probe_pid="$(probe_spinosa_version_output_async "${SPINOSA_HOME}/bin/spinosa" /dev/null "$probe_out" version || true)"
      PROBE_PID="${probe_pid:-}"
      if [ -n "${probe_pid:-}" ] && wait_for_pid "$probe_pid" "$probe_budget"; then
        out="$(cat "$probe_out" 2>/dev/null || true)"
      else
        if [ -n "${probe_pid:-}" ]; then
          kill_process_tree_graceful "$probe_pid"
          wait "$probe_pid" 2>/dev/null || true
        fi
        out=""
      fi
    fi
    PROBE_PID=""
    rm -f "$probe_out"
    if [ -n "$out" ] && ver="$(parse_version_output "$out")"; then
      __version="$ver"
    else
      # Probe timed out or failed — treat as unhealthy, fall through to metadata
      spinosa_log WARN "version probe timed out or failed for ${SPINOSA_HOME}/bin/spinosa"
      __version="$meta_ver"
    fi
  else
    __version="$meta_ver"
  fi
  if [ -n "$__result_var" ]; then
    printf -v "$__result_var" '%s' "$__version"
  else
    printf '%s\n' "$__version"
  fi
  return 0
}

resolve_pinned_version_from_installer() {
  local channel="$1" url="$2"
  local installer_file resolved
  installer_file="$(mktemp "${TMPDIR:-/tmp}/spinosa-channel.XXXXXX")"
  run_download_step "Resolve latest ${channel} release" 60 "$url" "$installer_file" \
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
  run_download_step "Verify release age" 60 "$api_url" "$release_file" \
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
    printf '%s %s\n' "${R}●${RESET}" "Spinosa v${installed} is already installed." >&2
    if [ "$YES" -eq 1 ]; then
      info "Skipping reinstall prompt (--yes)."
      return 1
    fi
    printf '%s %s [y/N]: ' "${C}?${RESET}" "Reinstall?" >&2
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
    printf '%s %s\n' "${C}●${RESET}" "Spinosa v${installed} is installed. v${target} is available." >&2
    if [ "$YES" -eq 1 ]; then
      info "Auto-upgrading (--yes)."
      return 0
    fi
    printf '%s %s [Y/n]: ' "${C}?${RESET}" "Upgrade?" >&2
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
    printf '%s %s\n' "${R}●${RESET}" "Installed v${installed} is newer than target v${target}." >&2
    if [ "$YES" -eq 1 ]; then
      info "Skipping downgrade (--yes)."
      return 1
    fi
    printf '%s %s [y/N]: ' "${C}?${RESET}" "Downgrade?" >&2
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
  printf '%s %s [Y/n]: ' "${C}?${RESET}" "Install Spinosa v${version}?" >&2
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
    local installed_version=""
    get_installed_version installed_version
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

# Fail-closed staged gates: staged version match plus template ensure/verify.
# Any failure here refuses activation (never soft-continue).
run_staged_core_checks() {
  local binary="$1"
  local out ver
  local version_ok=0
  local probe_err=""
  local gate_start gate_elapsed

  [ -x "$binary" ] || die "Staged binary is not executable: ${binary}"

  gate_note "Checking staged version..."
  gate_start="$(date +%s)"
  probe_err="$(mktemp "${TMPDIR:-/tmp}/spinosa-probe-err.XXXXXX")"
  timed_register_temp "$probe_err"
  if out="$(probe_spinosa_version_output "$binary" "$probe_err" || true)"; then
    if [ -n "$out" ] && ver="$(parse_version_output "$out")"; then
      version_ok=1
    fi
  fi
  if [ "$version_ok" -eq 0 ]; then
    # Preserve the loader's stderr (e.g. SIGKILL / Code Signature Invalid
    # on Tahoe) in spinosa.log instead of discarding it to /dev/null.
    spinosa_log ERROR "staged probe stderr: $(head -c 2048 "$probe_err" 2>/dev/null)"
    rm -f "$probe_err"
    # Fallback already included in probe (tries both --json and plain); if still not ok, fail
    [ -n "${ver:-}" ] || die "Staged binary failed version check"
  fi
  rm -f "$probe_err"

  if [ "$ver" != "$VERSION" ]; then
    die "Staged binary version mismatch: got ${ver}, expected ${VERSION}"
  fi
  gate_elapsed=$(( $(date +%s) - gate_start ))
  gate_note "Staged binary reports version ${ver} (${gate_elapsed}s)"

  local pack
  pack="$(extract_template_pack_id "$out" || true)"
  if [ -n "$pack" ]; then
    TEMPLATE_PACK_ID="$pack"
  fi

  # Activation gates (binary-distribution-contract): template ensure/verify + smoke
  # gates must pass before the staged binary is activated. Fail closed — never soft-continue.
  # Preserve diagnostics in the log instead of discarding to /dev/null.
  local gate_tmp
  gate_note "Ensuring templates..."
  gate_start="$(date +%s)"
  gate_tmp="$(mktemp "${TMPDIR:-/tmp}/spinosa-gate.XXXXXX")"
  timed_register_temp "$gate_tmp"
  if "$binary" internal template ensure --json >"$gate_tmp" 2>&1; then
    gate_elapsed=$(( $(date +%s) - gate_start ))
    spinosa_log INFO "template ensure output: $(head -c 4096 "$gate_tmp" 2>/dev/null)"
    gate_note "Template ensure succeeded (${gate_elapsed}s)"
    gate_note "Verifying templates..."
    gate_start="$(date +%s)"
    if "$binary" internal template verify --json >"$gate_tmp" 2>&1; then
      gate_elapsed=$(( $(date +%s) - gate_start ))
      spinosa_log INFO "template verify output: $(head -c 4096 "$gate_tmp" 2>/dev/null)"
      gate_note "Template verify succeeded (${gate_elapsed}s)"
    else
      spinosa_log ERROR "template verify failed: $(head -c 4096 "$gate_tmp" 2>/dev/null)"
      rm -f "$gate_tmp"
      die "Template verify failed — refusing to activate staged binary"
    fi
  else
    spinosa_log ERROR "template ensure failed: $(head -c 4096 "$gate_tmp" 2>/dev/null)"
    rm -f "$gate_tmp"
    die "Template ensure failed — refusing to activate staged binary"
  fi
  rm -f "$gate_tmp"
}

# One smoke under its own timeout. Used so catalog + natives + PDF + workers
# do not share a single 300s budget (qemu linux-x64 needs a full budget each).
_invoke_staged_smoke() {
  local binary="$1" smoke="$2" cwd="$3" out="$4"
  (cd "$cwd" && "$binary" internal smoke "$smoke" --json) >"$out" 2>&1
}

# Deterministic binary-integrity smokes (no full instance doctor): the staged
# binary must already have passed checksum, version, and template gates above.
# Runs provider catalog, native imports, PDF runtime, TUI worker, and parser
# worker — credential-free — and fails closed on any of them. Each smoke gets
# DEFAULT_SMOKE_TIMEOUT_SECONDS of its own; elapsed time does not carry over.
# Returns 0 when all pass, 124 when one times out, 1 on a hard failure.
# Publishes the gate temp path in SMOKE_GATE_TMP (partial output) and the
# working dir in SMOKE_CWD so a timeout can surface output and clean up.
run_staged_smoke_checks() {
  local binary="$1"
  local gate_start gate_elapsed smoke_status
  local gate_tmp smoke
  gate_tmp="$(mktemp "${TMPDIR:-/tmp}/spinosa-smoke.XXXXXX")"
  SMOKE_GATE_TMP="$gate_tmp"
  timed_register_temp "$gate_tmp"
  # Do not bootstrap the project from the installer's invocation directory.
  # Global (not local): a timeout kills this subshell before its rm -rf runs,
  # so the parent timeout/signal paths must see the path to clean it.
  SMOKE_CWD="$(mktemp -d "${TMPDIR:-/tmp}/spinosa-smoke-cwd.XXXXXX")"
  timed_register_temp "$SMOKE_CWD"
  for smoke in provider-catalog native-imports pdf-runtime tui-worker parser-worker; do
    gate_note "Running smoke ${smoke}..."
    gate_start="$(date +%s)"
    smoke_status=0
    run_timed_step "Smoke ${smoke}" "$DEFAULT_SMOKE_TIMEOUT_SECONDS" \
      _invoke_staged_smoke "$binary" "$smoke" "$SMOKE_CWD" "$gate_tmp" || smoke_status=$?
    if [ "$smoke_status" -eq 0 ]; then
      gate_elapsed=$(( $(date +%s) - gate_start ))
      spinosa_log INFO "smoke ${smoke} output: $(head -c 4096 "$gate_tmp" 2>/dev/null)"
      gate_note "Smoke ${smoke} passed (${gate_elapsed}s)"
      continue
    fi
    if [ "$smoke_status" -eq 124 ]; then
      spinosa_log ERROR "smoke ${smoke} timed out after ${DEFAULT_SMOKE_TIMEOUT_SECONDS}s"
      return 124
    fi
    spinosa_log ERROR "smoke ${smoke} failed; full output follows"
    while IFS= read -r line || [ -n "$line" ]; do
      spinosa_log ERROR "smoke ${smoke}: $line"
    done < "$gate_tmp"
    tail -n 20 "$gate_tmp" >&2 || true
    rm -rf "$SMOKE_CWD"
    rm -f "$gate_tmp"
    SMOKE_GATE_TMP=""
    SMOKE_CWD=""
    return 1
  done
  rm -rf "$SMOKE_CWD"
  rm -f "$gate_tmp"
  SMOKE_GATE_TMP=""
  SMOKE_CWD=""
}

# Full staged gate sequence (fail-closed): used by --verify-only and covered by
# installer tests. The interactive install path instead runs the core gates and
# the smoke gates as separate timed steps so a smoke timeout can warn (orange,
# flagged unverified) instead of refusing activation. Full `spinosa doctor`
# stays the deeper application diagnostic — it is intentionally not part of
# the integrity gate (it boots the whole instance plus providers).
run_staged_binary_checks() {
  run_staged_core_checks "$1" || return $?
  run_staged_smoke_checks "$1" || die "Binary smokes reported issues — refusing to activate staged binary"
}

# Maps the staged smoke timed-step exit to green/orange/red. Returns 0 to
# proceed (recording DOCTOR_UNVERIFIED on orange); dies red otherwise.
# Orange (124, timeout) means "no verdict": checksum, version, and template
# gates already passed, so install proceeds flagged health-unverified.
handle_smoke_gate_result() {
  local smoke_gate_status="$1"
  case "$smoke_gate_status" in
    0)
      DOCTOR_UNVERIFIED=""
      ;;
    124)
      if [ -n "${SMOKE_GATE_TMP:-}" ] && [ -f "${SMOKE_GATE_TMP}" ]; then
        spinosa_log WARN "partial smoke output before timeout (last 20 lines):"
        tail -n 20 "${SMOKE_GATE_TMP}" 2>/dev/null | while IFS= read -r line || [ -n "$line" ]; do spinosa_log WARN "smoke: $line"; done
        rm -f "${SMOKE_GATE_TMP}"
      fi
      SMOKE_GATE_TMP=""
      # The registry usually already removed the killed subprocess's working
      # dir; belt-and-braces for payloads that predate the registry.
      if [ -n "${SMOKE_CWD:-}" ]; then
        rm -rf "${SMOKE_CWD}" 2>/dev/null || true
      fi
      SMOKE_CWD=""
      amber "Binary smokes timed out after ${DEFAULT_SMOKE_TIMEOUT_SECONDS}s — installing anyway (health unverified)"
      amber "Run 'spinosa doctor' once the machine is idle to confirm health"
      DOCTOR_UNVERIFIED="timeout"
      ;;
    *)
      die "Binary smokes reported issues — refusing to activate staged binary"
      ;;
  esac
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
    info "Run Spinosa from: ${SPINOSA_HOME}/bin/spinosa"
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
  printf '%s Run Spinosa with: %s%s%s\n' "${C}●${RESET}" "${BOLD}" "spinosa" "${RESET}"

  # Pipe subshells inherit the parent PATH, so on upgrades the command may
  # already work here — only lecture about PATH when it genuinely doesn't.
  local on_path_now=0
  if "${SPINOSA_BIN_DIR}/spinosa" version >/dev/null 2>&1 \
    || "${SPINOSA_HOME}/bin/spinosa" version >/dev/null 2>&1; then
    vok "Command 'spinosa' is ready in this install session"
    on_path_now=1
  elif command -v spinosa >/dev/null 2>&1; then
    warn "Command 'spinosa' is on PATH but not runnable — run: ${reload_hint}"
    on_path_now=1
  else
    warn "Command 'spinosa' is still not on PATH in this session"
    note "Run: ${reload_hint}"
  fi

  if install_stdin_is_piped && [ "$on_path_now" -eq 0 ]; then
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
  printf '\n'
  printf '%s\n' '███████╗██████╗ ██╗███╗   ██╗ ██████╗ ███████╗ █████╗'
  printf '%s\n' '██╔════╝██╔══██╗██║████╗  ██║██╔═══██╗██╔════╝██╔══██╗'
  printf '%s\n' '███████╗██████╔╝██║██╔██╗ ██║██║   ██║███████╗███████║'
  printf '%s\n' '╚════██║██╔═══╝ ██║██║╚██╗██║██║   ██║╚════██║██╔══██║'
  printf '%s\n' '███████║██║     ██║██║ ╚████║╚██████╔╝███████║██║  ██║'
  printf '%s\n' '╚══════╝╚═╝     ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝'
  printf '%s\n\n' 'Binary Installer'
}

handle_verify_only() {
  local existing_version=""
  get_installed_version existing_version
  if [ -z "$existing_version" ] || [ ! -x "${SPINOSA_HOME}/bin/spinosa" ]; then
    die "No Spinosa binary installation found at ${SPINOSA_HOME}"
  fi
  VERSION="$existing_version"
  # Core gates and smokes must not share one timer. qemu linux-x64 spends
  # 80s+ on templates, then each smoke needs its own budget.
  run_timed_step "Verify Spinosa v${existing_version}" "$DEFAULT_VERIFY_TIMEOUT_SECONDS" \
    run_staged_core_checks "${SPINOSA_HOME}/bin/spinosa" \
    || die "Spinosa v${existing_version} failed verification"
  run_staged_smoke_checks "${SPINOSA_HOME}/bin/spinosa" \
    || die "Spinosa v${existing_version} failed verification"
  ok "Verified Spinosa v${existing_version}"
}

handle_dry_run() {
  local base asset_url checksums_url
  base="$(release_asset_base)"
  asset_url="${base}/${ASSET_NAME}"
  checksums_url="${base}/checksums.txt"
  info "Dry run — would download:"
  info "${checksums_url}"
  info "${asset_url}"
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

  resolve_spinosa_bin_dir
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

  # Install signal/exit traps before any blocking work (version resolve,
  # prompts, lock): CTRL+C then cancels gracefully with cleanup and exit 130
  # instead of dying without it. Safe this early — every referenced variable is
  # initialized at the top of the file and each guard no-ops when unset.
  trap 'restore_binary_backup_if_needed; _spinosa_cleanup_lock; if [ -n "${SHIM_STAGE_FILE:-}" ]; then rm -f "$SHIM_STAGE_FILE"; fi; if [ -n "${SPINOSA_EARLY_LOG:-}" ] && [ -f "$SPINOSA_EARLY_LOG" ]; then rm -f "$SPINOSA_EARLY_LOG"; fi' EXIT
  trap '_spinosa_install_signal 130' INT TERM HUP

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

  # Generous budget for a tiny file: slow or proxied networks should stall,
  # not fail, the checksums fetch (curl still caps each attempt at 30s
  # connect / 600s total and retries).
  run_download_step "Download checksums" "$DEFAULT_CHECKSUMS_TIMEOUT_SECONDS" "$checksums_url" "$checksums_file" \
    || die "Failed to download checksums.txt from ${checksums_url}"
  run_download_step "Download ${ASSET_NAME}" "$DEFAULT_DOWNLOAD_TIMEOUT_SECONDS" "$asset_url" "$staged_binary" \
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
  # No local OCR engine ships: record the removal manifest
  # BEFORE staged verification so the ordering invariant (tools step precedes
  # verification) keeps holding. The staged doctor gate reports OCR as
  # unsupported (by design), never a failure.
  section "Local OCR (removed)"
  install_bundled_tools "$checksums_file" \
    || warn "OCR tools step failed — continuing without local OCR (vision model or copy-as-is); see $(spinosa_log_file)"

  [[ "$VERBOSE" == "1" ]] && section "Stage checks"
  # Mirror gate progress to the controlling terminal when interactive:
  # run_timed_step captures the child's output, so without this the console
  # shows only the wave line until the whole verify budget resolves.
  _gate_tty=""
  if [ -t 2 ] && [ -c /dev/tty ]; then _gate_tty=/dev/tty; fi
  SPINOSA_GATE_TTY="$_gate_tty" run_timed_step "Verifying package" "$DEFAULT_VERIFY_TIMEOUT_SECONDS" \
    run_staged_core_checks "$staged_binary" \
    || die "Staged binary failed verification"
  # Each smoke has its own 300s budget. Do not wrap the whole batch in one
  # timer — qemu linux-x64 spends ~30s per earlier smoke and then the TUI
  # worker still needs a full fetch window.
  smoke_gate_status=0
  SMOKE_GATE_TMP=""
  SPINOSA_GATE_TTY="$_gate_tty" run_staged_smoke_checks "$staged_binary" || smoke_gate_status=$?
  handle_smoke_gate_result "$smoke_gate_status"

  [[ "$VERBOSE" == "1" ]] && section "Activate"
  # Activate includes a version probe. Do not wrap that probe in a 30s
  # outer clock — qemu linux-x64 spent 33s here after smokes already passed.
  run_timed_step "Installing" "$DEFAULT_ACTIVATE_TIMEOUT_SECONDS" _install_activate \
    || die "Installation failed — see $(spinosa_log_file)"

  # Workspace launchers (binary-distribution-contract): migrate managed
  # launchers on ownership proof, preserve modified ones. Never fails the
  # global install.
  migrate_workspace_launchers 2>/dev/null || true

  INSTALL_COMPLETED=1
  ACTIVATION_STARTED=0
  for _bk in "${BINARY_BACKUP:-}" "${SHIM_BACKUP:-}" "${CONFIG_BACKUP:-}" "${ENV_BACKUP:-}"; do
    if [ -n "$_bk" ] && [ -e "$_bk" ]; then
      rm -f "$_bk" 2>/dev/null || true
    fi
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
      run_timed_step "Configure shell PATH" "$DEFAULT_PATH_TIMEOUT_SECONDS" setup_shell_path \
        || warn "Shell PATH configuration timed out or failed — add ${SPINOSA_BIN_DIR} to PATH manually; see $(spinosa_log_file)"
    else
      setup_shell_path 2>/dev/null || true
    fi
    activate_spinosa_path_for_session 2>/dev/null || true
  fi

  echo ""
  if [[ "$FROM_UPGRADE" -eq 1 ]]; then
    printf '%s %s\n' "${G}●${RESET}" "${BOLD}✨ Spinosa installed successfully! ✨${RESET}" >&2
  else
    printf '%s%s%s\n\n' "${BOLD}" "✨ Spinosa installed successfully! ✨" "${RESET}"
  fi

  spinosa_log INFO "install complete version=${VERSION} home=${SPINOSA_HOME} distribution=binary"
  local log_file
  log_file="$(spinosa_log_file)"
  if [ -t 2 ] && [ "${NO_COLOR:-}" != "1" ]; then
    printf '%s Install log: \033]8;;file://%s\033\\%s\033]8;;\033\\\n' "${C}●${RESET}" "$log_file" "$log_file"
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
