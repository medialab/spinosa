# External agents: workspace CLI + Spinosa MCP

Use Spinosa without nesting a Spinosa model. You (Claude, Codex, Cursor, …) stay the LLM. The Spinosa CLI creates and maintains workspaces. The Spinosa MCP server exposes mechanism tools and skill playbooks against a workspace you choose.

## Roles

| Piece | Responsibility |
| ----- | -------------- |
| Host agent | Reasoning, reading/writing files, following skill playbooks |
| `spinosa` CLI | Create/import/update workspaces; machine-readable progress with `--json` |
| `spinosa mcp-server` | List/select workspaces; gate, verify, figure, map; skill resources |

Do **not** use `spinosa serve` for this path. That starts Spinosa’s own session stack and models.

## Host config

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

Optional initial bind only:

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

`SPINOSA_WORKSPACE` or a cwd that already is a Spinosa workspace also pre-selects. Otherwise the server starts **unbound**.

## Agent workflow

1. **Create or import** (CLI, once per corpus):

   ```bash
   spinosa new /path/to/docs --extensions md,pdf --cli other --launch copy --json
   ```

   Progress lines are NDJSON on stderr. The final result is one JSON object on stdout (`command`, `workspacePath`, …).

2. **Bind** (MCP):

   - `workspace_list` — registered workspaces on this machine
   - `workspace_use` with `{ "path": "…" }` — bind the MCP session
   - `workspace_info` / `workspace_clear` — inspect or unbind

3. **Operate** (MCP + your filesystem tools):

- `workspace_list` / `workspace_use` / `workspace_info` / `workspace_clear` / `workspace_delete`
- `list_skills` / `read_skill` — or MCP resources `spinosa://skill/…`
- Read `raw/`; write durable artifacts under `agent_reports/`
- `spinosa_gate` — evidence coverage counts (not LLM judgment)
- `spinosa_verify` — artifact **shape** (not quote-level truth)
- `spinosa_figure` — markdown chart blocks for reports
- `spinosa_map` — extraction/map helpers (`begin`, `write_extraction`, …)

`workspace_delete` requires `confirm: true`. Present folders go to the OS trash; missing/invalid paths only leave the registry. Same action: `spinosa delete <path> --yes`.

Every mechanism tool accepts optional `workspacePath` for a one-shot override without changing the session bind.

## CLI output contract (agents)

Global flags: `--json`, `--quiet`.

| Mode | Progress | Result |
| ---- | -------- | ------ |
| `--json` | NDJSON `{type,phase,message,…}` on **stderr** | One JSON object on **stdout** |
| `--quiet` | Silent | Silent success; errors still on stderr |
| default | Human lines on stdout | Human summary on stdout |

`spinosa new` defaults to `--launch copy` so headless runs never require a TTY or open an LLM CLI.

## What this MCP does not do

- No bash/edit/task tools (use the host agent’s tools)
- No “run Spinosa agent” / provider turn
- No replacement for quote-level verification — that remains your reading + the verifier skill playbook

## Published docs

User-facing guide on the website: [MCP for agents](https://spinosa.medialab.sciencespo.fr/spinosa/docs/mcp) (source: `website/src/lib/docs/content/reference/mcp.md`).
