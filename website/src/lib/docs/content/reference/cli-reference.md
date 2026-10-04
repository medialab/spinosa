# CLI Reference

Use the `spinosa` command to create and manage workspaces, start the TUI, connect providers, and update the framework. Run `spinosa help` for command-specific options.

## Start and inspect

```bash
spinosa /path/to/workspace  # Open Spinosa in a workspace
spinosa version             # Show the installed version
spinosa doctor              # Diagnose installation and workspace health
spinosa list                # List registered workspaces
```

## Create and update a workspace

Create a workspace from a folder of documents:

```bash
spinosa new ~/research/interviews --name interviews
```

`new` also has the alias `create`. When import finishes, use the workspace path printed by the command to open it.

Add documents to an existing workspace:

```bash
spinosa add ~/research/new-files --workspace /path/to/workspace
```

Refresh a workspace snapshot from the installed framework with `spinosa update /path/to/workspace`. Preview changes first with `--dry-run`.

Check a workspace with `spinosa status /path/to/workspace`. Remove one with `spinosa delete /path/to/workspace --yes`; a present workspace is moved to the operating system's trash.

## Providers and models

In the TUI, open the command palette with `Ctrl+P` and choose **Connect provider** or **Switch model**. From the terminal, use:

```bash
spinosa providers list
spinosa models
```

## Upgrade or uninstall

```bash
spinosa upgrade                     # Update on the current release channel
spinosa upgrade --check              # Check without installing
spinosa upgrade --channel stable     # Move to the stable channel
spinosa uninstall --yes              # Remove Spinosa; workspace folders stay
```

## Use Spinosa from another agent

Start the MCP server for Claude, Codex, Cursor, or another MCP host:

```bash
spinosa mcp-server
```

See [MCP for agents](/docs/mcp) for host setup and available tools.

## Import notes

Spinosa imports working copies into `raw/`; it leaves the source folder in place. Machine-readable PDF text is extracted locally. Scanned pages and images are transcribed only when you select a vision-capable model; otherwise they are kept without extracted text. Spinosa does not ship a local OCR engine.

When you use a cloud provider for questions or image transcription, the prompt, relevant context, or selected image content is sent to that provider.
