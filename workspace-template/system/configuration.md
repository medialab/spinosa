---
type: project_configuration
role: startup
scope: project_configuration
description: Operating profile for the current Spinosa project or framework template.,Agents read this first to learn source policy, protected paths, and setup status.
created: 2026-06-03
updated: 2026-06-05
status: active
setup_status: not_started
connects_to:
  - AGENTS.md
  - system/context.md

---

# Configuration

Agents read this before major work.

```yaml
workspace_type: research_framework
research_mode: evolving_complex_corpus
active_corpus_path: raw/
source_mode: imported_raw_corpus

source_policy: internal_first
active_corpus_policy: raw_only_after_onboarding
external_sources_allowed: no
converter_policy: local_only

claim_standard: source_link_required
l2_policy: verifier_required

protected_paths:
  - raw/
  - context.md

stale_after_days: 30
preferred_llm_cli: "[filled by CLI onboarding]"
```

## Notes
- This file is initialized by the CLI fast setup and completed by startup.
- The CLI collects: project name and preferred LLM CLI. It imports accepted files into raw/. Office documents are converted via MarkItDown; text-based PDFs via the internal pdf.js engine; scanned PDFs and images via bundled Tesseract OCR. Videos, audio, and AGENTS.md control files are skipped.
- `converter_policy: local_only` means all conversion engines (MarkItDown, Tesseract) operate offline. Cloud-dependent features (audio transcription, YouTube, Azure) are excluded at build time.
- After onboarding, normal source-grounded work starts from raw/.
- During startup, project description and helpful artifact URLs are optional. If absent, the LLM CLI agent records them as not provided, keeps external_sources_allowed at its default `no`, and infers working scope from the raw corpus.
- When setup_status reaches workspace_started, the startup workflow has built the master dictionary, created multi-level navigation maps in maps/, and passed validation.
- This file never grants permission to edit `raw/`.
