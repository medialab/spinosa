# Spinosa Pre-Release Test Suite

Production-grade gate before marking a version **releaseable**. Run this on every release candidate (patch, minor, or major). Do not publish until every **blocking** item passes.

**Related docs:** [CLI reference](cli.md), [RELEASE_GUIDE.md](../../../RELEASE_GUIDE.md) (packaging/publish steps).

---

## Release gate overview

```mermaid
flowchart LR
  auto[Phase_A_Automated]
  install[Phase_B_Install]
  cli[Phase_C_CLI]
  interactive[Phase_D_Interactive]
  workspace[Phase_E_Workspace]
  linux[Phase_F_Linux_VM]
  github[Phase_G_GitHub]
  signoff[Sign_off]

  auto --> install --> cli --> interactive --> workspace
  workspace --> linux --> github --> signoff
```

| Phase | Where | Blocking? | Typical time |
|-------|--------|-----------|--------------|
| A — Automated | Dev machine | Yes | 2–5 min |
| B — Install | Clean macOS + optional Linux | Yes | 5–15 min |
| C — CLI (non-interactive) | Installed CLI | Yes | 5–10 min |
| D — Interactive terminal | Real TTY (macOS) | Yes | 15–30 min |
| E — Workspace integration | Real workspace + corpus | Yes | 10–20 min |
| F — Linux VM | Fresh Ubuntu VM | Yes for 1.0; recommended always | 30–60 min |
| G — GitHub assets | After publish | Yes | 2 min |

---

## Prerequisites

### Machines

| Target | Why |
|--------|-----|
| **macOS arm64** (primary) | Default user platform; system **bash 3.2** — must pass |
| **macOS amd64** (optional) | Intel Mac regressions |
| **Linux amd64 or arm64 VM** | Cross-platform glibc |

### Shell

- Use **system bash**, not only Homebrew bash: `/bin/bash --version` should show 3.2 on macOS.
- Tests must pass under `set -u` behavior (macOS default bash in installer/CLI).

### Test corpus — TEST-VAULT

**Test corpus path:** set `SPINOSA_TEST_VAULT` to a local corpus directory. The examples below use `/tmp/TEST-VAULT`.

```text
/tmp/TEST-VAULT/
  generic-files/              # pdf, csv, docx — fast MarkItDown/structured gate
  Ex2-harvesting-tasks/       # md, jpg, mp3/mp4, transcriptions — multimodal gate
```

Override with `SPINOSA_TEST_VAULT` (Linux VM: copy the corpus to `/tmp/TEST-VAULT` first; see Phase F).

| Scope | Path under TEST-VAULT | ~Files | Engines exercised |
|-------|----------------------|--------|-------------------|
| `subset` (default gate) | `generic-files/` | 7 | PDF, CSV, DOCX |
| `mixed` | `Ex2-harvesting-tasks/` | ~130 | MD, JPG/OCR, JSON, skips A/V |
| `full` | entire vault | ~144 | All importable types |

**Quick smoke** (2 files, no TEST-VAULT required) — Phase C1 below.

**Automated TEST-VAULT gate** — Phase C2:

```bash
export SPINOSA_NO_UPGRADE_CHECK=1 NO_COLOR=1 RLWRAP_EXEC=1
# Installed CLI with vendor tools (Phase B), or dev tree + SPINOSA_HOME:
# export SPINOSA_HOME=~/.spinosa
bash .bin/test-new-test-vault.sh
```

Optional broader scopes before a major release:

```bash
SPINOSA_TEST_VAULT_SCOPE=mixed bash .bin/test-new-test-vault.sh
SPINOSA_TEST_VAULT_SCOPE=full  bash .bin/test-new-test-vault.sh   # slow (OCR on ~65 JPGs)
```

### Environment flags (automation)

```bash
export SPINOSA_NO_UPGRADE_CHECK=1   # avoid network upgrade prompt during tests
export NO_COLOR=1                   # readable logs
export RLWRAP_EXEC=1                # skip rlwrap re-exec in scripts
```

**Automation rule:** never let `spinosa new` open an LLM CLI (OpenCode, Codex, etc.). Always pass `--launch copy` (or `--cli other --launch copy`) so onboarding only copies the startup prompt — no new terminal window.

---

## Phase A — Automated gate (blocking)

Run from repo root before pushing a release tag:

```bash
cd /path/to/spinosa-main

# Full release gate (typecheck, lint, tests — same as release:validate)
bun run quality

# Or the release entrypoint directly
bun run release:validate
```

**Pass criteria:** every command exits 0; no `FAIL` in output.

**Working tree:** `git status --porcelain` must be empty before publish (see RELEASE_GUIDE).

**Manifest rule:** `workspace-template/.spinosa/workspace-files.tsv` lists only files delivered to user workspaces on install/update. Maintainer scripts (`.bin/test-*.sh`, packaging tools, etc.) live in the git repo only — do not add them to the manifest.

