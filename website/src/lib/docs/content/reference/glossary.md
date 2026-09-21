# Glossary

## Core terms

| Term | Meaning |
|------|---------|
| **Corpus** | Your collection of source documents (PDFs, transcripts, notes, images) |
| **Workspace** | The folder Spinosa creates from your corpus, with `raw/`, `maps/`, `system/`, `agent_reports/` |
| **Orchestrator** | The coordinator that decides which agents to run for your question |
| **Pipeline** | The sequence of agent steps used to answer a request |
| **Sub-agent** | A specialized helper (Searcher, Analyst, Writer, Verifier, etc.) |
| **MCP** | Model Context Protocol — how external agents (Claude, Codex, Cursor) load Spinosa tools without a nested Spinosa model |

## TUI terms

| Term | Meaning |
|------|---------|
| **TUI** | Terminal User Interface — the dashboard launched by `spinosa` |
| **Home** | Main screen with recent workspaces, chat prompt, and boot health |
| **Workspace picker** | Dialog showing all registered workspaces, press `W` to open |
| **Onboarding wizard** | Step-by-step flow to create a workspace from documents |
| **Visualizer** | Tool for exploring conversation flow, file access, and activity |
| **Command palette** | Quick command menu, press `Ctrl+P` or `/` |

## Workspace terms

| Term | Meaning |
|------|---------|
| **raw/** | Converted source documents, the evidence layer agents search and cite |
| **maps/** | Navigation maps for finding relevant files and themes |
| **system/** | Settings and index files (configuration, context, dictionary, index) |
| **Dictionary** | Vocabulary extracted from the corpus: names, places, concepts |
| **agent_reports/** | Reports produced by agents (answers, startup reports) |
| **YAML header** | Metadata block at the top of each `raw/` file describing its source |

## Report terms

| Term | Meaning |
|------|---------|
| **Verification status** | Result after source checking: pending, verified, corrected, or failed |
| **Evidence** | Quoted passages with source paths and confidence labels |
| **Confidence level** | How directly a passage supports a point (high, medium, low) |

## Conversion terms

| Term | Meaning |
|------|---------|
| **OCR** | Optical Character Recognition — turning scanned images into searchable text |
| **MarkItDown** | Converter for Office docs, EPUB, HTML, and text-based PDFs |

## Related

- [Workspace Structure](/spinosa/docs/workspace) — file layout
- [Agents](/spinosa/docs/agents) — agent names and responsibilities
- [Reports](/spinosa/docs/reports) — report anatomy and statuses
- [MCP for agents](/spinosa/docs/mcp) — external-agent tools over MCP
- [FAQ](/spinosa/docs/faq) — troubleshooting
