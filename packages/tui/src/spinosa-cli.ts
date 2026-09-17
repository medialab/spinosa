#!/usr/bin/env bun
import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { bootLog, installProcessFailureLogs } from "@spinosa/kernel-core/observability/boot-log"
import {
  createWorkspace,
  getFrameworkHealth,
  isSpinosaWorkspace,
  readFrameworkVersionFromRoot,
  readWorkspaceMeta,
  resolveFrameworkRoot,
  updateWorkspace,
  writeWorkspaceStatus,
} from "@spinosa/core"
import { addFiles } from "@spinosa/core/commands/add"
import { runOnboarding } from "@spinosa/core/commands/onboard"
import { detectDocumentTools } from "@spinosa/core/scan/scanner"
import { parseSpinosaCliArgs, type ParsedArgs } from "./spinosa-cli/parser"
import type { UpdateResult } from "@spinosa/core/commands/update"
import { createIo, emitResult, type SpinosaCliIo } from "./spinosa-cli/io"
import { runUninstall } from "./spinosa-cli/commands/uninstall"
import { runStatus } from "./spinosa-cli/commands/status"
import { runList } from "./spinosa-cli/commands/list"
import { runStartupAutoclean } from "./spinosa-cli/commands/startup-autoclean"
import { runLaunchPreflight } from "./spinosa-cli/commands/preflight"

export { parseSpinosaCliArgs }

export type { SpinosaCliIo, ParsedArgs }

installProcessFailureLogs()

const leadingGlobalFlags = new Set(["--json", "--quiet", "--no-color"])

export function splitSpinosaCliCommand(args: string[]): { command: string; rest: string[] } {
  const globals: string[] = []
  let index = 0
  while (index < args.length && leadingGlobalFlags.has(args[index]!)) globals.push(args[index++]!)
  return {
    command: args[index] ?? "help",
    rest: [...globals, ...args.slice(index + 1)],
  }
}

function helpText(): string {
  return [
    "Spinosa \u2014 local-first research workspace framework",
    "",
    "Usage:",
    "  spinosa                         Open dashboard",
    "  spinosa new|create <source> [--extensions ext,...] [--cli name] [--launch copy|run]",
    "  spinosa add <source> [--workspace path] [--file path|--dir path] [--extensions ext,...]",
    "  spinosa update [workspace] [--dry-run] [--force] [--yes]",
    "  spinosa doctor [--workspace path]",
    "  spinosa status [workspace]",
    "  spinosa list",
    "  spinosa startup-autoclean [--dry-run]",
    "  spinosa version",
    "  spinosa uninstall [--yes]",
    "",
    "Global flags:",
    "  --json       Machine-readable JSON output",
    "  --quiet      Exit code only, no output",
  ].join("\n")
}

function requiredFrameworkRoot(): string {
  const root = resolveFrameworkRoot()
  if (!root) throw new Error("Spinosa framework root not found. Reinstall Spinosa or set SPINOSA_TEMPLATE_ROOT.")
  return root
}

function runVersion(io: SpinosaCliIo): number {
  const version = readFrameworkVersionFromRoot(requiredFrameworkRoot())
  if (io.format === "json") {
    emitResult(io, "version", { version }, `spinosa ${version}`)
  } else {
    io.out(`spinosa ${version}`)
  }
  return 0
}

async function runCreate(parsed: ParsedArgs, io: SpinosaCliIo): Promise<number> {
  const source = parsed.positionals[0]
  if (!source) throw new Error("Source directory required. Use: spinosa new /path/to/documents")
  const sourcePath = path.resolve(source)
  if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) throw new Error(`Source directory does not exist: ${sourcePath}`)

  const frameworkRoot = requiredFrameworkRoot()
  const created = await createWorkspace({
    corpusPath: sourcePath,
    frameworkRoot,
    workspaceName: parsed.values.get("name"),
    onProgress: (message) => io.out(message),
  })
  if (!created.success) throw new Error("Workspace template copy failed")
  await writeWorkspaceStatus(created.workspacePath, "importing")

  const onboarding = await runOnboarding({
    workspacePath: created.workspacePath,
    frameworkRoot,
    sourcePath,
    projectTitle: created.projectName,
    flagExtensions: parsed.values.get("extensions"),
    flagCli: parsed.values.get("cli"),
    flagLaunch: parsed.values.get("launch") as "copy" | "run" | undefined,
    onPhase: (_phase, message) => io.out(message),
  })
  if (!onboarding.success) {
    throw new Error(onboarding.blockerReason ?? `Onboarding failed during ${onboarding.blockedPhase ?? "unknown phase"}`)
  }

  emitResult(io, "create", { workspacePath: created.workspacePath, project: created.projectName }, `Workspace ready: ${created.workspacePath}`)
  return 0
}

