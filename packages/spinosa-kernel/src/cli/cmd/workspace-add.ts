import path from "node:path"
import { existsSync, statSync } from "node:fs"
import type { Argv, CommandModule } from "yargs"
import { addFiles } from "@spinosa/core/commands/add"
import { isSpinosaWorkspace } from "@spinosa/core/workspace/meta"
import { getFormat, logProgress, emitResult, type OutputFormat } from "../output"

interface AddArgs {
  source?: string
  workspace?: string
  file?: string
  dir?: string
  extensions?: string
  overwrite?: boolean
  json?: boolean
  quiet?: boolean
}

export const WorkspaceAddCommand = {
  command: "add [source]",
  describe: "Add files or directories to a Spinosa workspace",
  builder: (yargs: Argv) =>
    yargs
      .positional("source", { describe: "Source file or directory path", type: "string" })
      .option("workspace", { describe: "Path to the workspace (default: cwd)", type: "string" })
      .option("file", { describe: "Source file path", type: "string" })
      .option("dir", { describe: "Source directory path", type: "string" })
      .option("extensions", { describe: "File extensions to include", type: "string" })
      .option("overwrite", { describe: "Overwrite existing files", type: "boolean", default: false }),
  handler: async (args: AddArgs) => {
    const fmt: OutputFormat = getFormat(args)
    const workspacePath = path.resolve(args.workspace ?? process.cwd())
    if (!isSpinosaWorkspace(workspacePath)) throw new Error(`Not a Spinosa workspace: ${workspacePath}`)

    const sourceValue = args.file ?? args.dir ?? args.source
    if (!sourceValue) throw new Error("Source file or directory required")
    const sourcePath = path.resolve(sourceValue)
    if (!existsSync(sourcePath)) throw new Error(`Source path does not exist: ${sourcePath}`)
    const sourceIsDir = Boolean(args.dir) || statSync(sourcePath).isDirectory()

    const result = await addFiles({
      workspacePath,
      sourcePath,
      sourceIsDir,
      extensions: args.extensions,
      overwrite: Boolean(args.overwrite),
      onProgress: (message: string) => logProgress(fmt, "add", message),
      onFileProgress: (phase, current, total, relPath, status) =>
        logProgress(fmt, phase, `${current}/${total} ${relPath}${status ? ` (${status})` : ""}`, {
          current,
          total,
          path: relPath,
          status,
        }),
    })
    const delivered = result.copied + result.mdConverted + result.ocrConverted
    const skipped = result.skipped + result.mdSkipped + result.ocrSkipped
    const failed = result.failed + result.mdFailed + result.ocrFailed

    emitResult(fmt, "add", { delivered, skipped, failed, workspacePath }, `Import: ${delivered} delivered, ${skipped} skipped, ${failed} failed`)
    if (!result.success) process.exitCode = 1
  },
} satisfies CommandModule<object, AddArgs>