---

## Phase B — Install tests (blocking)

### B1. Clean uninstall (optional baseline)

```bash
spinosa uninstall --yes 2>/dev/null || true
rm -rf ~/.spinosa
rm -f ~/.local/bin/spinosa
```

### B2. Fresh install — piped (matches user docs)

```bash
curl -fsSL https://github.com/medialab/spinosa/releases/download/vX.Y.Z/install.sh | bash
```

Use **published** `install.sh` for the candidate version (or local `bash install.sh` only for pre-publish dev builds).

**Pass criteria:**

| Check | Command / observation |
|-------|----------------------|
| Success banner | `Spinosa installed successfully!` |
| Basic test | `✦ Basic test passed` — **not** a warning |
| Completion stamp | `ls ~/.spinosa/versions/X.Y.Z/.spinosa-install-complete` |
| Metadata | `grep install_complete ~/.spinosa/metadata/install.yaml` |
| Log | `grep "install complete" ~/.spinosa/logs/spinosa.log` |
| Version | `spinosa version` → `spinosa X.Y.Z` |
| Plain CLI | `spinosa` → dashboard, no bash errors |

### B3. Fresh install — non-interactive

```bash
curl -fsSL .../install.sh | bash -s -- --yes --no-launch
```

Same pass criteria as B2. Confirms piped install without TTY prompts.

### B4. Upgrade path (existing install)

With vX.Y.(Z-1) installed:

```bash
curl -fsSL .../releases/latest/download/install.sh | bash
# Answer Y to upgrade, or:
bash install.sh --upgrade --yes
```

**Pass criteria:** ends on success banner; `spinosa version` shows X.Y.Z; no silent mid-install exit.

### B5. Reinstall same version

```bash
bash install.sh --reinstall --yes
```

**Pass criteria:** success; vendor reuse message acceptable; CLI still works.

### B6. Install failure hygiene (regression)

Simulate abort then retry (optional, after a deliberate broken build is fixed):

- Partial `versions/*` without `.spinosa-install-complete` must **not** count as installed on retry.
- Retry should offer **Install** not false **Upgrade** when only a partial dir existed.

---

## Phase C — CLI non-interactive (blocking)

Run with **installed** CLI after Phase B. Reload PATH:

```bash
source ~/.spinosa/env.sh   # or source ~/.zshrc
```

| Command | Invocation | Pass criteria |
|---------|------------|---------------|
| `version` | `spinosa version` | Prints `spinosa X.Y.Z` |
| `help` | `spinosa help` | Exit 0; no library errors |
| `doctor` | `spinosa doctor` | Exit 0 or 1 with **warnings only** — never bash traceback / `unbound variable` |
| `doctor` (workspace) | `spinosa doctor -w "$WORKSPACE"` | Shows CLI vs workspace version; cloud/Hermes advisories OK |
| `upgrade` | `spinosa upgrade --yes` | "Already on latest" when current; or successful upgrade |
| `update` preview | `cd "$WORKSPACE" && spinosa update --dry-run --yes` | Lists changed paths; exit 0 |
| `uninstall` dry | `spinosa uninstall --help` | Help only — do not uninstall during standard gate |

### C1. `spinosa new` — minimal smoke (non-TTY)

**Requires flags** — interactive file-type menu needs a TTY:

```bash
CORPUS=/tmp/spinosa-release-corpus
rm -rf "$CORPUS"
rm -rf "${CORPUS}-spinosa" 2>/dev/null || true
mkdir -p "$CORPUS"
echo "hello" > "$CORPUS/a.txt"
echo "# md" > "$CORPUS/b.md"

spinosa new "$CORPUS" --extensions md,txt --cli other --launch copy --no-color
```

**Pass criteria:**

- Exit 0
- `${CORPUS}-spinosa/.spinosa/workspace` exists
- `framework_version` matches installed CLI version (not `dev` on installed CLI)
- `raw/` contains imported files
- No LLM CLI launched (no `Opened OpenCode` / new terminal) — `--launch copy` is required
- Workspace onboarding completes without `Cannot read from terminal`

### C2. `spinosa new` — TEST-VAULT integration (blocking)

Uses the corpus in `SPINOSA_TEST_VAULT` (default example: `/tmp/TEST-VAULT`).

**Prerequisites:** Phase B install complete; `spinosa doctor` shows MarkItDown + OCR available.

```bash
cd /path/to/spinosa-main
export SPINOSA_NO_UPGRADE_CHECK=1 NO_COLOR=1 RLWRAP_EXEC=1
source ~/.spinosa/env.sh 2>/dev/null || true
export SPINOSA_HOME="${SPINOSA_HOME:-$HOME/.spinosa}"
export PATH="${SPINOSA_HOME}/bin:${HOME}/.local/bin:${PATH}"

# Default: generic-files subset (pdf, csv, docx)
bash .bin/test-new-test-vault.sh
```

