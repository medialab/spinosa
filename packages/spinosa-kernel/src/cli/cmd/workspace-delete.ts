import path from "node:path"
import type { Argv, CommandModule } from "yargs"
import { deleteWorkspace } from "@spinosa/core/workspace/delete"
import { getFormat, emitResult, errorOut, type OutputFormat } from "../output"

interface DeleteArgs {
  path: string | undefined
  yes?: boolean
  json?: boolean
  quiet?: boolean
}

export const WorkspaceDeleteCommand = {
  command: "delete <path>",
  aliases: ["rm"],
  describe: "Delete a Spinosa workspace (trash if present; always unregister). Requires --yes.",
  builder: (yargs: Argv) =>
    yargs
      .positional("path", { describe: "Workspace path to delete", type: "string" })
      .option("yes", {
        alias: "y",
        describe: "Confirm deletion (required)",
        type: "boolean",
        default: false,
      }),
  handler: async (args: DeleteArgs) => {
    const fmt: OutputFormat = getFormat(args)
    if (!args.path?.trim()) {
      errorOut(fmt, "Workspace path required. Use: spinosa delete /path/to/workspace --yes")
      process.exitCode = 1
      return
    }
    if (!args.yes) {
      errorOut(fmt, "Refusing to delete without --yes. Example: spinosa delete /path/to/workspace --yes")
      process.exitCode = 1
      return
    }

    const target = path.resolve(args.path)
    const result = await deleteWorkspace(target)
    if (!result.ok) {
      errorOut(fmt, result.error)
      process.exitCode = 1
      return
    }

    emitResult(
      fmt,
      "delete",
      { ...result },
      result.action === "trashed"
        ? `Trashed workspace and unregistered: ${result.path}`
        : `Unregistered workspace (${result.reason}): ${result.path}`,
    )
  },
} satisfies CommandModule<object, DeleteArgs>
