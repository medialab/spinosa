import path from "node:path"
import { existsSync, statSync } from "node:fs"
import type { Argv, CommandModule } from "yargs"
import { createWorkspace } from "@spinosa/core/commands/create"
import { runOnboarding } from "@spinosa/core/commands/onboard"
import { resolveFrameworkRoot } from "@spinosa/core/framework/discovery"
import { writeWorkspaceStatus, readWorkspaceMeta } from "@spinosa/core/workspace/meta"
import { getFormat, logProgress, emitResult, errorOut, type OutputFormat } from "../output"

interface NewArgs {
  source: string | undefined
  name?: string
  extensions?: string
  cli?: string
  launch?: string
  json?: boolean
  quiet?: boolean
}

export const WorkspaceNewCommand = {
  command: "new <source>",
  aliases: ["create"],
  describe: "Create a new Spinosa workspace from a source directory",
  builder: (yargs: Argv) =>
    yargs
      .positional("source", { describe: "Path to source documents directory", type: "string" })
      .option("name", { describe: "Workspace name", type: "string" })
      .option("extensions", { describe: "File extensions to import (comma-separated)", type: "string" })
      .option("cli", { describe: "Preferred CLI name for startup handoff (default: opencode)", type: "string" })
      .option("launch", {
        describe: "Handoff mode: copy (default, agent-safe) or run (needs a TTY)",
        type: "string",
        choices: ["copy", "run"] as const,
        default: "copy",
      }),
  handler: async (args: NewArgs) => {
    const fmt: OutputFormat = getFormat(args)
    if (!args.source) throw new Error("Source directory required. Use: spinosa new /path/to/documents")
    const sourcePath = path.resolve(args.source)
    if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
      throw new Error(`Source directory does not exist: ${sourcePath}`)
    }

    const launch = (args.launch ?? "copy") as "copy" | "run"
    if (launch === "run" && !process.stdin.isTTY) {
      errorOut(fmt, "Cannot use --launch run without a TTY. Pass --launch copy (default) for headless/agent use.")
      process.exitCode = 1
      return
    }

    const frameworkRoot = resolveFrameworkRoot()
    if (!frameworkRoot) throw new Error("Spinosa framework root not found. Reinstall Spinosa or set SPINOSA_TEMPLATE_ROOT.")

    if (!args.extensions) {
      logProgress(fmt, "batch_selection", "No --extensions flag; importing all scanned file types")
    }

    const created = await createWorkspace({
      corpusPath: sourcePath,
      frameworkRoot,
      workspaceName: args.name,
      onProgress: (message: string) => logProgress(fmt, "create", message),
    })
    if (!created.success) throw new Error("Workspace template copy failed")
    await writeWorkspaceStatus(created.workspacePath, "importing")

    const onboarding = await runOnboarding({
      workspacePath: created.workspacePath,
      frameworkRoot,
      sourcePath,
      projectTitle: created.projectName,
      flagExtensions: args.extensions,
      flagCli: args.cli,
      flagLaunch: launch,
      onPhase: (phase: string, message: string) => logProgress(fmt, phase, message),
      onCopyProgress: (phase, current, total, relPath, status) =>
        logProgress(fmt, phase, `${current}/${total} ${relPath}${status ? ` (${status})` : ""}`, {
          current,
          total,
          path: relPath,
          status,
        }),
    })
    if (!onboarding.success) {
      throw new Error(onboarding.blockerReason ?? `Onboarding failed during ${onboarding.blockedPhase ?? "unknown phase"}`)
    }

    const meta = await readWorkspaceMeta(created.workspacePath)
    emitResult(
      fmt,
      "create",
      {
        workspacePath: created.workspacePath,
        project: created.projectName,
        setupStatus: meta?.setupStatus ?? "cli_started",
        cli: onboarding.cli,
        handoffResult: onboarding.handoffResult,
        scanCounts: onboarding.scanCounts,
        verify: onboarding.verify,
      },
      `Workspace ready: ${created.workspacePath}`,
    )
  },
} satisfies CommandModule<object, NewArgs>
