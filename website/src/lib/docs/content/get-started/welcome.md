# Welcome to Spinosa

Spinosa is a local-first research workspace for asking questions across a folder of documents. It imports working copies into a workspace, searches them with an AI model, and can return answers with source passages and a verification status.

Your workspace and imported files stay on your machine. If you choose a cloud model, Spinosa sends your prompt and relevant context to that provider. Scanned PDFs and images need a vision-capable model to extract text; those files are sent to that model. Without one, Spinosa keeps them as files and does not transcribe them. Spinosa does not include a local OCR engine.

## Quick start

Spinosa supports macOS and Linux on Apple Silicon/ARM64 and Intel/AMD64. Linux requires glibc 2.39 or newer (Ubuntu 24.04+). Windows and Alpine Linux are not supported.

Install the stable release:

```bash
curl -fsSL https://github.com/medialab/spinosa/releases/download/stable/install.sh | bash
```

Create a workspace from your document folder:

```bash
spinosa new ~/research/interviews --name interviews
```

When the command finishes, use the workspace path it prints to start Spinosa:

```bash
spinosa /path/to/workspace
```

If no model is connected, open the command palette with `Ctrl+P`, choose **Connect provider**, and follow the sign-in or credential steps. Then ask a question such as “Find evidence in my sources about coastal erosion and quote the passages.”

## Use the answer carefully

Read the cited passages and limitations alongside the answer. A verification status describes the checks Spinosa completed; it does not guarantee that an answer is complete or correct.

## Next steps

- [First research session](/docs/tour) — create a workspace, ask a question, and add files
- [TUI guide](/docs/tui) — sessions, models, agents, and command discovery
- [Workspace structure](/docs/workspace) — where imported files and reports live
- [Reports](/docs/reports) — evidence, verification statuses, and charts
- [CLI reference](/docs/cli-reference) — workspace and maintenance commands
- [MCP for agents](/docs/mcp) — use Spinosa from an external MCP host
