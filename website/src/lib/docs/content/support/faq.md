# FAQ

## Install and setup

**Which platforms are supported?**
Spinosa supports macOS and Linux on ARM64 or x64. Linux needs glibc 2.39 or newer. Windows, Alpine Linux, and other musl-based systems are not supported.

**The `spinosa` command is not found.**
Open a new terminal so it reloads your PATH. The installer adds `~/.spinosa/bin`; if the command still fails, rerun the stable installer.

**How do I start?**
Create a workspace with `spinosa new ~/path/to/documents`, then start it with `spinosa /path/to/workspace`. The first command prints the workspace path.

**How do I connect a model?**
Open the TUI command palette with `Ctrl+P` and choose **Connect provider**. Follow the sign-in or credential steps, then choose a model.

## Documents and privacy

**Are my documents uploaded?**
Imported copies and workspace files stay on your machine. If you choose a cloud model, Spinosa sends your prompt and relevant context to that provider. A cloud vision model also receives selected images when it transcribes scans.

**Does Spinosa include OCR?**
No local OCR engine is bundled. Machine-readable PDF text is extracted locally. Scanned PDFs and images are transcribed only with a selected vision-capable model; otherwise they are kept without extracted text.

**How do I add more documents?**
Run `spinosa add ~/path/to/new-files --workspace /path/to/workspace`.

## Answers and reports

**Why did I get a short answer instead of a report?**
Simple requests may get a direct answer. Ask for quoted evidence, source file paths, and limitations when you need a research report.

**What do report statuses mean?**
`pass` means claims were verified without corrections; `pass_with_corrections` means minor corrections were applied; `partial` means evidence gaps remain; `fail` means important claims did not hold; and `blocked` means required sources were unavailable. Read the sources and limitations alongside every status.

**Spinosa did not find a source I expected.**
Try alternate names or terms, or narrow the question to a date range or source group. Confirm the document is in the workspace's `raw/` folder. If you add or replace files, run `spinosa add` again.

## Updates and workspace care

**How do I update Spinosa?**
Run `spinosa upgrade`. To check without installing, run `spinosa upgrade --check`. To switch from beta to stable, run `spinosa upgrade --channel stable`.

**How do I check for installation problems?**
Run `spinosa doctor` and follow the diagnostic output.

**Can I uninstall without deleting my workspaces?**
Yes. `spinosa uninstall --yes` removes the Spinosa runtime and leaves your workspace folders in place.

**Where are my workspaces?**
Each workspace is a folder created on your machine. `spinosa list` shows registered workspaces; the registry is stored under `~/.spinosa/metadata/`.

## External agents (MCP)

**Can I use Spinosa with Claude, Codex, or Cursor?**
Yes. Configure `spinosa mcp-server` in your MCP host. The host agent supplies the model; Spinosa provides workspace tools and skills. See [MCP for agents](/docs/mcp).
