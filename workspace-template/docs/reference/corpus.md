# Corpus Structure & Configuration

This page covers the workspace layout, what each directory holds, configuration settings, and the startup protocol.

## Workspace layout (simplified)

```
your-workspace/
  AGENTS.md         Instructions that tell your AI tool how to orchestrate agents
  raw/              Your documents, all converted to .md files
  maps/             Navigation maps — an automatic table of contents
  system/           Configuration, context, dictionary, index
  agent_reports/    All answers and reports
  .logs/            Hidden import and conversion traces (CLI-written)
  .agents/          Agent definitions and fallback skill files
  .bin/             CLI scripts
  .trash/           Archived old files
```

> For the full tree showing every file and its role, see `system/system_architecture_map.md`.

## What each directory is for

| Directory | What lives there |
|---|---|
| `raw/` | Your converted documents. Single-page sources usually become one `.md` file. Split multi-page sources become one folder with `page-001.md`, `page-002.md`, etc. Each page file has a YAML header with provenance and page data. The agents search here. |
| `maps/` | Navigation maps built during startup. Think of them as a smart index — they say "these 5 files are about coastal erosion, these 3 are about farming practices, and here are the key passages." Uses Obsidian wikilinks (`[[filename]]`) so you can browse connections visually if you open the workspace in Obsidian. |
| `system/` | Your workspace settings. `context.md` stores project scope and research vocabulary. `configuration.md` stores operating settings. `dictionary.md` is the master vocabulary list. |
| `agent_reports/` | All agent output. Numbered files like `00_startup-report.md` are final results. Session-scoped files like `evidence_packet_{session_id}.md` are intermediate work files the evaluator moves to `.trash/` after the route closes. |
| `.logs/` | Hidden operational traces: `onboarding.log`, conversion NDJSON. Pre-memory-migration session records may remain here or in `.spinosa/archive/`. Current session memory is at `.spinosa/memory/`. |
| `.agents/agents/` | Definitions of the 11 agents. Each is a `.md` file with permissions, workflow, and output format. |
| `.agents/skills/` | Fallback instructions for each agent, used when native dispatch isn't available. |
| `.bin/` | CLI scripts and conversion engines. |
| `.trash/` | Archived process files — moved here automatically as reports are finalized. |

## YAML headers in raw/

Every file in `raw/` has a small metadata block at the top called a YAML header. It helps agents identify what the file contains without reading the whole thing:

```yaml
---
type: raw_copy
source: "raw/folder/interview-normandy-2024.md"
source_document: "raw/folder/interview-normandy-2024"
page_number: 1
page_count: 12
source_type: interview
original_format: pdf
converter_engine: markitdown
language: fr
date: "2024-06-15"
people: ["Maria Santos"]
places: ["Normandy coast"]
topics: ["coastal erosion"]
keywords: ["shoreline retreat", "sea defences"]
---
```

**What this means in plain English:**
- **source:** where the file lives in your workspace
- **source_document:** for split page files, the raw folder all pages belong to
- **page_number/page_count:** for split page files, the page position in the source document
- **source_type:** what kind of document this is (interview, field note, report, etc.)
- **original_format:** what it was before conversion (PDF, Word doc, etc.)
- **converter_engine:** how it was converted (MarkItDown for text/office docs, vision model or copy-as-is for scanned images/PDF pages; older engine ids are legacy values from before local-OCR removal)
- **language:** the document's language
- **people/places/topics/keywords:** labels extracted from the content, using canonical terms from the dictionary

## Configuration settings

`system/configuration.md` stores your workspace settings:

```yaml
active_corpus_path: raw/
external_sources_allowed: no
converter_policy: local_only
claim_standard: source_link_required
stale_after_days: 30
preferred_llm_cli: opencode
```

**What you need to know as a researcher:**
- `setup_status` tracks where you are: `not_started` → `cli_started` (after `spinosa new`) → `workspace_started` (after startup completes)
- `external_sources_allowed`: default `no` — you control whether the agents can look beyond your documents
- `stale_after_days`: how long before the Janitor considers a file old

## Context file

`system/context.md` stores the project's research context. During startup, the agent fills in:
- Project title and description
- Active corpus path and source types
- Key actors, institutions, places found in your documents
- Research methods inferred from your sources
- Known blind spots and gaps

The Writer reads this to understand the project when composing reports.

## Dictionary

`system/dictionary.md` is the master vocabulary list, built during startup. It contains canonical forms for:
- **Names** — people, roles, named entities (with aliases and language variants)
- **Places** — geographic locations, sites, regions
- **Organizations** — institutions, groups, agencies
- **Concepts** — domain-specific ideas, theories, frameworks
- **Explicit source terms** — terms visibly present in your source text
- **Uncertain terms** — unresolved people, dates, or places needing review
- **Machine artifacts** — OCR noise, speaker labels, processing artifacts

Terms appear in the language they were found in. If a concept appears in both French and English, both variants are listed.

## Workspace index

`system/workspace_index.md` tracks coverage and health:
- How many files are in `raw/`, by type
- How many navigation maps were created
- Dictionary size and status
- Extraction progress during startup
- A health matrix showing which groups have complete maps, valid links, fresh files, and dictionary terms

## Workspace health matrix

After startup, the workspace index includes a health grid:

```
┌─ Workspace Health ──────────────────────────────────────────────┐
│ Group    A    B    C    D    E    F                             │
│ Maps     ✓    ✓    ⚠    ✓    ✓    ✗                            │
│ Links    ✓    ✓    ✓    ✓    ⚠    ✓                            │
│ Fresh    ✓    ✓    ✓    ✓    ✓    ✓                            │
│ Dict     ✓    ✓    ✓    ○    ✓    ✓                            │
└─────────────────────────────────────────────────────────────────┘
```

- `✓` = all good
- `⚠` = minor issue (review when convenient)
- `✗` = needs attention
- `○` = not yet checked

## Startup protocol

When you first create a workspace, the startup protocol indexes everything:

1. **Verify onboarding** — confirm your files were copied correctly
2. **Survey the corpus** — count files, note types and languages
3. **Build dictionary + extract content** — read every file, extract names, places, terms, summaries, and key passages
4. **Write navigation maps** — build structural overview, group maps, and theme maps
5. **Validate** — check every file appears in at least one map, spot-check quote accuracy

Startup is complete only when all validation checks pass. The status then changes from `cli_started` to `workspace_started`.

> For the full protocol with detailed specifications, see the Startup Protocol in `startup-prompt.md`.

## AGENTS.md files

Every directory has an `AGENTS.md` file that tells the AI tool how to behave in that directory. These are control instructions, not research evidence. They are never imported, mapped, or cited as sources.