**Pass criteria:**

- Script exits 0; prints `test-new-test-vault passed`
- `setup_status: cli_started` in generated workspace
- `raw/` contains at least 3 files for `subset` scope
- No `Opened OpenCode` / LLM terminal launch in log

**Manual / release-candidate scopes** (same script):

| `SPINOSA_TEST_VAULT_SCOPE` | When |
|----------------------------|------|
| `mixed` | Before minor releases — multimodal under `Ex2-harvesting-tasks/` |
| `full` | Before major releases — entire vault incl. all JPG OCR |

**Direct invocation** (equivalent to subset script, for debugging):

```bash
TEST_VAULT="${SPINOSA_TEST_VAULT:-/tmp/TEST-VAULT}"
CORPUS=/tmp/spinosa-test-vault-generic
rm -rf "$CORPUS" "${CORPUS}-spinosa" 2>/dev/null || true
rsync -a --exclude '.DS_Store' --exclude '._*' "${TEST_VAULT}/generic-files/" "$CORPUS/"
spinosa new "$CORPUS" --extensions pdf,csv,docx --cli other --launch copy --no-color
```

---

## Phase D — Interactive terminal (blocking)

Use a **real terminal** (iTerm, Terminal.app, not piped CI). `export SPINOSA_NO_UPGRADE_CHECK=1` optional.

### D1. Dashboard

```bash
spinosa
```

| Step | Action | Pass |
|------|--------|------|
| Menu renders | Arrow keys move selection | No garbled ANSI |
| Quit | Esc or Quit | Clean exit |
| Doctor | Select Doctor → Enter | Runs without crash |
| Help | Select Help | Shows usage |

### D2. `spinosa new` (full interactive)

```bash
spinosa new
```

| Step | Action | Pass |
|------|--------|------|
| Corpus path | Enter path to test corpus | Accepts directory |
| Scan summary | Review batch counts | Numbers sane |
| File-type menu | Space toggles, Enter proceeds | No `Cannot read from terminal` |
| Completion | Workspace ready message | `setup_status` progresses; summary written |

### D3. `spinosa add` (if workspace exists)

```bash
cd /path/to/workspace-spinosa
spinosa add --file /path/to/new-file.txt
```

Pass: file lands in `raw/` or conversion path; no hard crash.

### D4. `spinosa update` (interactive confirm)

```bash
cd /path/to/workspace-spinosa
spinosa update
```

Confirm when prompted (or use `--yes` after preview in Phase C).

Pass: framework files sync; `framework_version` in `.spinosa/workspace` matches CLI.

---

## Phase E — Workspace integration (blocking)

Use at least one **real** long-lived workspace (e.g. ROOTVAULT on Google Drive).

```bash
export WORKSPACE="/path/to/EVOLUTION - ROOTVAULT-spinosa"
spinosa doctor --workspace "$WORKSPACE"
spinosa update --dry-run --yes --workspace "$WORKSPACE"
# After review:
spinosa update --yes --workspace "$WORKSPACE"
```

**Pass criteria:**

| Check | Expected |
|-------|----------|
| Doctor | Warns if workspace behind CLI; no crash on `framework_version: dev` workspaces |
| Dry-run | Shows version range (e.g. `0.7.1 → 0.7.3`) and file count |
| Apply update | `framework_version` bumped in `.spinosa/workspace` |
| Pre-baked agent mirrors | `.hermes/skills/`, `.codex/agents/` present after update |
| Cloud path | Doctor cloud warning acceptable; update completes or documents known Drive limits |

### E1. Hermes (if used)

After update:

```bash
# Merge advisory from doctor
diff ~/.hermes/config.yaml "$WORKSPACE/.hermes/workspace.config.yaml"
```

If the Hermes workspace template changed, verify the doctor advisory still points users at the correct merge step.

---

## Phase F — Linux VM (blocking for 1.0)

See [RELEASE_GUIDE.md](../../../RELEASE_GUIDE.md) § Linux VM testdrive. Summary:

1. `curl | bash` install on Ubuntu 22.04+ (amd64 or arm64)
2. `spinosa version` / `spinosa doctor`
3. Copy TEST-VAULT: `rsync -avz mac-host:/path/to/TEST-VAULT/ /tmp/TEST-VAULT/`
4. Run `SPINOSA_TEST_VAULT=/tmp/TEST-VAULT bash .bin/test-new-test-vault.sh` (subset gate)
5. Optional: `SPINOSA_TEST_VAULT_SCOPE=mixed|full` on VM before major releases
6. Edge matrix: PDF-only, JPG-only, empty dir, unicode filenames — build subsets under `/tmp/TEST-VAULT/`; always pass `--cli other --launch copy`

