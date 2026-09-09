# Agents & Pipeline

Spinosa routes every prompt through one of two paths:
- `fast_path` for direct operational answers
- `non-fast-path` for orchestrated artifact-based work

The orchestrator maintains `.spinosa/memory/orchestrator-notes.md` as its working memory — session summaries, blockers, and context that persist across routes.

For every `non-fast-path` request, the orchestrator writes a goal artifact first, then dispatches agents sequentially file-to-file. The chain is adaptive — each step picks the next agent based on what arrived. The route always terminates with verifier + evaluator.

## The agents at a glance

| Agent | Job | When it runs |
|---|---|---|
| **Mapper** | Builds navigation maps during initial setup | Startup only |
| **Searcher** | Finds relevant passages in your documents | In non-fast-path chains that need evidence |
| **Analyst** | Adds broader context and alternative angles | When the chain explicitly includes it |
| **Serendippo** | Finds hidden connections across documents | When the chain explicitly includes it |
| **Writer** | Composes a user-facing answer report | Only when the chain needs a report |
| **Verifier** | Checks substantive claims against original files | End of every route with claims, citations, or quotes |
| **Janitor** | Audits workspace health and cleans stale files | On cleanup routes |
| **Evaluator** | Audits the completed non-fast-path route | After verifier, always |
| **Evolver** | Applies tightly scoped framework follow-up edits | Only when the Evaluator recommends an edit |
| **Overseer** | Audits session history and corpus coverage | Every 5 routes or on user request |

## Routing model

Not every question uses agents. The orchestrator uses a two-way split:

| Route | What happens |
|---|---|
| `fast_path` | The question is answered directly without a goal artifact or sub-agent chain |
| `non-fast-path` | The orchestrator writes a goal artifact, then dispatches agents sequentially, adapting the chain as it goes |

## Typical non-fast-path shapes

The chain is chosen per request and adapted after each step.

| Request shape | Typical chain |
|---|---|
| Evidence-grounded answer | Goal Artifact → Searcher → Writer → Verifier → Evaluator |
| Evidence-grounded answer with broader context | Goal Artifact → Searcher → Analyst → Writer → Verifier → Evaluator |
| Hidden-connection exploration | Goal Artifact → Searcher → Analyst → Serendippo → Writer → Verifier → Evaluator |
| Re-indexing or extraction maintenance | Goal Artifact → Mapper → Searcher → Writer → Verifier → Evaluator |
| Cleanup audit | Goal Artifact → Janitor → Verifier → Evaluator |

## What each agent does

### Searcher

The Searcher is the evidence hunter. It:
1. Checks the dictionary for the right search terms
2. Reads navigation maps to find which files are relevant
3. Searches your document folder for matching passages
4. Writes an evidence packet with quotes, file paths, and confidence levels

**What it produces:** `agent_reports/evidence_packet_{session_id}.md` — a file with evidence quotes organized by source.

### Analyst

The Analyst does not search files directly. It:
1. Reads your project context and the dictionary
2. Reads any earlier artifacts the chain produced
3. Suggests broader themes, missing angles, and alternative framings
4. Flags what a search-only approach might miss

**What it produces:** A contextual analysis packet that later steps read by file path.

### Serendippo

The Serendippo agent roams freely through your documents looking for unexpected connections:
- A concept that appears differently across document groups
- A participant whose perspective changes over time
- Similar responses from different groups on the same topic
- Ideas expressed differently in different languages

**What it produces:** A serendipity report with discovered connections and proposed map updates.

### Writer

The Writer creates a user-facing answer report when the chain calls for one. It:
1. Reads the prior artifacts named in the goal file
2. Incorporates evidence and any broader context
3. Numbers the report sequentially (`00_first-report.md`, `01_followup.md`)
4. Adds a navigation dashboard showing how the answer was built

**What it produces:** A numbered report in `agent_reports/` with Answer, Evidence, Analysis, Limitations, and Sources sections.

### Verifier

The Verifier is the quality gate. It runs at the end of every route that produces claims, citations, or quotes. It:
1. Reads the substantive artifact that needs checking
2. For each claim, finds the original source file when source grounding is required
3. Compares the quote or claim against the original text
4. Marks each claim: verified, corrected, unsupported, contradicted, or unresolved
5. Updates the artifact status when a status block exists

**What it produces:** The same artifact with updated verification state — usually `✓ verified`, `⚠ corrections`, or `✗ failed`.

### Artifact pattern reference

| Pattern | Produced By | Description |
|---|---|---|
| `agent_reports/g_{session_id}.md` | Orchestrator | Goal artifact for a non-fast-path route |
| `agent_reports/evidence_packet_{session_id}.md` | Searcher | Evidence packet for the route |
| `agent_reports/analysis_{session_id}.md` | Analyst | Contextual analysis packet |
| `agent_reports/serendipity_{session_id}.md` | Serendippo | Hidden-connections report |
| Terminal `NN_*.md` | Verifier | In-place verification (`status`, corrections on report) |
| `agent_reports/e_{session_id}.md` | Evaluator | Route audit report |
| `agent_reports/c_{session_id}.md` | Overseer | Coverage report with Orchestrator Advisories |

### Mapper

