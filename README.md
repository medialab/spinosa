<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="workspace-template/assets/Banner_Spinosa_new.png">
    <img src="workspace-template/assets/Banner_Spinosa_new.png" alt="Spinosa Framework" width="100%">
  </picture>
</p>

# Spinosa

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Spinosa is a local research workspace for people who work with document collections — interviews, field notes, PDFs, reports, transcripts. You ask questions in plain language. AI agents search your files, draft answers, and verify every claim against the original text.

**Local-first by design.** Your workspace files and indexes stay on your machine. When you connect a cloud model provider, prompts and context are sent to that provider for inference.

---

## Who it's for

Spinosa was built at [médialab Sciences Po](https://medialab.sciencespo.fr/) for researchers who need to extract, compare, and verify information across hundreds of documents. It works for:

- **Social scientists** analysing interview transcripts, field notes, or survey responses
- **Journalists** cross-referencing leaked documents, reports, and public records
- **Legal researchers** reviewing case files, rulings, and evidence bundles
- **Anyone** with a folder of PDFs who needs answers grounded in their own sources

If you have a research question and a folder of documents, Spinosa gives you a terminal-based workspace where an AI assistant reads, searches, and writes reports — while a dedicated verifier checks every claim back against the originals.

---

## Why Spinosa exists

LLMs are good at answering questions. They are bad at knowing where their answers came from. Spinosa solves that by giving the AI a structured workspace on top of your actual files — so every answer traces back to a source you provided.

The design is local-first. Workspace files and indexes remain on your machine. When you select a cloud model, the prompts and context sent to that model are processed by the selected provider. The workspace is a folder on disk. The agents communicate through files, not hidden memory, so their work is inspectable and auditable.

---

## Cold start

```bash
# 1. Install (macOS / Linux) — downloads a platform binary (no Bun required)

# Current channel — beta (stable lands after the first stable cut)
# Download first, then execute — ensures the full script is fetched before any
# installation runs and lets curl enforce connection/transfer deadlines.
curl -fsSL --connect-timeout 30 --max-time 600 --retry 3 --retry-delay 2 \
  https://github.com/medialab/spinosa/releases/download/beta/install.sh \
  -o /tmp/spinosa-install.sh && bash /tmp/spinosa-install.sh

# Pin an immutable version when you need reproducibility (e.g. v1.0.3-beta.13):
# curl -fsSL --connect-timeout 30 --max-time 600 --retry 3 --retry-delay 2 \
#   https://github.com/medialab/spinosa/releases/download/v1.0.3-beta.13/install.sh \
#   -o /tmp/spinosa-install.sh && bash /tmp/spinosa-install.sh

# 2. Launch the dashboard
spinosa
```

Supported install platforms: macOS and Linux (glibc) on `arm64` / `x64`. The installer verifies SHA-256 checksums and installs `~/.spinosa/bin/spinosa` plus a PATH shim. Workspace templates ship embedded in the binary.

**Source installs from older betas:** re-run the installer once. Metadata and registered workspaces are preserved; dormant `~/.spinosa/versions/` trees are not deleted automatically.

Developers working from a git checkout still use `bun run dev` (see [DEVELOPMENT.md](DEVELOPMENT.md)).

The first time you run `spinosa`, you'll see the workspace picker. Click **+ New workspace** and follow the 11-step wizard: choose your document folder, name the workspace, verify the document converters are installed, review what was found, and select your AI coding tool (Claude Code, OpenCode, Gemini, Ollama, etc.).

When the wizard finishes, a chat prompt appears. Type your first question.

---

## What it does

| You have... | Spinosa gives you... |
|---|---|
| 200 PDFs from field research | A searchable workspace that knows every file |
| "What did participants say about X?" | A report with quotes, source paths, and a verification badge |
| Concerns about accuracy | Every claim checked against the original file by a dedicated verifier |
| New files later | Add them without starting over — the workspace updates in place |

---

## Panels and features

### Chat session
The main conversation view. Type a question, get a report back with evidence quotes, analysis, and a verification status. Reports are rendered inline — you can read, scroll, or ask follow-ups in the same thread.

### Workspace picker
Press `W` to see all your registered workspaces in a sortable table. Each row shows the workspace name, parent folder, setup status, framework version, and last access time. Use **Delete stale** to clean up entries pointing to deleted folders.

### Onboarding wizard
An 11-step guided flow that takes you from a folder of raw documents to a fully indexed workspace. It scans your files, classifies them by type (text, Office, PDF, image), runs the appropriate converters, and prepares the workspace for chat.

### Add-files wizard
Press `I` to add new documents to an existing workspace. The wizard runs the same conversion pipeline as the initial setup — scan, classify, convert, and integrate.

### Visualizer
Three view modes:
- **Files** (`1`) — heatmap of which documents were accessed during a session
- **Flow** (`2`) — graph of tool calls the agents made, in sequence
- **Activity** (`3`) — timeline of the conversation

Use `+` / `-` to zoom, drag to pan, and `Enter` to inspect individual tool calls.

### Agents panel
Press `A` to see which agents are available and switch between them. The orchestrator selects the right agents automatically based on your question, but you can also configure custom pipelines.

### Model provider
Press `K` to connect your preferred AI provider (local via Ollama/oMLX, or cloud via OpenAI, Anthropic, Google, GitHub Copilot). Press `M` to switch between configured models.

---

## Quick reference

| What you want | How |
|---|---|
| Launch the TUI | `spinosa` |
| Create a workspace from the terminal | `spinosa create ~/research/papers` |
| Add more files | `spinosa add ~/research/more-papers` |
| Update the framework | `spinosa upgrade` (checks on launch; prompts when newer) |
| List workspaces | `spinosa list` |
| Check system health | `spinosa doctor` |

---

## Supported formats

PDFs, Word docs, spreadsheets, presentations, EPUB, HTML, ZIP, Outlook messages, images (OCR), CSVs, Markdown — all converted to searchable text.

## Requirements

- macOS or Linux
- ~500 MB disk space for the framework and dependencies
- An AI model provider (local or cloud)

## Links

- [Documentation](https://medialab.github.io/spinosa/)
- [Development guide](DEVELOPMENT.md) — local setup, testing, and release commands
- [Contributing](CONTRIBUTING.md)
- [License (MIT)](LICENSE)
