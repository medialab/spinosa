# CLI Reference

The `spinosa` CLI manages workspaces, conversion, maintenance, and upgrades.

## Getting help

```bash
spinosa          # Launch the TUI dashboard (main way to use Spinosa)
spinosa help     # Show help text
spinosa version  # Show installed version
spinosa doctor   # Full diagnostic of system health
```

## Workspace management

### spinosa create <source>

Create a workspace from a document folder.

```bash
spinosa create ~/research/papers
```

This scans the folder, classifies files by type, copies them into the workspace, and registers it. After creation, run `spinosa` to open the TUI and start a chat.

Flags: `--name`, `--extensions`, `--cli`, `--launch`

### spinosa add <source>

Add more files to an existing workspace.

```bash
spinosa add ~/research/more-papers --workspace my-papers-spinosa
```

Files are converted and added to the workspace's `raw/` directory.

Flags: `--workspace`, `--file`, `--dir`, `--extensions`

### spinosa list

List all registered workspaces.

```bash
spinosa list
spinosa list --json    # Machine-readable output
```

### spinosa delete <path>

Trash a present Spinosa workspace (or unregister a missing path). Requires `--yes`.

```bash
spinosa delete ~/research/old-workspace-spinosa --yes
spinosa delete ~/research/old-workspace-spinosa --yes --json
```

### spinosa status [workspace]

Check workspace health.

```bash
spinosa status
spinosa status my-papers-spinosa
```

Reports framework version, workspace status, and document tool availability.

## External agents (MCP)

### spinosa mcp-server

MCP stdio server for Claude, Codex, Cursor, and other hosts. Starts unbound. Agents call `workspace_list` / `workspace_use`, then Spinosa tools and skills. The host model stays the LLM.

```bash
spinosa mcp-server
spinosa mcp-server --workspace /path/to/workspace
```

Full guide: [MCP for agents](/spinosa/docs/mcp).

Global agent-friendly flags on workspace commands: `--json`, `--quiet`.

## Updates

### spinosa update [workspace]

Update framework template files in a workspace. Preserves your data.

```bash
spinosa update my-papers-spinosa
spinosa update --dry-run   # Preview without making changes
spinosa update --force     # Override user modifications
```

### spinosa upgrade

Upgrade the globally installed Spinosa CLI. Downloads the installer, verifies checksums, and optionally updates registered workspaces.

```bash
spinosa upgrade                    # Latest on your configured channel
spinosa upgrade --channel beta     # Beta channel (also saves preference to config)
spinosa upgrade 1.0.0              # Specific version
spinosa upgrade --check            # Check only — no install
spinosa upgrade --yes              # Skip confirmation prompts
```

Channel preference is stored in `~/.spinosa/metadata/config.yaml` as `beta: true|false`. Disable automatic launch-time checks with `auto_upgrade: false` in the same file, or `SPINOSA_NO_UPGRADE_CHECK=1`.

When you run `spinosa` with no arguments, Spinosa checks for upgrades **before** opening the TUI:

```
checking for updates...
no updates available
launching TUI...
```

If a newer version is available, you are prompted to upgrade instead of seeing `no updates available`.

## Maintenance

### spinosa startup-autoclean

Clean stale installer files from previous upgrade attempts.

```bash
spinosa startup-autoclean
spinosa startup-autoclean --dry-run
```

### spinosa uninstall

Remove Spinosa from your system. Workspace folders stay in place.

```bash
spinosa uninstall --yes
```

## File classification

During `spinosa create` and `spinosa add`, files are classified automatically:

| Category | File types | What happens |
|----------|-----------|-------------|
| Text-based | txt, rtf, yaml, toml, css, js, py, md, etc. | Renamed to `.md` |
| MarkItDown | docx, xlsx, epub, html, text PDF | Converted to markdown (PowerPoint / `.pptx` not supported by markitdown-ts) |
| OCR | scanned PDF, jpg, png, webp, heic | OCR-processed to markdown |
| Native | csv, json, xml | Copied unchanged |
| Skipped | video, audio | Left at source |
| Ignored | AGENTS.md, .DS_Store, node_modules, .git | Skipped |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `SPINOSA_HOME` | Override install directory (default: `~/.spinosa`) |
| `SPINOSA_NO_UPGRADE_CHECK=1` | Skip launch-time and background upgrade checks |
| `SPINOSA_WORKSPACE` | Optional initial workspace for `spinosa mcp-server` |
| `NO_COLOR=1` | Disable ANSI colors |

## Common tasks

| Task | Command |
|------|---------|
| Launch TUI | `spinosa` |
| Create workspace | `spinosa create <folder>` |
| Add files | `spinosa add <folder>` |
| Update workspace templates | `spinosa update <workspace>` |
| Upgrade CLI | `spinosa upgrade` |
| List workspaces | `spinosa list` |
| Delete workspace | `spinosa delete <path> --yes` |
| MCP for host agents | `spinosa mcp-server` |
| Check health | `spinosa doctor` |
| Uninstall | `spinosa uninstall --yes` |
