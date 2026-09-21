# Agents & Pipeline

Spinosa uses specialized AI agents to answer your questions. Each agent handles one part of the workflow. The orchestrator decides which agents to run based on your question.

## The agents

| Agent | Job | When it runs |
|-------|-----|-------------|
| **Searcher** | Finds relevant passages in your documents | Every research question |
| **Analyst** | Adds context and flags missing angles | Alongside Searcher |
| **Serendippo** | Looks for non-obvious cross-document links | After core evidence work |
| **Writer** | Turns evidence into a readable report | After search is complete |
| **Verifier** | Checks claims and quotes against the source | After writing |
| **Mapper** | Builds navigation maps during startup | Setup and re-indexing |
| **Janitor** | Audits workspace hygiene | On request |

## Typical pipelines

The orchestrator doesn't run the same chain every time. It picks the shortest path that answers your question.

| Question type | Typical sequence |
|--------------|-----------------|
| "What files do I have?" | Fast path, no report |
| "Find documents about X" | Searcher → Verifier |
| "What does the corpus say about X?" | Searcher + Analyst → Serendippo → Writer → Verifier |
| "Compare A and B" | Searcher × multiple + Analyst → Serendippo → Writer → Verifier |
| "Is this quote accurate?" | Verifier only |
| "Re-index the workspace" | Mapper → Verifier |

Searcher and Analyst can run in parallel. Writer waits for their outputs. Verifier is always last.

## How agents coordinate

Agents communicate through files on disk, not hidden memory. This makes their work inspectable.

```text
Searcher output + Analyst output
                ↓
             Writer draft
                ↓
          Verifier review
                ↓
         Final report status
```

Intermediate files can be cleaned up later. Final reports stay in `agent_reports/`.

## Related

- [Reports](/spinosa/docs/reports) — how to read the output
- [Workspace](/spinosa/docs/workspace) — where files live on disk
- [CLI Reference](/spinosa/docs/cli-reference) — commands for prepare, check, sync
- [MCP for agents](/spinosa/docs/mcp) — use Spinosa from Claude, Codex, or Cursor without a nested Spinosa model
