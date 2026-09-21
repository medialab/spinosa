# FAQ

## Install and setup

**Command not found: `spinosa`**
Make sure `~/.spinosa/bin` is on your `PATH`, then open a new terminal. If it still fails, re-run the install script.

**I installed Spinosa, but `spinosa` opens something unexpected**
Make sure you have the latest version by running `spinosa upgrade`.

**The TUI looks garbled or misaligned**
Your terminal needs to support Unicode and true color (24-bit). Most modern terminals do. If you're using an older terminal, try a different one (iTerm2, Kitty, Alacritty, or the latest Terminal.app).

## TUI usage

**How do I create a workspace?**
Press `W` to open the workspace picker, then click **+ New workspace**. The onboarding wizard guides you through the steps.

**How do I add more documents to an existing workspace?**
Press `I` from the home screen, or run `spinosa add <folder>` from the terminal.

**How do I switch between workspaces?**
Press `W` to open the workspace picker, then select a different workspace.

**How do I change the AI model?**
Press `K` to configure providers, then `M` to switch between models.

**What are the keyboard shortcuts?**
Press `?` or `Ctrl+P` and type `/help` to see all shortcuts. Key ones: `S` Settings, `A` Agents, `K` Keys, `W` Workspaces, `M` Models, `N` New session, `I` Import files.

## Startup and indexing

**Startup takes too long**
Startup time depends on corpus size and file mix. If it stalls, cancel and start again — Spinosa resumes rather than starting over.

**The OCR output is garbled**
Check the original image quality. Blurry, low-contrast, or skewed images produce poor OCR. Replace the source and re-run intake.

**Can I add more files after creating a workspace?**
Yes. Press `I` in the TUI or run `spinosa add <folder>`.

## Reports

**My question returned a short answer instead of a full report**
Ask more explicitly for evidence from your documents. Operational questions get fast answers; evidence requests trigger the full pipeline.

**I see `○ pending` on a report**
The draft exists but verification hasn't finished. Wait for the Verifier before treating it as settled.

**The report says `⚠ corrections` or `✗ failed`**
This is a real signal, not decoration. `⚠ corrections` means verification found issues but repaired them. `✗ failed` means important claims couldn't be supported.

**I know the answer is in my files, but Spinosa found nothing**
Rephrase using alternative words, names, or dates. If it persists, try re-indexing: press `I` or run `spinosa add` on the same folder.

## External agents (MCP)

**Can I use Spinosa from Claude, Codex, or Cursor?**
Yes. Run `spinosa mcp-server` as an MCP server. The host model stays the LLM; Spinosa exposes workspace tools and skills. See [MCP for agents](/spinosa/docs/mcp).

**Does the MCP search my documents for me?**
No. The host agent searches `raw/` with its own tools, guided by Spinosa skill playbooks. MCP provides workspace selection, skills, and checks such as `spinosa_gate` and `spinosa_verify`.

## Maintenance

**How do I update Spinosa?**
Run `spinosa upgrade` to install the latest release. When you launch `spinosa` or run `bun run dev`, you will see `checking for updates...` before the TUI opens. Use `spinosa upgrade --check` to check without installing.

**How do I clean up stale workspace entries?**
Open the workspace picker (`W`) and click **Delete stale** in the top header. This removes entries pointing to deleted folders.

**Can I uninstall without losing my workspaces?**
Yes. `spinosa uninstall --yes` removes the framework runtime under `~/.spinosa` (and application cache/data under XDG paths) but leaves your workspace folders and `~/.spinosa/metadata/` in place.

**Where are my workspaces stored?**
Each workspace is a folder on your filesystem. You choose the location during creation. The global workspace registry is at `~/.spinosa/metadata/workspaces.json`.
