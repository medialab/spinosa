import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { cleanMacMetadata } from "../utils/fs"
import { recordFrameworkChecksums } from "../framework/checksums"
import { copyFrameworkManifestPaths } from "../framework/manifest"
import { registerWorkspace, writeSetupFiles } from "../workspace/registry"
import { writeWorkspaceStatus } from "../workspace/meta"
import { createWorkspaceID, ensureWorkspaceID } from "../workspace/identity"
import { spinosaLogInfo } from "../utils/log"
import { readFrameworkVersionFromRoot, resolveTemplateRootFromFrameworkRoot } from "../framework/discovery"
import { throwIfSpinosaCancelled } from "../import/cancellation"

export interface CreateWorkspaceOptions {
  corpusPath: string
  frameworkRoot: string
  extensions?: string
  preferredCli?: string
  launch?: "copy" | "run"
  workspaceName?: string
  resumeWorkspacePath?: string
  onProgress?: (message: string) => void
  onRecover?: (message: string) => void
  shouldAbort?: () => boolean
}

export interface CreateWorkspaceResult {
  workspacePath: string
  projectName: string
  success: boolean
  resumed?: boolean
}

function resumableWorkspace(candidate: string, corpusPath: string): boolean {
  const markerPath = path.join(candidate, ".spinosa", "workspace")
  if (existsSync(markerPath)) {
    try {
      const marker = readFileSync(markerPath, "utf-8")
      const status = marker.match(/^setup_status:\s*(.+)$/m)?.[1]?.trim()
      const source = marker.match(/^source_location:\s*(.+)$/m)?.[1]?.trim()
      if (status === "importing" && source === path.resolve(corpusPath)) return true
    } catch {}
  }
  // Single source of truth is system/configuration.md — check there as fallback
  const configPath = path.join(candidate, "system", "configuration.md")
  if (existsSync(configPath)) {
    try {
      const config = readFileSync(configPath, "utf-8")
      const status = config.match(/^setup_status:\s*(.+)$/m)?.[1]?.trim()
      // source_location lives in .spinosa/workspace, so also check there for source
      const markerSource = existsSync(markerPath) ? readFileSync(markerPath, "utf-8").match(/^source_location:\s*(.+)$/m)?.[1]?.trim() : undefined
      return status === "importing" && markerSource === path.resolve(corpusPath)
    } catch {}
  }
  return false
}

export function resolveWorkspacePath(corpusPath: string, workspaceName?: string): string {
  const resolvedCorpus = path.resolve(corpusPath)
  const corpusName = path.basename(resolvedCorpus)
  const parentDir = path.dirname(resolvedCorpus)
  const baseName = workspaceName?.trim() || `${corpusName}-spinosa`

  let workspacePath = path.join(parentDir, baseName)
  if (resumableWorkspace(workspacePath, resolvedCorpus)) return workspacePath
  let n = 2
  while (existsSync(workspacePath)) {
    workspacePath = path.join(parentDir, `${baseName}-${n}`)
    n++
  }

  return workspacePath
}

const MAX_WORKSPACE_NAME_LENGTH = 120

/**
 * Reject names that could escape the intended workspace parent (path
 * components, absolute paths) or that filesystems cannot represent safely.
 */
export function assertSafeWorkspaceName(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error("Workspace name must not be empty")
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error(`Invalid workspace name ${JSON.stringify(name)}`)
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new Error(`Invalid workspace name ${JSON.stringify(name)}: must not contain path separators`)
  }
  if (trimmed.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new Error(`Workspace name must be at most ${MAX_WORKSPACE_NAME_LENGTH} characters`)
  }
}

