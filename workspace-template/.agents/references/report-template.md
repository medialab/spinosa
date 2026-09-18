# Report Template

The **`write_report` tool** is the canonical way to produce numbered reports. It handles YAML frontmatter, section headers, separators, and the reproducibility table. Use this template as a content reference for what goes in each field.

## File Naming Convention

**Full rules:** [[.agents/references/artifact-naming.md]]

Reports are numbered sequentially based on existing files in `agent_reports/`:

1. List all `NN_*.md` files in `agent_reports/`
2. Extract the number prefix from each file
3. Find the highest number
4. Increment by 1 for the new report
5. Format: `NN_{topic-slug}.md` — the slug must name the **research topic or question**, not the file type

**Good examples:**
- [[00_startup-indexing-report.md]]
- [[01_coastal-erosion-normandy-interviews.md]]
- [[02_fisheries-policy-source-comparison.md]]

**Forbidden slugs (alone):** `report`, `analysis`, `final`, `output`, `temp`, `result`, `draft`

If no numbered files exist, start with `00_`.

## Report Template

```markdown
---
type: report
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: draft
scope: [one-line description]
pipeline: [agent chain, e.g. searcher → serendippo → writer → verifier]
query: [original user query]
---

# [Headline: goal from goal artifact]

## Goal
[What the research aimed to answer — restated from the original request]

- - - - -

## TLDR
[Short natural-language answer, 1–3 sentences]

- - - - -

## Report
[Main body: evidence, interpretation, analysis, patterns.
Use H3 for sub-topics in this section only. Never add a second H1.
Inline source citations. Unicode charts used where they add clarity.
Limitations (gaps, uncertainties, what was not checked) noted inline.
For large evidence sets (>50 sources), include the top 10-20 here and link to the appendix:]

> For the complete evidence set, see `agent_reports/evidence_appendix.md`

- - - - -

## Conclusions
[NOT a summary. Critical reflection comparing goal vs findings:
- What did we expect vs what did we find?
- Which assumptions held, which broke?
- What is the gap between the question and what the corpus supports?
- Implications and insights grounded in the evidence]

- - - - -

## Serendipity
[Only when serendippo ran. Alternative viewpoints, hidden connections.
Omitted entirely when serendippo not in pipeline.]

- - - - -

## Reproducibility

| Field   | Value |
|---------|-------|
| Query   | [original query] |
| Maps    | [maps accessed, count] |
| Grep    | ["pattern1", ...] |
| Glob    | ["glob1", ...] |
| Scanned | [N files] |
| Read    | [N files] |
| Rounds  | [N search rounds] |
| Agents  | [chain] |
| Tags    | [keywords/terms used] |
| Gaps    | [coverage gaps] |

**Sources:** [list of all source paths referenced]
```

## Evidence Appendix

When evidence exceeds ~300 lines or ~50 sources, create a separate appendix file:

**File:** [[agent_reports/evidence_appendix.md]]

```markdown
---
type: evidence_appendix
report: [main report filename]
sources_total: [count]
created: YYYY-MM-DD
---

# Evidence Appendix: [Report Title]

Full evidence set for the main report. The main report's `## Report` section contains the top sources and key patterns.

### Source 1: [file path]
- **Type:** raw_copy
- **Relevant excerpt:** [quoted text with line context]
- **Confidence:** high | medium | low

