# MCP for external agents

Use Spinosa from Claude, Codex, Cursor, or any MCP host **without** running Spinosa’s own chat model. You stay the reasoning engine. Spinosa provides workspace tools, skill playbooks, and deterministic checks.

## How the pieces fit

| Piece | Role |
|-------|------|
| **Host agent** | Reads and writes files, follows skill playbooks, answers the question |
| **`spinosa` CLI** | Creates and updates workspaces (`new`, `add`, `delete`, …) |
| **`spinosa mcp-server`** | Lists and selects workspaces; exposes gate, verify, figure, map, and skills |

Do not use `spinosa serve` for this path. That starts Spinosa’s session stack and models.

## Install in your MCP host

Add Spinosa to your host’s MCP config (Cursor example: `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "spinosa": {
      "command": "spinosa",
      "args": ["mcp-server"]
    }
  }
}
```

Optional: pre-select a workspace at startup:

```json
{
  "mcpServers": {
    "spinosa": {
      "command": "spinosa",
      "args": ["mcp-server", "--workspace", "/path/to/workspace"]
    }
  }
}
```

You can also set `SPINOSA_WORKSPACE`, or run the server from inside a Spinosa workspace directory. Otherwise the server starts **unbound**.

## Typical workflow

### 1. Create a workspace (CLI)

```bash
spinosa new /path/to/docs --extensions md,pdf --cli other --launch copy --json
```

`--launch copy` is the default and is safe for headless agents (no TTY, no nested LLM CLI). With `--json`, progress is NDJSON on stderr and the final result is one JSON object on stdout.

### 2. Bind a workspace (MCP)

1. Call `workspace_list` to see registered workspaces on this machine.
2. Call `workspace_use` with `{ "path": "…" }` to bind the session.
3. Optionally call `workspace_info` or `workspace_clear`.

### 3. Research (host tools + MCP)

- Read skill playbooks with `list_skills` / `read_skill`, or MCP resources under `spinosa://skill/…`.
- Search and read `raw/` with your host’s filesystem tools.
- Write durable artifacts under `agent_reports/`.
- Call mechanism tools when needed (see below).

## Tools

### Workspace

| Tool | Purpose |
|------|---------|
| `workspace_list` | List registered workspaces |
| `workspace_use` | Bind this MCP session to a workspace path |
| `workspace_info` | Show the current bind |
| `workspace_clear` | Unbind |
| `workspace_delete` | Trash a present folder (or unregister a missing path). Requires `confirm: true` |

Same delete action from the CLI: `spinosa delete <path> --yes`.

### Skills

| Tool | Purpose |
|------|---------|
| `list_skills` | List skill playbooks in the bound workspace |
| `read_skill` | Return a `SKILL.md` body |

### Mechanisms

| Tool | Purpose |
|------|---------|
| `spinosa_gate` | Evidence coverage counts (deterministic, not an LLM judgment) |
| `spinosa_verify` | Artifact **shape** checks (not quote-level truth against sources) |
| `spinosa_figure` | Markdown chart blocks for reports |
| `spinosa_map` | Extraction / map helpers (`begin`, `write_extraction`, …) |

Every mechanism tool accepts an optional `workspacePath` for a one-shot override without changing the session bind.

## Data flow

```text
Host agent (you)
    │
    ├─ MCP: workspace_list / workspace_use
    ├─ MCP: read_skill (searcher, writer, verifier, …)
    ├─ Host filesystem: grep / read raw/, maps/, system/
    ├─ Host filesystem: write agent_reports/
    └─ MCP: spinosa_gate / spinosa_verify / spinosa_figure / spinosa_map
```

MCP does **not** search the corpus for you. Content search stays with the host agent, guided by Spinosa skill playbooks.

## What this MCP does not do

- No bash, edit, or task tools (use the host’s tools)
- No “run a Spinosa agent” turn or provider call
- No quote-level verification — that remains your reading plus the verifier skill

## CLI flags agents care about

| Flag | Effect |
|------|--------|
| `--json` | Progress as NDJSON on stderr; final result as JSON on stdout |
| `--quiet` | Suppress normal output; errors still on stderr |

## Related

- [CLI Reference](/spinosa/docs/cli-reference) — `new`, `delete`, `list`, and other commands
- [Agents & Pipeline](/spinosa/docs/agents) — how Spinosa’s own TUI agents work
- [Workspace Structure](/spinosa/docs/workspace) — `raw/`, `maps/`, `agent_reports/`