async function runAdd(parsed: ParsedArgs, io: SpinosaCliIo): Promise<number> {
  const workspacePath = path.resolve(parsed.values.get("workspace") ?? process.cwd())
  if (!isSpinosaWorkspace(workspacePath)) throw new Error(`Not a Spinosa workspace: ${workspacePath}`)
  const sourceValue = parsed.values.get("file") ?? parsed.values.get("dir") ?? parsed.positionals[0]
  if (!sourceValue) throw new Error("Source file or directory required")
  const sourcePath = path.resolve(sourceValue)
  if (!existsSync(sourcePath)) throw new Error(`Source path does not exist: ${sourcePath}`)
  const sourceIsDir = parsed.values.has("dir") || statSync(sourcePath).isDirectory()

  const result = await addFiles({
    workspacePath,
    sourcePath,
    sourceIsDir,
    extensions: parsed.values.get("extensions"),
    overwrite: parsed.flags.has("overwrite"),
    onProgress: (message) => io.out(message),
  })
  const delivered = result.copied + result.mdConverted + result.ocrConverted
  const skipped = result.skipped + result.mdSkipped + result.ocrSkipped
  const failed = result.failed + result.mdFailed + result.ocrFailed

  emitResult(io, "add", { delivered, skipped, failed, workspacePath }, `Import: ${delivered} delivered, ${skipped} skipped, ${failed} failed`)
  return result.success ? 0 : 1
}

async function runUpdate(parsed: ParsedArgs, io: SpinosaCliIo): Promise<number> {
  const workspacePath = path.resolve(parsed.values.get("workspace") ?? parsed.positionals[0] ?? process.cwd())
  if (!isSpinosaWorkspace(workspacePath)) throw new Error(`Not a Spinosa workspace: ${workspacePath}`)
  const result = await updateWorkspace({
    workspacePath,
    frameworkRoot: requiredFrameworkRoot(),
    dryRun: parsed.flags.has("dry-run"),
    force: parsed.flags.has("force"),
    onPhase: (_phase, detail) => io.out(detail),
  })
  emitResult(io, "update", { ...result as unknown as Record<string, unknown> }, `Update: ${result.added} added, ${result.updated} updated, ${result.removed} removed, ${result.skipped} preserved`)
  return result.success ? 0 : 1
}

async function runDoctor(parsed: ParsedArgs, io: SpinosaCliIo): Promise<number> {
  const frameworkRoot = resolveFrameworkRoot()
  let healthy = Boolean(frameworkRoot)
  io.out(`Framework: ${frameworkRoot ?? "not found"}`)
  io.out(`Version: ${readFrameworkVersionFromRoot(frameworkRoot)}`)
  const tools = await detectDocumentTools()
  for (const [name, available] of Object.entries(tools)) {
    io.out(`${name}: ${available ? "ok" : "missing"}`)
    if (!available) healthy = false
  }

  const requestedWorkspace = parsed.values.get("workspace")
  const workspacePath = requestedWorkspace ? path.resolve(requestedWorkspace) : process.cwd()
  if (requestedWorkspace || isSpinosaWorkspace(workspacePath)) {
    const meta = await readWorkspaceMeta(workspacePath)
    if (!meta) {
      io.error(`Workspace: invalid (${workspacePath})`)
      healthy = false
    } else {
      io.out(`Workspace: ${workspacePath}`)
      io.out(`Workspace version: ${meta.frameworkVersion}`)
      for (const check of getFrameworkHealth(workspacePath)) {
        if (!check.ok) healthy = false
        io.out(`${check.ok ? "ok" : "missing"}: ${check.label}`)
      }
    }
  }

  emitResult(io, "doctor", { healthy, frameworkRoot, version: readFrameworkVersionFromRoot(frameworkRoot) }, healthy ? "healthy" : "issues found")
  return healthy ? 0 : 1
}

export async function runSpinosaCli(args: string[], io?: SpinosaCliIo): Promise<number> {
  bootLog("spinosa-cli.run", "spinosa-cli invoked", { args: args.join(" "), pid: process.pid })
  const { command, rest } = splitSpinosaCliCommand(args)
  try {
    if (command === "help" || command === "--help" || command === "-h" || rest.includes("--help") || rest.includes("-h")) {
      const out = io ?? { out: (m: string) => process.stdout.write(`${m}\n`), error: (m: string) => process.stderr.write(`${m}\n`), format: "human" as const }
      out.out(helpText())
      return 0
    }
    const parsed = parseSpinosaCliArgs(rest)
    const resolvedIo = io ?? createIo(parsed)

    switch (command) {
      case "new":
      case "create":
        return await runCreate(parsed, resolvedIo)
      case "add":
        return await runAdd(parsed, resolvedIo)
      case "update":
        return await runUpdate(parsed, resolvedIo)
      case "doctor":
        return await runDoctor(parsed, resolvedIo)
      case "uninstall":
        return await runUninstall(resolvedIo, parsed.flags.has("yes"))
      case "status":
        return await runStatus(parsed.values.get("workspace") ?? parsed.positionals[0], resolvedIo)
      case "list":
        return await runList(resolvedIo)
      case "startup-autoclean":
      case "autoclean":
        return await runStartupAutoclean({ io: resolvedIo, dryRun: parsed.flags.has("dry-run") })
      case "preflight":
        await runLaunchPreflight()
        return 0
      case "version":
      case "--version":
        return runVersion(resolvedIo)
      default:
        throw new Error(`Unknown Spinosa command: ${command}`)
    }
  } catch (error) {
    const out = io ?? { out: (m: string) => process.stdout.write(`${m}\n`), error: (m: string) => process.stderr.write(`${m}\n`), format: "human" as const }
    out.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  bootLog("spinosa-cli.main", "direct entry", { argv: argv.join(" ") })
  process.exit(await runSpinosaCli(argv))
}
