# Report Template

The **`spinosa_report` tool** is the canonical way to produce reports. It handles YAML frontmatter, section headers, separators, and the reproducibility table. Use the exact output path supplied by the runtime node; this template is a content reference, not permission to name or sequence artifacts.

The WorkflowEngine supplies the exact output filename. Pass it unchanged to
`spinosa_report`; do not inspect existing reports, increment a sequence, or
choose a slug.

## Report Template

```markdown
---
type: report
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: draft
scope: [one-line description]
pipeline: [runtime workflow ID/version and completed node IDs from run.json]
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
Inline source citations. Use `spinosa_figure` only for supported figure kinds.
Separate the narrative into `Supported findings`, `Context-derived hypotheses`,
and `Questions requiring retrieval` when those distinctions apply.
Limitations (gaps, uncertainties, what was not checked) noted inline.
When search coverage is in scope, state the runtime coverage contract, searched
scope, unsearched scope, truncation, and blockers from the evidence artifact.
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
Omitted when the runtime workflow did not schedule the serendippo node.]

- - - - -

## Reproducibility

| Field   | Value |
|---------|-------|
| Query   | [original query] |
| Maps    | [maps accessed, when supplied] |
| Grep    | [patterns, only when exposed by the host] |
| Glob    | [file-discovery patterns, only when exposed by the host] |
| Scanned | [count, when supplied] |
| Read    | [count, when supplied] |
| Rounds  | [runtime-supplied count, otherwise omit] |
| Agents  | [agent IDs recorded in run.json] |
| Tags    | [terms, when supplied] |
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

## Supported Figures

Call **`spinosa_figure`** for quantitative charts (`bar`, `sparkline`, `stacked_bar`, `status_matrix`). Paste the returned Markdown into the `report` field of `spinosa_report`. Do not hand-draw bar lengths or sparklines.

Chooser, 52-character width, glyphs, and accessibility: [[.agents/references/chart-rendering.md]].

Budget: no chart when a sentence is enough; normally one figure per section; two maximum per section.
