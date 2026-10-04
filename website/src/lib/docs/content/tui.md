# TUI Guide

The terminal interface is where you chat with an AI model, inspect its work, and manage a research session.

## Open a workspace

Start Spinosa in a workspace directory:

```bash
spinosa /path/to/workspace
```

If you have created more than one workspace, use the path printed by `spinosa new` or find registered workspaces with `spinosa list`.

## Ask and follow up

Type a request in the prompt and press **Enter**. Ask for source passages and file names when you need evidence. Read those passages and any stated limitations before using an answer.

To start or switch sessions, open the command palette with `Ctrl+P` and search for **New session** or **Switch session**. Type `/help` in the prompt to see available slash commands.

## Connect a provider and choose a model

Open the command palette with `Ctrl+P` and choose **Connect provider** to sign in or add credentials. Use **Switch model** to select a model from a connected provider. With a cloud provider, prompts and relevant context are sent to that service.

Default keyboard chords use `Ctrl+X` as the leader key:

| Keys               | Action                         |
| ------------------ | ------------------------------ |
| `Ctrl+P`           | Open the command palette       |
| `Ctrl+X`, then `N` | Start a new session            |
| `Ctrl+X`, then `L` | Switch sessions                |
| `Ctrl+X`, then `M` | Switch model                   |
| `Ctrl+X`, then `A` | Switch agent                   |
| `Esc`              | Interrupt the current response |

Key bindings can be changed in configuration. The command palette shows actions available in your current context.

## Useful terminal commands

```bash
spinosa list                         # List registered workspaces
spinosa add ~/research/new-files \
  --workspace /path/to/workspace     # Add documents to a workspace
spinosa doctor                       # Diagnose installation or workspace health
```

See the [CLI reference](/docs/cli-reference) for more commands.
