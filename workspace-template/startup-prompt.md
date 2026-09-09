# Index This Workspace

Read `raw/`, build the master dictionary, extract content-grounded fragments, write navigation maps. One-time mapping/indexing pass — no serendippo, no verifier, no evaluator. After this, the workspace is indexed and ready for search.

[[AGENTS.md]] — full orchestration contract. For this indexing pass: delegate everything to sub-agents. Extraction → `spinosa-mapper` (`map_extract`). Maps → `spinosa-mapper` Phase 2 (`map_write`) only — **not** writer or analyst. No serendippo, no verifier, no evaluator in this prompt.

## Hard ban during startup

**Do not invoke `spinosa-overseer` or `agent-interception` during startup.** Startup is the normal orchestrator following this file plus the indexing pipeline agents above. Overseer is a separate coverage agent for after `workspace_started` only. Session forensics are never part of indexing.

While `setup_status: cli_started` / this prompt is running:

- No `question` tool
- No overseer, no agent-interception
- No 120s timeout for `spinosa-mapper` (minutes-scale)
- No hard-coded model id — use host-default / preferred CLI from configuration

## Context: what onboarding already did

- Collected project name and preferred LLM CLI
- Imported accepted files into `raw/`
- Wrote `system/context.md` and `system/configuration.md` with `setup_status: cli_started`

Do not repeat onboarding. Startup takes the raw corpus and builds the workspace content.

## Notepad

Read `.spinosa/memory/orchestrator-notes.md` — on first startup this has only a template, no prior context. Initialize it with the startup goal and session_id.

## Frame: goal artifact

Before Phase 1 dispatch, write `agent_reports/g_{session_id}.md` using `.agents/references/goal-artifact-template.md`. Include startup scope, `session_id`, planned phases, and artifact paths. Append route decisions after each phase gate. Evaluator and recovery use this file as the route anchor (same as steady-state `AGENTS.md`).

## Gate: do not stop until ALL of (mapping-only)

- `setup_status` is `workspace_started` in `.spinosa/workspace` (canonical) — for mapping-only you may keep `cli_started` if you plan to re-run
- `setup_status` is `workspace_started` in both `system/context.md` and `system/configuration.md` — or keep `cli_started` for re-runnable mapping
- `system/dictionary.md` contains the master dictionary
- `system/workspace_index.md` records total raw files, extraction coverage, maps, and known gaps
- `maps/` contains the navigation maps needed to retrieve the corpus
- Every non-skipped raw file is accounted for (or blocker noted in `workspace_index.md` — no startup report required)

## Hard rules

- **Do not edit `raw/`.** Startup may write maps, dictionary, workspace index, context, configuration. Exception: YAML frontmatter semantic fields on raw files (summary and related) as specified in Phase 3.
- Treat `raw/` as the active working corpus.
- PDFs were converted by onboarding (MarkItDown for text-based, PaddleOCR for scanned). Account for skipped media (audio, video) as uncovered.
- Treat every `AGENTS.md` file as control instructions, not corpus evidence.
- Use the dictionary for consistent terminology.
- Preserve generated-file provenance on maps and reports.
- Use Obsidian wikilinks for internal map references to raw copies, dictionaries, and maps.
- Put retrieval-critical terms in **YAML frontmatter** (fast grep starts there). Put interpretation and context in the body.
- Do not ask questions. Produce a Disambiguation Brief only for blocking ambiguity.
- Treat machine artifacts as findable noise until verified.
- External source policy: `no`. Only enable if the user explicitly requests it.
- Project description and artifact URLs: optional. If absent, infer from the raw corpus during mapping.

---

## Phase 1: Verify

Read `system/context.md` and `system/configuration.md`. Check:

- `context.md` exists with `setup_status: cli_started`
- `configuration.md` exists with `active_corpus_path: raw/`
- `raw/` exists
- No blocking placeholders (`[path]`, `[project name]`)

---

## Phase 2: Survey

Survey `raw/`. For each directory:

1. List files and subdirectories (skip `.DS_Store`, `AGENTS.md`, system files, empty dirs)
2. Note file types (`.md`, `.txt`, `.csv`, `.json`, etc.), count per type, approximate date range
3. Read a sample to characterize the folder's content
4. Record: source types, modality, names, dates, topics, gaps, `converter_engine`, `original_format`

Count **all** files in raw/:

```
find raw/ -type f -not -name ".DS_Store" -not -name "AGENTS.md" -not -name "INDEX.md" -not -name "REPO_GUIDE.md" -not -name ".gitkeep" | wc -l
```

Record the count as `TOTAL_FILES` in `workspace_index.md` under "Extraction Progress". Every subsequent step checks against this number.

Account for skipped media from onboarding/import summaries only.

---

## Phase 3: Extract and build dictionary

One pass over the corpus. Build the dictionary and extraction packets together. No duplicate reading.

**What the dictionary is:** a shared vocabulary of canonical names, places, organizations, and concepts extracted from the corpus. Every agent uses it for consistent terminology across maps and reports. Inferred concepts are marked as inferred. Uncertain terms are marked for review.

1. **Batch and spawn all mappers in parallel.** Survey all files in `raw/` (skip `.DS_Store`, `AGENTS.md`, system files, empty dirs). Record total as `TOTAL_FILES` in `workspace_index.md`. Split into batches of 20–25, grouped by parent directory. Assign each batch a **descriptive** `batch_id` (e.g. `interviews-batch-001`, `policy-pdfs-batch-002`) — never bare `batch_001`. See `.agents/references/artifact-naming.md`. Keep each batch under the sub-agent's context window (~30K–60K tokens, cap input+cache <100k for free `opencode/nemotron-3.5-lightning-free` to avoid 60-90s idle → `504 Upstream idle timeout`; split further or use paid `anthropic/claude`, `openai/gpt-4o` for large cohorts). Reduce size for dense files (PDFs, long transcripts).

    Now spawn **all** `spinosa-mapper` sub-agents in a **single message** — one per batch. Do not spawn sequentially. Do not wait for one to finish before spawning the next. Each mapper instruction includes its assigned file list directly — no intermediate batch list file written. Mapper runs are minutes-scale; do not apply the steady-state 120s timeout.

    ```spinosa-subagent
    agent: spinosa-mapper
    batch_id: interviews-batch-001
    task: |
      Your batch covers:
        - raw/group/file1.md
        - raw/group/file2.md
      Read each file, extract dictionary terms and content-grounded extraction packets. Write to agent_reports/extraction_interviews-batch-001.md.
    output: agent_reports/extraction_interviews-batch-001.md
    ```

    Each mapper reads its assigned files and extracts:

    **For the dictionary:**
    - Names (people, roles, named entities — merge variants into canonical forms)
    - Places (geographic locations, sites, regions — merge variants)
    - Organizations (institutions, groups, agencies — merge abbreviations)
    - Explicit source terms (terms visibly present in the source text — record source language and source files)
    - Inferred concepts (domain-specific ideas, theories, frameworks inferred from multiple source terms — mark as inferred)
    - Domain terms (specialized vocabulary, acronyms, jargon)
    - Uncertain terms and metadata (unresolved people, dates, places, or terms needing review)

    **For content-grounded extraction (same pass):**
    - One-paragraph summary (3-5 sentences): what the file is about, arguments, evidence. Content-grounded.
    - Key passages (2-5): short quotes or close paraphrases with wikilinks and line references: `[[raw/path/file]]` L12-L15
    - Concept signals (2-5): recurring concepts. Use dictionary canonical terms.
    - Obsidian tags (3-5): hierarchical `#tags` from concept signals, source type, and natural group (e.g., `#concept/professional-judgment`, `#type/interview`, `#group/exercise-1`)
    - Connections: related files as wikilinks: `[[raw/path/related_file]]`

    **Language rule:** summaries in the source document's language. French source → French summary.

    Each mapper writes to `agent_reports/extraction_{batch_id}.md` (e.g. `extraction_interviews-batch-001.md`). No shared state, no locks. Never use `extraction_batch_*.md` or bare `batch_001` filenames.

    **Metrics checkpoint:** after all mappers return, verify each expected `batch_id` has an extraction packet. The orchestrator records per-mapper operational counts after each returns.