**Linux-specific:** if PaddleOCR fails import, install `libgl1` and re-run doctor.

---

## Phase G — GitHub release (blocking, post-publish)

The `verify-remote` stage runs automatically at the end of every release (`bun run release`). Confirm manually if needed:

```bash
VERSION="X.Y.Z"
# Immutable version release — three assets
gh release view "v${VERSION}" --json assets \
  | python3 -c "import sys,json; [print(a['name']) for a in json.load(sys.stdin)['assets']]"
# Expected: checksums.txt, install.sh, spinosa-v${VERSION}.tar.gz

# Version-release checksums must list both files
curl -fsSL "https://github.com/medialab/spinosa/releases/download/v${VERSION}/checksums.txt"

# Rolling channel installer
curl -fsSL "https://github.com/medialab/spinosa/releases/download/beta/install.sh" | grep PINNED_VERSION
# Must show PINNED_VERSION="${VERSION}"
```

### G1. Rolling channel smoke test

```bash
curl -fsSL https://github.com/medialab/spinosa/releases/download/beta/install.sh | grep PINNED_VERSION
```

Must show `PINNED_VERSION="X.Y.Z"` for the release you just shipped.

---

## Logging verification

After any install or failed install:

```bash
tail -50 ~/.spinosa/logs/spinosa.log
grep level=ERROR ~/.spinosa/logs/spinosa.log | tail -20
```

| Scenario | Expected log |
|----------|----------------|
| Success | `install complete version=X.Y.Z` |
| Failure | `level=ERROR` with line number; not silent exit |
| CLI | `component=cli` session lines |

---

## Platform gotchas (must not regress)

| Issue | Platform | Test |
|-------|----------|------|
| Chained `local` + `set -u` | macOS bash 3.2 | Fresh `curl \| bash` install |
| Empty `argv` + `set -u` | macOS bash 3.2 | `spinosa` with no args |
| `compare_versions` non-numeric | any | `spinosa doctor` on `framework_version: dev` workspace |
| Completion stamp ordering | install | Basic test passes **during** install |
| Partial `versions/*` | install retry | Incomplete dirs cleaned; no false upgrade prompt |
| Non-TTY `spinosa new` | CI/automation | Use `--extensions` + `--launch copy`; expect menu failure without `--extensions` |
| LLM CLI auto-launch | CI/automation | `--cli opencode` without `--launch copy` opens a terminal — use `--launch copy` in testsuite |
| Piped install PATH | `curl \| bash` | Instructions mention `source ~/.zshrc` |

---

## Sign-off checklist

Copy into `dist/vX.Y.Z/SIGNOFF.md` (or release notes) before promoting stable:

```markdown
## Release vX.Y.Z — test sign-off

- [ ] Tester / date: ________
- [ ] macOS arm64 + system Bash version: ________
- [ ] Linux distro + arch (or N/A with reason): ________
- [ ] Phase A — `bun run quality` passed
- [ ] Phase B — full archive smoke (`bun script/smoke-install.ts --archive …`; release does this by default)
- [ ] Phase C — `spinosa version` / `doctor`
- [ ] Phase D — TUI first frame renders; opens invoking project directory
- [ ] Phase E — upgrade from 1.0.0 workspace (Pilosa agents retired, corpus intact)
- [ ] Phase F — upgrade from latest beta
- [ ] Phase G — GitHub assets: 3 immutable (`install.sh`, tarball, `checksums.txt`) + 2 rolling channel
- [ ] CHANGELOG.md updated
- [ ] No open P0/P1 bugs for this version (triaged / deferred with notes)

Machine(s): ________
```

Publish only via `bun run release …` (not manual `git tag`).

---

## When to block release

**Do not publish** if any of these occur:

- Install exits without success banner or `install complete` log line
- `spinosa` or `spinosa help` throws bash errors on macOS system bash
- `spinosa doctor` crashes (unbound variable, missing library path)
- Basic test fails on fresh install
- `spinosa new --extensions …` fails on small corpus or TEST-VAULT subset (`test-new-test-vault.sh`)
- Published `install.sh` PINNED_VERSION ≠ tagged version
- Any Phase A script fails

Warnings (cloud storage, Hermes merge, workspace behind CLI) are **not** blockers if documented and update path works.

---

## Maintainer quick reference

| Script | Purpose |
|--------|---------|
| `bash -n install.sh` | Installer syntax |
| `bash -n workspace-template/.bin/spinosa` | Launcher syntax |
| `cd packages/tui && bun test test/spinosa` | Spinosa TUI flow coverage |

**Publish command** (only after full sign-off):

```bash
bun run release:stable:patch   # from main after beta→main PR
# or: bun run release:beta:patch
```

Do **not** use bare `git tag` / `git push` for product releases — the orchestrator owns tagging, assets, and channel sync.