The Mapper runs during initial setup (startup). It:
1. Reads files in batches of 20-25
2. Extracts a summary, key passages, concept signals, and connections for each
3. Writes navigation maps: a structural overview, per-group maps, and cross-cutting theme maps

**What it produces:** Maps in the `maps/` folder and extraction packets in `agent_reports/`.

### Janitor

The Janitor audits workspace health:
1. Scans for stale files and broken links
2. Proposes cleanup moves to `.trash/`
3. Writes a cleanup artifact
4. Presents a report you must confirm before any file is moved

**What it produces:** A hygiene report with a health score gauge and proposed moves.

### Evaluator

The Evaluator runs after every non-fast-path route finishes the main chain. It:
1. Reads the original prompt, goal artifact, chain, and produced files
2. Audits the route as a process
3. Decides whether the framework needs a tightly scoped follow-up edit

**What it produces:** A route audit report with either `no_edit` or `edit_recommended`.

### Evolver

The Evolver runs only when the Evaluator recommends an edit. It:
1. Reads the audit report
2. Applies the smallest safe control-file or behavior-doc change
3. Leaves the current answer unchanged and affects only future requests

**What it produces:** A narrowly scoped evolution report and any justified framework edits.

### Overseer

The Overseer audits session history and corpus coverage after every 5 non-fast-path routes, or on user request. It:

| Field | Value |
|---|---|
| **Role** | Coverage audit |
| **Scope** | `coverage_audit` |
| **Produces** | `agent_reports/c_{session_id}.md` with `## Orchestrator Advisories` block |
| **Inputs** | `.spinosa/memory/orchestrator-notes.md`, `maps/`, `system/dictionary.md`, `system/configuration.md` |
| **Run trigger** | Every 5 non-fast-path routes, or on user request |
| **Summary** | Audits session history, corpus coverage, and agent utilization; generates adversarial swarm probes for uncovered areas; returns routing advisories to the orchestrator |

## How agents hand off work

Agents don't pass content to each other directly. On non-fast-path routes, the orchestrator writes the goal artifact first, then agents write files and pass file paths:

```
Orchestrator writes goal artifact
          │
          ▼
Sub-agent writes artifact
          │
          ▼
Next sub-agent writes artifact
          │
          ▼
Writer writes report when needed
          │
          ▼
Verifier checks substantive artifact
          │
          ▼
Evaluator audits the route
          │
          ▼
Evolver runs only if an edit is recommended
```

## Session metrics

The orchestrator maintains session notes in `.spinosa/memory/orchestrator-notes.md`. This includes session summaries, key findings, blockers, and anything useful for future work. No structured event logging — the orchestrator writes what it needs based on the user request.

## Document conversion (OCR)

- **Text-layer PDFs** → `MarkItDown` succeeds (outcome-based `isTextBased` via MarkItDown non-empty) → keep text layer, no OCR, frontmatter + `page-*.md` split.
- **Scanned PDFs** → `MarkItDown` empty/fails → `pdftoppm -png -r 300` → `tesseract -l ita+eng+fra --psm 6` → `.md` (see `packages/spinosa-core/src/import/tesseract-ocr.ts`). Requires `tesseract`, `pdftoppm` (poppler), and `ita`/`eng`/`fra` tessdata.
- **Images** (`jpg`/`jpeg`/`png`/`gif`/`webp`/`heic`/`tif`/`bmp`/`svg`) → copy as binary to `raw/` (no OCR, no MarkItDown), tagged `images_pending_network_ocr` in `system/workspace_index.md` Skipped Media. A future network provider will replace the copy with OCR `.md`.
- **Office docs** (`docx`/`xlsx`/`csv`/`html`/`epub`/`json`/`xml`/`zip`) → MarkItDown unchanged.
- Legacy `ppu-paddle-ocr` + `onnxruntime` are kept as a one-release fallback when `tesseract` is unavailable, then removed (light binary ≈198M darwin-arm64 via `SPINOSA_WITH_ONNX=0`; `pdfjs-dist`/`@napi-rs/canvas` remain bundled for now but no longer used for text detection).

## Sub-agent gateway

Three dispatch paths (see `docs/diagrams.md` §9):

| Path | When | Host examples |
|------|------|---------------|
| **Native spawn** | Vendor exposes `spinosa-*` sub-agents | Codex (`.codex/config.toml`), OpenCode, Claude Code |
| **Task-tool spawn** | No native role; inject agent definition as Task prompt | Cursor, Grok |
| **Skill inject** | Native and Task both unavailable | Hermes (`delegate_task` or `/spinosa-*` via `.hermes/workspace.config.yaml`), any host with Agent Skills |

All paths write the same session-scoped artifact filenames declared in the goal artifact.

## Skills (fallback mode)

If native spawn is unavailable, the orchestrator uses Task-tool spawn or reads a fallback skill file — a SKILL.md containing the same instructions in a self-contained format. Skills mirror the agents they back up and live in `.agents/skills/`; vendor mirrors under `.hermes/skills/` and other vendor `skills/` dirs are pre-baked in the workspace template. Hermes users merge `.hermes/workspace.config.yaml` into `~/.hermes/config.yaml` (sets `skills.external_dirs` and `terminal.cwd`).