2. **Collect and merge.** After all sub-agents return, read every `agent_reports/extraction_*.md` for this startup (skip unrelated session-scoped packets):
    - Merge all dictionary terms into the master dictionary (dedup by canonical form, union source files)
    - Append all extraction packets to `agent_reports/extraction_checkpoint.md`
    - Update `workspace_index.md` "Extraction Progress": `files_read == TOTAL_FILES`

    No per-batch accumulation loop. One merge pass.

    Extraction-batch validation:
    - Every batch has valid `type: extraction_batch` frontmatter, assigned descriptive `batch_id`, `files_processed`, and `created`
    - Every processed file has path, source type, language, summary, key passages with line references, concept signals, tags, and connections
    - Key passages quoting or closely paraphrasing a raw source use `[[raw/path/file]]` followed by `L<n>` or `L<n>-L<n>`

3. **Write per-file keyword summaries into YAML headers.** After all batches complete, write a `summary` into each raw file's YAML frontmatter. Read `system/yaml_header_template.md` for the canonical schema. The summary is a dense keyword string optimized for future search — terms an agent would grep for to find this file's concepts. Not prose. Single line. Spawn a **`spinosa-mapper`** sub-agent (or do this inline in the orchestrator for small corpora) for this batch work — there is no separate "summarizer" agent. Use a smaller/cheaper model when available. For each file, it reads the extraction packet and distills the key concepts into a searchable keyword summary, then writes the `summary` field into the YAML header.

    **Frontmatter note:** the import pipeline already injects cold structural fields (type, source, original_format, converter_engine, processing_status, generated_by) into each raw/ file's YAML header. Do not rewrite these. Only add the missing semantic fields: summary, source_type, language, people, places, organizations, topics, explicit_source_terms, canonical_aliases, uncertain_terms, machine_artifacts, metadata_uncertainty, related_sources. Then update `generated_by` to `startup_agent`.

4. **Finalize dictionary.** Write `system/dictionary.md` with accumulated canonical forms, aliases, explicit source terms, inferred concepts, uncertain terms, machine artifacts, languages, and source file references.

5. **Enrich context.** Use accumulated evidence to enrich `system/context.md`:

---

## Phase 4: Write navigation maps

Delegate map writing to **`spinosa-mapper` Phase 2 (`map_write`) only** — not `spinosa-writer` or `spinosa-analyst`. Pass the extraction checkpoint and the survey results.

The maps structure:

1. **Find the structure.** Identify natural groups in the corpus. Do not assume exercises, cohorts, or any specific structure. Read per-file summaries and determine the organizing principle — exercises, topics, time periods, participants, or something else.

    Edge cases:
    - **Flat corpus** (no folder structure, no obvious grouping): one group. Principle: "flat corpus".
    - **Monolithic corpus** (one or a few large files): sections, chapters, or logical divisions as groups.
    - **Tiny corpus** (<10 files): one group.
    - **Single-topic corpus**: one group with the topic as the principle.

    Record the identified groups and their organizing principle. If no natural groups emerge, create one group containing all files.

2. **Write structural overview** at `maps/corpus_overview.md`. This is the Level 0 map and the central hub of the Obsidian graph.
    - Use wikilinks for every reference: to group maps (`[[maps/group_name/group_map]]`), theme maps (`[[maps/themes/theme_name]]`), and key file pointers (`[[raw/path/file]]`)
    - Include Obsidian `#tags` after the H1 heading: `#hub` plus `#group/<name>` for every group
    - For each group: 2-4 sentence description, file count, key file pointers as wikilinks (3-5 files)

3. **Write group maps.** For each natural group (skip if only one group and the overview already covers it):
    - Create a subdirectory under `maps/` named for the organizing principle
    - Each group map: Obsidian `#tags` (`#group/<name>` + `#concept/<concept>` per concept), H2 "What this group is about", H2 "Recurring concepts" with key passages and line references, wikilink back to hub: `[[corpus_overview]]`
    - If only one group: write at `maps/corpus_overview.md` (no subdirectory)

