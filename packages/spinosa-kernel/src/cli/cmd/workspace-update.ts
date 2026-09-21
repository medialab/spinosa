import path from "node:path"
import type { Argv, CommandModule } from "yargs"
import { isSpinosaWorkspace } from "@spinosa/core/workspace/meta"
import { resolveFrameworkRoot } from "@spinosa/core/framework/discovery"
import { updateWorkspace } from "@spinosa/core/commands/update"
import { getFormat, emitResult, logProgress, type OutputFormat } from "../output"

interface UpdateArgs {
  workspace?: string
  "dry-run"?: boolean
  force?: boolean
  json?: boolean
  quiet?: boolean
}

export const WorkspaceUpdateCommand = {
  command: "update [workspace]",
  describe: "Update a workspace snapshot",
  builder: (yargs: Argv) =>
    yargs
      .positional("workspace", { describe: "Workspace path (default: cwd)", type: "string" })
      .option("dry-run", { describe: "Show what would change without making changes", type: "boolean", default: false })
      .option("force", { describe: "Bypass safety checks", type: "boolean", default: false }),
  handler: async (args: UpdateArgs) => {
    const fmt: OutputFormat = getFormat(args)
    const workspacePath = path.resolve(args.workspace ?? process.cwd())
    if (!isSpinosaWorkspace(workspacePath)) throw new Error(`Not a Spinosa workspace: ${workspacePath}`)

    const frameworkRoot = resolveFrameworkRoot()
    if (!frameworkRoot) throw new Error("Spinosa framework root not found")

    const result = await updateWorkspace({
      workspacePath,
      frameworkRoot,
      dryRun: Boolean(args["dry-run"]),
      force: Boolean(args.force),
      onPhase: (_phase: string, detail: string) => logProgress(fmt, _phase, detail),
    })
    emitResult(fmt, "update", { ...(result as unknown as Record<string, unknown>) }, `Update: ${result.added} added, ${result.updated} updated, ${result.removed} removed, ${result.skipped} preserved`)
    if (!result.success) process.exitCode = 1
  },
} satisfies CommandModule<object, UpdateArgs>
