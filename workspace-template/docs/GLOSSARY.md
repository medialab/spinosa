# Glossary

Plain-English definitions of terms you'll encounter.

| Term | What it means |
|---|---|
| **Corpus** | Your folder of source documents — PDFs, Word files, transcripts, notes, images. Whatever you're researching. |
| **Workspace** | The folder Spinosa creates from your corpus. It contains converted copies of your files (`raw/`), navigation maps (`maps/`), configuration (`system/`), and agent reports (`agent_reports/`). |
| **raw/** | Where Spinosa keeps your documents after converting them to text files (`.md`). One file per source document. The agents search here. |
| **maps/** | An automatic table of contents. The agent reads your documents and builds maps that say "these files are about topic X, these are about topic Y, and here are the key passages." |
| **system/** | The workspace brain. Contains your project settings (`configuration.md`), research context (`context.md`), a shared dictionary (`dictionary.md`), and the workspace index (`workspace_index.md`). |
| **Dictionary** | A list of all the names, places, organizations, and key terms the agent found in your documents. Agents use this to search consistently. |
| **agent_reports/** | Where all answers live. Each time you ask a question, the result is a numbered report stored here. |
| **Sub-agent** | A specialized AI helper. The main set includes Searcher, Analyst, Writer, Verifier, Mapper, Serendippo, Janitor, Evaluator, and Evolver. |
| **Workflow** | A versioned strategy selected from `BUILTIN_WORKFLOWS`. The WorkflowEngine schedules its runnable nodes, enforces dependencies, retries, gates, and terminal state, and records the run in `run.json`. |
| **Goal artifact** | A human-readable mirror of a runtime run. It records the cleaned prompt, selected workflow, node scopes, artifact paths, gates, and runtime events; it is not a manual dispatch plan. |
| **Coordinator** | The conversation or host layer that invokes the WorkflowEngine and may provide worker dispatch. It does not replace runtime routing, artifact naming, gates, retries, or terminal-state decisions. |
| **Evidence packet** | A file the Searcher writes while finding evidence. Contains quotes from your sources, file paths, and confidence levels. The Writer reads this to compose your report. |
| **YAML header** | A small block of labels at the top of each file (between `---` marks) that tells agents what the file contains: title, date, language, people mentioned, topics, keywords. Like a library card for each document. |
| **Obsidian wikilinks** | A way to link between files using double brackets (`[[filename]]`). Spinosa uses these in navigation maps. If you open the workspace in Obsidian, you get a visual graph of how documents connect. |
| **Confidence level** | A label on each piece of evidence: **high** (exact match, clear context), **medium** (close match, some ambiguity), or **low** (mentioned in passing, indirect). |
| **Verification status** | Runtime verification returns `pass`, `pass_with_corrections`, `partial`, `fail`, or `blocked`. A minor discrepancy is recorded as `pass_with_corrections` with a note. |
| **Startup** | The `corpus.startup_index` workflow: validate, survey, partition, extraction fan-out, merge, dictionary, header enrichment, map write, connection analysis, verification, evaluation, and the `workspace_started` commit gate. |
| **Source intake** | The workflow for adding new documents to an existing workspace. Converts, headers, and maps the new files without redoing everything. |
| **OCR** | Optical Character Recognition. Turns images of text (scanned PDF pages, photos of documents) into searchable text. Spinosa transcribes scans via a selected vision model, or copies them as-is. |
| **MarkItDown** | The engine that converts Office documents (Word, Excel, PowerPoint), EPUB, HTML, and text-based PDFs to markdown format. |
