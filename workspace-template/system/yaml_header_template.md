---
type: metadata_header_template
role: header_schema_guide
purpose: [define the canonical YAML header fields used across the framework]
description:
  - Canonical frontmatter schema for raw copies, maps, and framework files.
  - Agents use this to create compact headers that reveal purpose before body reading.
scope: [all framework markdown files]
connects_to:
  - AGENTS.md
  - workspace_index.md
  - dictionary.md
status: active
created: 2026-05-26
updated: 2026-06-04
---

# YAML Header Template

Use a small, stable yaml header on every framework file. The goal is to let an agent identify the file, understand its role, and know which files it connects to without reading the body first.

## Base Header

```yaml
---
type: [file_type]
role: [what this file does in the framework]
purpose: [one-line function of the file]
scope: [where this file applies]
connects_to:
  - [path]
  - [path]
status: active | draft | template | archived
evidence_type: primary | processed | interpretive | external
evidence_level: L1 | L2
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Use the fields needed for the file. Do not add empty analytic fields.

## Raw Copy Header

Required for every file in [[raw/]]. The dictionary is the source of truth for canonical terms.

```yaml
---
type: raw_copy
source: "raw/[relative-path]/[filename]"
source_document: "raw/[relative-path]/[source-folder]" # split page files only
original_source: "[relative original source path]" # split page files only
page_number: 1 # split page files only
page_count: 1 # split page files only
source_type: interview | fieldnote | article | report | dataset | correspondence | researcher_note | participant_worksheet | transcript | transcript_for_worksheet | book
original_format: pdf | docx | pptx | xlsx | xls | epub | html | txt | rtf | csv | json | yaml | md | jpg | png | ...
converter_engine: markitdown | vision | renamer | native
ocr_confidence: high | medium | low | unknown
language: en | fr | pt | es | ...
date: "YYYY-MM-DD or YYYY-MM-DD"
people: ["canonical name from dictionary"]
places: ["canonical place from dictionary"]
organizations: ["canonical org from dictionary"]
topics: ["topic1", "topic2"]
summary: "keyword-dense summary — terms an agent would grep for to find this file's concepts"
explicit_source_terms: ["surface term from source"]
canonical_aliases: ["alias from dictionary"]
uncertain_terms: ["term needing review"]
machine_artifacts: ["SPEAKER_00", "ocr_noise"]
metadata_uncertainty: ["date_missing", "identity_ambiguous"]
related_sources: ["other_file.md"]
generated_by: startup_agent
generated_at: YYYY-MM-DD
processing_status: copied_text_headered | markitdown_converted | ocr_processed
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Rules:
- `source` uses a relative path from the repo root (e.g., `raw/folder/file.md`).
- Split page files use `source_document`, `original_source`, `page_number`, `page_count`, and `part_of` so agents can cite exact pages while preserving source-document grouping.
- `original_format` records the source file extension before conversion (e.g., `pdf`, `docx`, `txt`). Replaces the former `text_type` field. Used for provenance tracking and re-onboarding idempotency checks.
- `converter_engine` records which engine produced this `.md` file: `renamer` (extension rename only), `native` (copied unchanged), `markitdown` (MarkItDown conversion), or `vision` (vision-model transcription). Older engine values predate local-OCR removal. Enables engine-specific re-classification warnings on re-onboarding.
- `ocr_confidence` is optional and applies when OCR or scan conversion produced the text. Use `unknown` when OCR quality was not measured.
- `language` is the ISO 639-1 code of the source file's primary language (en, fr, pt, es, etc.).
- `people`, `places`, `organizations` MUST use canonical forms from [[dictionary]].
- `summary` is a dense keyword string optimized for future search — terms an agent would grep for to find this file's concepts. Not prose. Single line. Written during startup by `spinosa-mapper` (or inline by the orchestrator for small corpora); no automated extraction tools involved.
- `explicit_source_terms` are terms visibly present in the source.
- `canonical_aliases` lists dictionary aliases included for retrieval.
- `uncertain_terms`, `machine_artifacts`, and `metadata_uncertainty` quarantine noisy or incomplete metadata.
- `related_sources` lists other raw copies with shared topics.
- `generated_by`, `generated_at`, and `processing_status` preserve provenance for generated headers.
- `processing_status` values are engine-specific: `copied_text_headered` (renamer/native), `markitdown_converted` (MarkItDown), `ocr_processed` (legacy, pre-removal) or vision transcription.
- Omit fields that have no value — do not write `people: []`.

**Frontmatter exception:** `connects_to:` and other YAML keys use **bare paths** (not wikilinks). This keeps the metadata machine-readable, grep-friendly, and stable for sub-agents to parse.

## Rule

Frontmatter is for routing and retrieval. The body is for interpretation, comparison, and context.

For fast grep:
- use lowercase snake_case field names,
- keep retrieval arrays short,
- prefer stable nouns over prose,
- include `source`, `root_rel_path`, `generated_by`, `generated_at`, and `processing_status` when the file points back to source structure or is generated by the framework,
- omit fields that do not help retrieval.

Validation before `setup_status: ready`:
- required YAML fields must be present for the file type,
- `source` paths must exist when they point to raw files,
- array fields must be YAML arrays,
- generated files must include `generated_by`, `generated_at`, and `processing_status`,
- navigation maps must use Obsidian wikilinks for internal file references,
- machine artifacts must not appear in canonical entity fields unless verified.

## Common Source Types
Use short lowercase values in `source_type`.

```yaml
source_types: [interview, fieldnote, article, policy, report, news, web_capture, legal, dataset, image, scan, audio, video, correspondence, researcher_note, participant_worksheet, transcript, transcript_for_worksheet, book, external]
```
