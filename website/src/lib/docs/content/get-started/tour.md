# First Research Session

This guide takes you from a folder of documents to a source-grounded answer.

## 1. Install Spinosa

Spinosa supports macOS and Linux on ARM64 or x64. Linux needs glibc 2.39 or newer. Windows and Alpine Linux are not supported.

```bash
curl -fsSL https://github.com/medialab/spinosa/releases/download/stable/install.sh | bash
```

The installer puts `spinosa` on your PATH. Open a new terminal if the command is not found.

## 2. Create a workspace

Point Spinosa at the folder with your documents:

```bash
spinosa new ~/research/interviews --name interviews
```

Spinosa scans and imports supported files into a new workspace. The command prints the workspace path when it finishes; keep that path for the next step. The originals remain in their source folder.

## 3. Connect a model and open the workspace

```bash
spinosa /path/to/workspace
```

If Spinosa asks you to connect a provider, use the command palette (`Ctrl+P`) and choose **Connect provider**. Follow the provider's sign-in or credential steps, then choose a model. Local and cloud options depend on the provider you connect.

With a cloud model, prompts and relevant context go to that provider. To transcribe scanned pages or images, choose a vision-capable model during import; those files go to that model too. Otherwise, Spinosa keeps scans and images without extracting their text.

## 4. Ask an evidence-focused question

Ask a question that names the evidence you need. For example:

```text
Compare what the interviews say about coastal erosion. Quote the passages and name their source files.
```

Simple requests may get a direct answer. Requests that need evidence may run a longer workflow and create a report. Read the quoted passages and limitations before relying on the answer.

## 5. Add documents later

```bash
spinosa add ~/research/new-interviews --workspace /path/to/workspace
```

Then reopen the workspace and ask a new question. Use `spinosa version` to see the installed release and `spinosa doctor` if you need a system diagnostic.

## Continue

- [TUI guide](/docs/tui) — navigate sessions and find commands
- [Workspace structure](/docs/workspace) — understand the imported files
- [Reports](/docs/reports) — interpret evidence and verification results
- [FAQ](/docs/faq) — setup and troubleshooting
