# CLI Reference

The `spinosa` CLI manages workspace creation, validation, and upgrades.

**Maintainers:** pre-release testing lives in the framework repo at `docs/reference/testsuite.md` (not shipped to user workspaces).

## Commands

### `spinosa new`

Create a workspace from your document folder.

- Scans the folder and classifies each file by type
- Copies files into `raw/` using the appropriate conversion engine
- Fills in configuration and context files
- Prints a startup prompt to open the workspace with your LLM tool

During scanning, you'll see a summary of what was found:

```
✓ Source scan complete
├─ 12 text-based files to rename to .md (2.4 MB)
├─ 8 Office/EPUB/HTML files available for MarkItDown conversion (45 MB)
├─ 5 scanned PDFs and images available for OCR (120 MB)
├─ 3 native files to copy unchanged (1.1 MB)
└─ 0 files ignored
```

### `spinosa add`

Add one file or a directory of files to an existing workspace.

- Uses the same classifier and conversion engines as `spinosa new`
- Reads and validates the versioned workspace registry in `~/.spinosa/metadata/workspaces.json` before asking for a path
- Scans configured folders only when you explicitly choose **Find other workspaces**
- Writes `.spinosa/add-summary.md`
- Prints a mapper prompt for updating dictionary, maps, workspace index, and verification

Examples:

```bash
spinosa add --workspace ~/Research/project-spinosa --file ~/Downloads/new-interview.docx
spinosa add --workspace ~/Research/project-spinosa --dir ~/Downloads/new-batch
```

### `spinosa upgrade`

Upgrade the **globally installed CLI** to the latest release on a channel. Downloads and verifies checksums automatically.

| Config | Resolves to |
| ------ | ----------- |
| `beta: false` | Rolling GitHub `stable` release |
| `beta: true` | Rolling GitHub `beta` prerelease |

```bash
spinosa upgrade --yes                    # latest on configured channel
spinosa upgrade --channel beta --yes     # beta latest (saves preference)
spinosa upgrade 0.8.0-beta.1 --yes       # pin a specific version
spinosa upgrade --check                  # check only — no install
```

Stable install URL: `https://github.com/medialab/spinosa/releases/download/stable/install.sh`
Beta install URL: `https://github.com/medialab/spinosa/releases/download/beta/install.sh`
Exact install URL: `https://github.com/medialab/spinosa/releases/download/vX.Y.Z/install.sh`

Set the channel for channel-less upgrade tooling in `~/.spinosa/metadata/config.yaml`: `beta: true` tracks beta prereleases, `beta: false` tracks stable releases. `SPINOSA_RELEASE_CHANNEL=beta|stable` remains an environment override. Set `auto_upgrade: false` to disable launch-time upgrade checks.

This updates `~/.spinosa/` (framework runtime). It does **not** update files inside your workspace folders.

After upgrading, Spinosa offers to run `spinosa update` on registered workspaces. Accept that step unless you intentionally keep an older workspace framework.

### `spinosa update`

Sync **workspace framework files** to match the installed CLI version.

- Overwrites release-managed workspace files from the installed framework
- Preserves user-state paths such as `raw/`, `system/context.md`, `system/dictionary.md`, and `.spinosa/memory/orchestrator-notes.md`
- Removes retired or no-longer-managed framework files recorded in the workspace manifest
- Keeps pre-baked vendor mirrors current from `workspace-template/` (`.opencode/`, `.claude/`, `.codex/`, `.hermes/skills/`, etc.)
- Blocked if installed CLI is **older** than the workspace declares — run `spinosa upgrade` first

Examples:

```bash
spinosa update --yes                     # current directory workspace
spinosa update --yes ~/path/to/workspace-spinosa
spinosa update --dry-run                 # preview changes
spinosa update --force --yes             # compatibility flag; same behavior
```

