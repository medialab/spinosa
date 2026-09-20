# Artifact Naming — Human-Readable From Outside

Every markdown artifact Spinosa agents create is **precious** — often the only durable trace of a route. Filenames must be understandable in Finder, Obsidian, or `ls` **without opening the file**.

## Core rule

> If a researcher sees only the filename, they should know **what question it answers** or **what operation it records**.

Use **lowercase kebab-case**, ASCII only, **3–6 words** in the descriptive slug when possible.

## Never use (alone or as the whole slug)

`report`, `output`, `final`, `temp`, `result`, `analysis`, `draft`, `misc`, `untitled`, `notes`, `data`, `file`, `new`, `copy`

## Good vs bad (user-facing `NN_*.md` reports)

| Bad | Good |
|-----|------|
| `03_report.md` | `03_coastal-erosion-normandy-interviews.md` |
| `07_analysis.md` | `07_fisheries-policy-source-comparison.md` |
| `01_final.md` | `01_startup-indexing-validation.md` |
| `02_output-v2.md` | `02_ocr-failures-and-missing-pdfs.md` |

The slug should name the **topic + scope** (who/what/where), not the agent or file type.

## Numbered final reports (`spinosa-writer`, startup)

Format: `NN_{topic-slug}.md`

- `NN` = two digits, next free number in `agent_reports/`
- `{topic-slug}` = plain-language kebab-case from the goal artifact (research question or deliverable)

Examples: `00_startup-indexing-report.md`, `04_participant-views-on-relocation.md`

## Session-scoped intermediates (fixed prefix + session_id)

These names are **machine-stable** — do not rename. Put human context in YAML `scope:` / title inside the file.

| Agent | Path pattern |
|-------|----------------|
| Orchestrator | `g_{session_id}.md` |
| Searcher | `evidence_packet_{session_id}.md`, `evidence_appendix_{session_id}.md` |
| Analyst | `analysis_{session_id}.md` |
| Serendippo | `serendipity_{session_id}.md` |
| Evaluator | `e_{session_id}.md` |
| Overseer | `c_{session_id}.md` |
| Janitor | `janitor_{session_id}.md` |

**Parallel search (same session):** `evidence_packet_{session_id}_{short-topic-slug}.md` — slug required when multiple searcher instances run (e.g. `_fisheries-policy`).

## Mapper extraction batches

Format: `extraction_{batch_id}.md`

`batch_id` must be **descriptive**, assigned by the orchestrator or mapper:

- Good: `west-africa-interviews-batch-001`, `pdfs-ocr-retry-batch-002`
- Bad: `batch_001`, `batch1`, `temp`

## Mapper / navigation maps (`maps/`)

| Map kind | Path | Slug rule |
|----------|------|-----------|
| Hub | `maps/corpus_overview.md` | fixed |
| Group | `maps/groups/{group-slug}/map.md` or `{group-slug}.md` | corpus structure name (e.g. `normandy-interviews`, `policy-documents`) |
| Theme | `maps/themes/{theme-slug}.md` | cross-cutting concept (e.g. `coastal-erosion`, `relocation-policy`) |

Never `map.md` at repo root without a parent folder. Never `group1`, `theme_a`.

## Janitor / evolver (when no session_id)

- Janitor standalone: `NN_workspace-hygiene-audit.md` (e.g. `05_workspace-hygiene-audit.md`)
- Evolver: `evolution_{session_id}.md` or `NN_framework-evolution-{short-slug}.md`

## Startup-only legacy names

Prefer session-scoped names when `g_{session_id}.md` exists. If legacy:

- `00_startup-indexing-report.md` — not `00_startup-report.md` alone if a more specific scope is known
- Serendipity: `NN_startup-serendipity-themes.md` — not `serendipity_report.md`

## YAML `scope:` field

Every artifact should set `scope:` in frontmatter to one line a human can read — the filename and scope should agree.