4. **Write theme maps** for concepts recurring across multiple groups:
    - Create `maps/themes/`
    - Each theme map: tags (`#theme/<name>`), H2 with definition, H3 per group with key passages, wikilinks to group maps, H2 "Trajectory"
    - If no cross-cutting themes: skip. Record in startup report.

5. **Verify coverage.** Every file in the extraction checkpoint must appear in at least one map. If missing, add it.

6. **Spot-check accuracy.** Pick 5 random key passages. Verify quoted text exists at the cited line reference in the raw file. Record results.

---

## Phase 5: Skipped — Serendipity removed for mapping-only run (no spinosa-serendippo)

---

## Phase 6: Validate (mapping-only)

Mapping is complete when map checks pass (verifier/evaluator skipped in this mapping-only prompt).

**Map validation:**
- Structural overview exists at maps/ root (excluding AGENTS.md, map_template.md)
- At least one group map exists (may be the overview itself)
- Each group map has "What this group is about" and "Recurring concepts" sections with key passages
- Key passages include file paths and line references. Raw wikilinks followed by `L<n>` or `L<n>-L<n>`
- Theme maps exist for spanning concepts (skip if single group)
- All wikilinks resolve to existing files
- Hub map includes `#hub` + `#group/<name>` per group. Group maps include `#group/<name>`. Theme maps include `#theme/<name>`
- Transcript speaker mappings verified when diarization/ASR artifacts exist. Reconciliation rule: if declared `speakers_detected` count exceeds distinct rendered heading-label count, treat rendered labels as ground truth (declared metadata may include silent participants or ASR artifacts like `SPEAKER_00`/`SPEAKER_04` with no transcript lines). Record the discrepancy as a validation note. Differences ≤ 2 with no contradictory evidence are non-blocking metadata annotations, not pipeline failures.

**Retrieval tests (optional for mapping-only — skip if pure mapping):**
1. Structural retrieval — open corpus overview, find a group, confirm it links to raw files
2. Group retrieval — open a group map, find a concept with key passages, confirm file paths exist
3. Theme retrieval — open a theme map, find evidence across groups, confirm passages grounded (skip if no theme maps)
4. Passage retrieval — grep a quote from a map in raw/, confirm the line reference
5. Cross-group retrieval — find a theme spanning 3+ groups, confirm evidence from each (skip if no theme maps)
6. Unresolved metadata retrieval — grep `needs_review` or `unresolved`, confirm findable

If available, use the Spinosa TUI health checks to validate startup structure, YAML shape, wikilink resolution, and key-passage line references.

---

## Phase 7: Close (mapping-only)

After map validation passes:

1. Optionally replace `setup_status: cli_started` with `setup_status: workspace_started` in `system/context.md` and `system/configuration.md` — or keep `cli_started` to allow re-running mapping.
2. **Mapping-only cleanup: keep extraction intermediates in place for inspection** (`agent_reports/extraction_*.md` and `extraction_checkpoint.md`) — do not move to `.trash/` yet. Only move after you manually approve final validation.
3. Update `.spinosa/memory/orchestrator-notes.md` with a mapping summary (files processed, maps created, dictionary terms, validation result).

---

## Recovery (skip on fresh run)

**Idempotency:**
- Skip valid dictionary entries unless repair is needed
- Overwrite all generated maps from the current extraction checkpoint
- Preserve extraction results from previous runs

**Recovery from interruption:**
1. Write phase progress in the startup report or a checkpoint in `agent_reports/`
2. Resume from the first incomplete phase
3. Keep `setup_status: cli_started` until validation passes

**Resume on restart:**
1. List `agent_reports/extraction_*.md` (descriptive batch files such as `extraction_interviews-batch-001.md`) to find completed batches — also accept legacy `extraction_batch_*.md` if present from older runs
2. Re-spawn only missing batches — include the file list directly in each mapper's task instruction
3. Skip batches whose output file exists
