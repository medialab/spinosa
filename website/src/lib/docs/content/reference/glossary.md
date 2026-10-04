# Glossary

## Core terms

| Term          | Meaning                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| **Corpus**    | The document collection imported into a workspace.                                                          |
| **Workspace** | The folder containing source copies, context, guidance, and reports.                                        |
| **Workflow**  | The steps selected for a request that needs research or other structured work.                              |
| **Agent**     | A specialized role, such as Searcher, Analyst, Writer, or Verifier. The runtime decides which roles to use. |
| **Provider**  | A local or cloud service that supplies the AI model used by Spinosa.                                        |
| **MCP**       | Model Context Protocol — a way for external agents such as Claude or Codex to use Spinosa tools.            |

## TUI terms

| Term                | Meaning                                                              |
| ------------------- | -------------------------------------------------------------------- |
| **TUI**             | Terminal user interface — the interactive app launched by `spinosa`. |
| **Session**         | A conversation and its tool activity inside a workspace.             |
| **Command palette** | The action menu opened with `Ctrl+P`.                                |

## Workspace terms

| Term                 | Meaning                                                       |
| -------------------- | ------------------------------------------------------------- |
| **`raw/`**           | Imported source copies and extracted text used for research.  |
| **`maps/`**          | Navigation maps that help search the corpus.                  |
| **`system/`**        | Shared workspace settings and context.                        |
| **`agent_reports/`** | Durable reports and workflow outputs.                         |
| **`.spinosa/`**      | Spinosa-native agents, runtime state, and workspace metadata. |
| **`.agents/`**       | Portable agent guidance, skills, and references.              |

## Report and conversion terms

| Term                    | Meaning                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Evidence**            | A source passage and location used to support a claim.                                                                                                                    |
| **Verification status** | A summary of the source checks completed for a report. See [Reports](/docs/reports).                                                                                      |
| **OCR**                 | Optical character recognition. Spinosa does not bundle a local OCR engine; a vision-capable model can transcribe scans, or Spinosa can keep them without text extraction. |
| **MarkItDown**          | A converter used for supported document formats.                                                                                                                          |

## Related

- [Workspace Structure](/docs/workspace) — file layout
- [Agents and Workflows](/docs/agents) — roles and routing
- [Reports](/docs/reports) — evidence and status meanings
- [MCP for agents](/docs/mcp) — tools for external agents
- [FAQ](/docs/faq) — troubleshooting