### Source 2: [file path]
...
```

## Unicode Chart Types

The report template supports 6 chart types for different visualization needs.

### Chart Type Registry

| Type | Characters | Use Case | File/Zone |
|---|---|---|---|
| **Distribution Bars** | `▓░█` | Compare 3-4 metrics side-by-side | Startup Report |
| **Progress Bar** | `▓░` | Linear completion tracking | Extraction Checkpoint |
| **Status Matrix** | `✓⚠✗○◉` | Multi-dimensional health grid | Workspace Index |
| **Gauge** | `◐◑◉` | Single circular metric | Janitor Report |
| **Sparkline** | `▁▂▃▄▅▆▇█` | Trend over time | Serendipity Report |
| **Stacked Bar** | `█▓▒░` | Composition of segments | Evidence Packet |

### Common Settings

```
bar_width = 16 characters
border_style = ┌─ Title ─┐ / └─────────┘
alignment = labels left, charts right
status_values = ○ pending → ✓ verified / ⚠ corrections / ✗ failed
```

### Bar Calculation (Distribution Bars, Progress Bar, Stacked Bar)

```
filled = round((value / total) * bar_width)
empty = bar_width - filled
bar = "▓" * filled + "░" * empty
```

If total is 0 or unknown, show full bar with "?" for count.

### Status Matrix Rendering

```
For each cell, assign status based on data:
  ✓ = all checks passed
  ⚠ = minor issues or warnings
  ✗ = failures or missing
  ○ = not yet checked
  ◉ = currently processing
```

### Gauge Rendering

```
Calculate percentage: pct = value / total
Determine fill level:
  0%   = ░░░░░░░░░░░░░░░░
  25%  = ◐░░░░░░░░░░░░░░░
  50%  = ◐◐◐◐◐◐◐◐◑░░░░░░░
  75%  = ◐◐◐◐◐◐◐◐◐◐◐◐◑░░░
  100% = ◐◐◐◐◐◐◐◐◐◐◐◐◐◐◐◐
```

### Sparkline Rendering

```
Normalize values to 0-7 range:
  normalized = round((value - min) / (max - min) * 7)
  char = "▁▂▃▄▅▆▇█"[normalized]
```

### Stacked Bar Rendering

```
For each segment:
  segment_width = round((segment_value / total) * bar_width)
  Concatenate segments: bar = "█" * s1 + "▓" * s2 + "▒" * s3 + "░" * s4
```

### Dashboard Examples

**Distribution Bars (Startup Report):**
```
┌─ Startup Status ───────────────────────────────────────────────┐
│ Extract  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  925/925 files                     │
│ Maps     ▓▓▓▓▓▓▓▓▓▓▓▓░░░░  15 created                         │
│ Dict     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░  342 terms                          │
│ Valid    ✓ passed                                                │
└─────────────────────────────────────────────────────────────────┘
```

**Progress Bar (Extraction Checkpoint):**
```
┌─ Extraction Progress ───────────────────────────────────────────┐
│ Files    ▓▓▓▓▓▓▓▓▓▓░░░░░░  450/925 (48%)                       │
│ Batches  ▓▓▓▓▓▓░░░░░░░░░░  30/60 completed                     │
│ Status   in_progress                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Status Matrix (Workspace Index):**
```
┌─ Workspace Health ──────────────────────────────────────────────┐
│ Group    A    B    C    D    E    F                             │
│ Maps     ✓    ✓    ⚠    ✓    ✓    ✗                            │
│ Links    ✓    ✓    ✓    ✓    ⚠    ✓                            │
│ Fresh    ✓    ✓    ✓    ✓    ✓    ✓                            │
└─────────────────────────────────────────────────────────────────┘
```

**Gauge (Janitor Report):**
```
┌─ Hygiene Score ─────────────────────────────────────────────────┐
│ Overall  ◐◐◐◐◐◐◐◐◑░░░░░░░  75%                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Sparkline (Serendipity Report):**
```
┌─ Discovery Trend ───────────────────────────────────────────────┐
│ Links    ▁▂▃▅▆▇█▇▅▃▂▁▂▃▅▆▇  12 connections                     │
│ Maps     ▂▃▅▇█▇▅▃▂▁▁▂▃▅▇█  8 maps consulted                   │
└─────────────────────────────────────────────────────────────────┘
```

**Stacked Bar (Evidence Packet):**
```
┌─ Search Metrics ────────────────────────────────────────────────┐
│ Source   ████▓▓▓▓░░░░░░░░  maps:4 raw_scanned:8 raw_read:4     │
└─────────────────────────────────────────────────────────────────┘
```