**Hermes users:** after update, merge `.hermes/workspace.config.yaml` into `~/.hermes/config.yaml` (see [Integrations](#integrations) below).

### `spinosa doctor`

Read-only health check: CLI version, workspace skew, document tools, cloud-storage paths, Hermes config drift.

```bash
spinosa doctor
spinosa doctor --workspace ~/path/to/workspace-spinosa
```

Exits with code `1` if any critical issue is found (version skew, missing tools).

### `spinosa uninstall`

Remove Spinosa runtime files from the system. Your workspace folders stay in place, and `~/.spinosa/metadata/` is kept so future reinstalls can reuse workspace registry and configuration metadata.

```bash
spinosa uninstall         # interactive y/N confirmation
spinosa uninstall --yes   # non-interactive confirmation
```

Interactive prompts read from the controlling terminal even when Spinosa is launched through a Bun or shell wrapper. If no terminal is available, use `--yes` explicitly.

### `spinosa startup-autoclean`

Remove abandoned installer staging and backup directories under `~/.spinosa/versions/`, including their stale `node_modules` trees. It never removes completed releases, so workspaces that still link to an older framework remain runnable.

```bash
spinosa startup-autoclean             # remove safe stale installer data
spinosa startup-autoclean --dry-run   # show what would be removed
```

The command exits without changing files while a Spinosa install is active. `spinosa autoclean` is an alias.

### `spinosa help`

Show the help message.

## Upgrade lifecycle

Spinosa has **three layers**. Use the right command for each:

| Layer | Command | What changes |
|-------|---------|--------------|
| Global CLI | `spinosa upgrade` | `~/.spinosa/versions/`, `~/.spinosa/bin/spinosa` |
| Workspace framework | `spinosa update` | `AGENTS.md`, `.agents/`, `.bin/`, `docs/`, maps templates, etc. |
| Vendor integration | automatic on `update` + manual Hermes merge | `.opencode/`, `.claude/`, `.codex/`, `.hermes/skills/`; merge `workspace.config.yaml` → `~/.hermes/config.yaml` |

### Launch-time upgrade check

Running `spinosa` with no arguments (or `bun run dev`) triggers a **preflight** upgrade check before the TUI opens:

```
checking for updates...
no updates available
launching TUI...
```

If a newer version is available, you are prompted to upgrade instead of seeing `no updates available`.

1. Spinosa compares your installed version against the release channel (`beta: true|false` in `~/.spinosa/metadata/config.yaml`).
2. If a newer version is available, you are prompted to upgrade (`[Y/n]`).
3. On accept, Spinosa installs the update, optionally updates registered workspaces, then re-launches automatically.
4. If you are already up to date, the lines above appear and the TUI starts.

`bun run dev` uses the same kernel launch path as `spinosa`, so pre-release testing exercises the same upgrade flow against the version in root `package.json`.

The TUI itself does not download or install upgrades. Disable launch checks with `auto_upgrade: false` in config or `SPINOSA_NO_UPGRADE_CHECK=1`.

Typical flow after a new release:

```bash
spinosa upgrade          # 1. CLI
spinosa update --yes     # 2. each workspace (or accept the post-upgrade prompt)
# 3. Hermes: merge .hermes/workspace.config.yaml into ~/.hermes/config.yaml
spinosa doctor           # 4. verify
```

Run `spinosa doctor` anytime to see whether CLI and workspace versions match.

## Integrations

Spinosa does **not** upgrade OpenCode, Hermes, Codex, or Claude Code for you. It regenerates **project-local** config from `.agents/` when you run `spinosa update`.

| Tool | Spinosa manages | You manage |
|------|-----------------|------------|
| **OpenCode** | `.opencode/agents/`, `.opencode/skills/` (generated) | OpenCode CLI install & version |
| **Hermes** | `.hermes/skills/`, `.hermes/workspace.config.yaml` (generated) | Merge into `~/.hermes/config.yaml`; Hermes CLI version |
| **Codex / Claude** | `.codex/`, `.claude/` mirrors (generated) | Vendor CLI install & version |

Workspaces on **Google Drive, Dropbox, or OneDrive** may time out during `spinosa update`. Open the folder locally, wait for sync, then retry.

## How files are classified

During `spinosa new` and source intake, each file is classified and routed to the right engine:

| Category | File types | What happens |
|---|---|---|
| **Markdown-convertible** | txt, rtf, wiki files, yaml, toml, css, js, py, rb, sh, log, tex, bib, org, adoc, rst | Renamed to `.md` (no conversion needed) |
| **MarkItDown / structured fallback** | docx, xlsx, xls, epub, html, msg, zip, csv, json, xml, wav, mp3, m4a, text-based PDF | Converted to `.md`; csv/json/xml use a built-in fallback if MarkItDown is unavailable. Page-marked Markdown output is split into `raw/<source>/page-001.md` files. PowerPoint (`.pptx`) is unsupported by markitdown-ts and is reported as unsupported. |
| **OCR** | scanned PDF, jpg, png, gif, webp, heic, tif, bmp, svg | OCR-processed to `.md`; multi-page PDFs are split into one Markdown file per page under a raw subfolder. |
| **Native** | md | Copied unchanged |
| **Skipped by default** | mp4, mov, avi, mkv (video), aac, flac, ogg, opus, aiff, and other audio/video not selected for import | Reported in onboarding summary unless explicitly selected |
| **Unsupported** | unknown extensions | Reported as unsupported unless a route is added |
| **Ignored** | AGENTS.md, .DS_Store, ._*, node_modules, .git, macOS privacy-sensitive system paths | Skipped entirely |

## PDF classification

PDFs are automatically classified as text-based (routed to MarkItDown) or image-based (routed to OCR):

1. Encrypted PDFs → OCR
2. PDFs with embedded fonts → MarkItDown
3. PDFs with no extractable text → OCR
4. Fallback: `pdftotext` check (if available) → MarkItDown if it returns text

## Environment variables

| Variable | Purpose |
|---|---|
| `NO_COLOR=1` | Disable ANSI colors in output |
| `SPINOSA_HOME` | Override the installation directory (default: `~/.spinosa`) |
| `SPINOSA_BIN_DIR` | Override the shim directory on PATH (default: `~/.local/bin`) |
| `SPINOSA_NO_UPGRADE_CHECK=1` | Skip launch-time upgrade checks |
| `SPINOSA_WORKSPACE` | Optional initial workspace for `spinosa mcp-server` |

## External agents (`spinosa mcp-server`)

Host agents (Claude, Codex, Cursor) can use Spinosa without a nested Spinosa model:

1. Create a workspace with `spinosa new … --launch copy --json`.
2. Attach MCP: `{ "command": "spinosa", "args": ["mcp-server"] }` (starts unbound).
3. Call `workspace_list` → `workspace_use` → tools (`spinosa_gate`, `spinosa_verify`, `spinosa_figure`, `spinosa_map`) and skills.

Full contract: framework repo `docs/agents/external-agent-spinosa.md`.
