# Workspace Structure

A workspace is a folder containing imported source copies, research context, agent guidance, and generated reports. Spinosa leaves the folder you imported from in place.

```text
workspace/
  raw/             Imported source copies and extracted text
  maps/            Navigation maps for searching the corpus
  system/          Workspace configuration and shared context
  agent_reports/   Durable reports and workflow outputs
  .agents/         Portable agent guidance, skills, and references
  .spinosa/        Native agents, run state, memory, and workspace marker
  .logs/           Workspace logs
```

## Common files and folders

- **`raw/`** is the source corpus used for research. Do not rewrite source-file bodies; add new material with `spinosa add`.
- **`maps/`** helps the search workflow navigate a large corpus.
- **`system/configuration.md`** and **`system/context.md`** hold workspace settings and researcher-provided context.
- **`agent_reports/`** holds durable reports and other workflow outputs.
- **`.agents/`** contains portable skills and shared guidance. **`.spinosa/`** contains Spinosa's native agent definitions and runtime state.

Add more documents with:

```bash
spinosa add ~/research/new-files --workspace /path/to/workspace
```

Use `spinosa list` to see registered workspaces and `spinosa status /path/to/workspace` to inspect one.

See [Agents and Workflows](/docs/agents) for how files are used and [Reports](/docs/reports) for where results appear.