function reserveWorkspacePath(corpusPath: string, workspaceName?: string, resumeWorkspacePath?: string): { path: string; resumed: boolean } {
  const resolvedCorpus = path.resolve(corpusPath)
  if (resumeWorkspacePath) {
    const candidate = path.resolve(resumeWorkspacePath)
    if (!resumableWorkspace(candidate, resolvedCorpus)) {
      throw new Error(`Workspace cannot be resumed from ${candidate}`)
    }
    return { path: candidate, resumed: true }
  }
  const corpusName = path.basename(resolvedCorpus)
  const parentDir = path.dirname(resolvedCorpus)
  if (workspaceName) assertSafeWorkspaceName(workspaceName)
  const baseName = workspaceName?.trim() || `${corpusName}-spinosa`

  let n = 1
  while (true) {
    const suffix = n === 1 ? "" : `-${n}`
    const candidate = path.join(parentDir, `${baseName}${suffix}`)
    if (resumableWorkspace(candidate, resolvedCorpus)) return { path: candidate, resumed: true }
    try {
      mkdirSync(candidate)
      return { path: candidate, resumed: false }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        n++
        continue
      }
      throw error
    }
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function materializePlaceholders(workspacePath: string): void {
  for (const relPath of ["AGENTS.md", "CLAUDE.md"]) {
    const filePath = path.join(workspacePath, relPath)
    if (!existsSync(filePath)) continue
    let content = readFileSync(filePath, "utf-8")
    const updated = content.replaceAll("{{WORKSPACE_PATH}}", workspacePath)
    if (updated !== content) writeFileSync(filePath, updated, "utf-8")
  }
  const hermesConfig = path.join(workspacePath, ".hermes", "workspace.config.yaml")
  if (existsSync(hermesConfig)) {
    let content = readFileSync(hermesConfig, "utf-8")
    const updated = content.replaceAll("{{SPINOSA_WORKSPACE}}", workspacePath)
    if (updated !== content) writeFileSync(hermesConfig, updated, "utf-8")
  }
}

export async function createWorkspace(options: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
  const { corpusPath, frameworkRoot, extensions, preferredCli, launch, workspaceName, resumeWorkspacePath, onProgress, onRecover, shouldAbort } = options
  throwIfSpinosaCancelled(shouldAbort)
  const progress = onProgress ?? (() => {})
  const recover = onRecover ?? (() => {})
  spinosaLogInfo("create", `corpusPath=${corpusPath} frameworkRoot=${frameworkRoot}`)

  const resolvedCorpus = path.resolve(corpusPath)
  const corpusName = path.basename(resolvedCorpus)
  const reservation = reserveWorkspacePath(corpusPath, workspaceName, resumeWorkspacePath)
  const workspacePath = reservation.path

  const projectName = workspaceName?.trim() || corpusName

  try {
    progress(reservation.resumed ? "Resuming interrupted workspace..." : "Creating workspace directory...")
    mkdirSync(path.join(workspacePath, ".spinosa"), { recursive: true })

    // ── Step 1: Copy workspace-template/ → workspace root ───────────────
    const srcTemplate = resolveTemplateRootFromFrameworkRoot(frameworkRoot)
    if (!srcTemplate || !existsSync(srcTemplate)) {
      rmSync(workspacePath, { recursive: true, force: true })
      return { workspacePath, projectName, success: false }
    }
    if (!reservation.resumed) {
      progress("Copying workspace template...")
      copyFrameworkManifestPaths(srcTemplate, workspacePath)
    }
    throwIfSpinosaCancelled(shouldAbort)

    cleanMacMetadata(workspacePath)
    materializePlaceholders(workspacePath)

    // Seed replace_if_unmodified baselines so the first framework update can
    // refresh managed agent/config files without a force flag.
    if (!reservation.resumed) {
      recordFrameworkChecksums(srcTemplate, workspacePath)
    }

    // Ensure user-state dirs exist when an older installed template omits them.
    for (const dir of ["raw", "maps", ".logs", "agent_reports", ".trash"]) {
      throwIfSpinosaCancelled(shouldAbort)
      const dirPath = path.join(workspacePath, dir)
      mkdirSync(dirPath, { recursive: true })
      const gitkeep = path.join(dirPath, ".gitkeep")
      if (!existsSync(gitkeep)) writeFileSync(gitkeep, "", "utf-8")
    }

    // ── Step 3: Write workspace metadata ───────────────────────────────
    const sourceFrameworkVersion = readFrameworkVersionFromRoot(frameworkRoot)
    progress("Writing workspace metadata...")
    const workspaceID = reservation.resumed ? ensureWorkspaceID(workspacePath) : createWorkspaceID()
    if (!reservation.resumed) {
      const markerLines = [
        `workspace_version: 1`,
        `workspace_id: ${workspaceID}`,
        `framework_version: ${sourceFrameworkVersion}`,
        `created: ${today()}`,
        `project_name: ${projectName}`,
        `source_location: ${resolvedCorpus}`,
        "",
      ]
      writeFileSync(path.join(workspacePath, ".spinosa", "workspace"), markerLines.join("\n"), "utf-8")
    }

    // ── Step 4: Register workspace ─────────────────────────────────────
    progress("Registering in global registry...")
    await registerWorkspace(workspacePath, projectName, recover, workspaceID)
    throwIfSpinosaCancelled(shouldAbort)

    if (preferredCli) {
      const cliLabel = preferredCli
      progress(`Writing setup files (CLI: ${cliLabel})...`)
      await writeSetupFiles(workspacePath, projectName, resolvedCorpus, cliLabel)
      await writeWorkspaceStatus(workspacePath, "cli_started")
    }
  } catch (error) {
    if (!reservation.resumed) rmSync(workspacePath, { recursive: true, force: true })
    throw error
  }

  return { workspacePath, projectName, success: true, resumed: reservation.resumed }
}
