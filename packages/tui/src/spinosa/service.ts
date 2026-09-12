import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  buildMapTree,
  countDictionaryTerms,
  emptyWorkspaceIndex,
  parseWorkspaceIndex,
} from "@spinosa/core/corpus/index"
import {
  parseGoalArtifact,
  parseOrchestratorAdvisories,
  parseOrchestratorCounter,
  parseReportFrontmatter,
  sessionIdFromGoalFilename,
} from "@spinosa/core/artifacts/parser"
import {
  normalizeFrameworkVersion,
  isLegacyDevWorkspaceVersion,
  compareFrameworkVersions,
  isPrereleaseFrameworkVersion,
} from "@spinosa/core/utils/version"
import {
  isSpinosaWorkspace,
  readWorkspaceMeta,
  readTextFile,
  readOrchestratorNotes,
  writePreferredCli,
  writeWorkspaceFrameworkVersion,
  artifactExists,
  getFrameworkHealth,
  readStartupPrompt,
} from "@spinosa/core/workspace/meta"
import {
  listRegisteredWorkspaces,
  unregisterWorkspace,
} from "@spinosa/core/workspace/registry"
import { moveToTrash } from "@spinosa/core/utils/trash"
import { readFrameworkVersionFromRoot, resolveFrameworkRoot, resolveTemplateRootFromFrameworkRoot } from "@spinosa/core/framework/discovery"
import {
  inspectTemplatePackFreshness,
  workspaceVersionBehindBundled,
  type TemplatePackFreshness,
} from "@spinosa/core/framework/template-pack-freshness"
import type {
  CorpusSummary,
  GoalArtifactSummary,
  RoutesSnapshot,
  SpinosaWorkspaceMeta,
} from "@spinosa/core/types"
import type { FrameworkReleaseStream } from "@spinosa/core/types"

// --- Inline functions not yet in spinosa-core ---

export async function countRawMarkdownFiles(rootDir: string) {
  if (!existsSync(rootDir)) return 0
  let count = 0
  const glob = new Bun.Glob("**/*.md")
  for await (const _ of glob.scan({ cwd: rootDir, onlyFiles: true })) count++
  return count
}

export async function readBundledFrameworkVersion() {
  return readFrameworkVersionFromRoot(resolveFrameworkRoot())
}

/** Move a Spinosa workspace folder to the OS trash and remove it from the registry. */
export async function deleteWorkspace(workspacePath: string, options?: { home?: string }): Promise<void> {
  const resolved = path.resolve(workspacePath)
  if (!isSpinosaWorkspace(resolved)) {
    throw new Error(`Not a Spinosa workspace: ${resolved}`)
  }

  const home = path.resolve(homedir())
  const protectedPaths = new Set([
    home,
    path.sep,
    path.resolve(home, ".spinosa"),
    path.resolve(process.env.SPINOSA_HOME ?? path.join(home, ".spinosa")),
  ])
  if (protectedPaths.has(resolved)) {
    throw new Error(`Refusing to delete protected path: ${resolved}`)
  }

  await moveToTrash(resolved, options?.home ? { home: options.home } : undefined)
  await unregisterWorkspace(resolved)
}

// --- Re-exports from spinosa-core ---

export {
  compareFrameworkVersions,
  isPrereleaseFrameworkVersion,
  isSpinosaWorkspace,
  readWorkspaceMeta,
  listRegisteredWorkspaces,
  readStartupPrompt,
  writePreferredCli,
  unregisterWorkspace,
  writeWorkspaceFrameworkVersion,
  artifactExists,
  getFrameworkHealth,
}

// --- TUI-specific functions (not in spinosa-core) ---

export type { FrameworkReleaseStream }

export function workspaceFrameworkStream(value: string | undefined): FrameworkReleaseStream | undefined {
  if (isLegacyDevWorkspaceVersion(value)) return "beta"
  const normalized = normalizeFrameworkVersion(value)
  if (!normalized || normalized === "unknown") return
  if (isPrereleaseFrameworkVersion(value)) return "beta"
  if (/^\d+\.\d+\.\d+$/u.test(normalized)) return "stable"
  return
}

export function bundledFrameworkStream(value: string | undefined): FrameworkReleaseStream | undefined {
  if (!value || isLegacyDevWorkspaceVersion(value)) return
  return workspaceFrameworkStream(value)
}

export function workspaceNeedsFrameworkUpdate(
  workspaceVersion: string | undefined,
  bundledVersion: string | undefined,
  installStream?: FrameworkReleaseStream,
) {
  const bundled = normalizeFrameworkVersion(bundledVersion)
  if (!bundled || isLegacyDevWorkspaceVersion(bundledVersion)) return false

  if (isLegacyDevWorkspaceVersion(workspaceVersion)) return true

  const workspaceStream = workspaceFrameworkStream(workspaceVersion)
  const targetStream = bundledFrameworkStream(bundled) ?? installStream
  if (workspaceStream && targetStream && workspaceStream !== targetStream) return false

  return workspaceVersionBehindBundled(workspaceVersion, bundledVersion)
}

/** Version-or-protocol stale pack check against the current template root. */
export async function inspectWorkspaceTemplatePack(input: {
  workspacePath: string
  workspaceVersion?: string
  bundledVersion?: string
  frameworkRoot?: string
}): Promise<TemplatePackFreshness> {
  const frameworkRoot = input.frameworkRoot ?? resolveFrameworkRoot() ?? undefined
  const bundledVersion = input.bundledVersion ?? (await readBundledFrameworkVersion().catch(() => undefined))
  const templateRoot = frameworkRoot ? resolveTemplateRootFromFrameworkRoot(frameworkRoot) : undefined
  return inspectTemplatePackFreshness({
    workspacePath: input.workspacePath,
    frameworkRoot,
    templateRoot,
    workspaceVersion: input.workspaceVersion,
    bundledVersion,
  })
}

/** True when framework version or protocol probe files need Update workspace. */
export async function workspaceNeedsTemplatePackRefresh(input: {
  workspacePath: string
  workspaceVersion?: string
  bundledVersion?: string
  frameworkRoot?: string
}): Promise<boolean> {
  const freshness = await inspectWorkspaceTemplatePack(input)
  return freshness.refreshRecommended
}

export type { TemplatePackFreshness }

async function listMapPaths(workspacePath: string) {
  const mapsDir = path.join(workspacePath, "maps")
  if (!existsSync(mapsDir)) return []
  const glob = new Bun.Glob("**/*.md")
  const paths: string[] = []
  for await (const entry of glob.scan({ cwd: mapsDir, onlyFiles: true })) paths.push(entry)
  return paths
}

export async function getCorpusSummary(workspacePath: string): Promise<CorpusSummary> {
  const indexText = await readTextFile(workspacePath, "system/workspace_index.md")
  const dictionaryText = await readTextFile(workspacePath, "system/dictionary.md")
  const hubExists = existsSync(path.join(workspacePath, "maps", "corpus_overview.md"))
  const mapPaths = await listMapPaths(workspacePath)

  return {
    hasWorkspaceIndex: Boolean(indexText),
    mapCount: mapPaths.length,
    rawCount: await countRawMarkdownFiles(path.join(workspacePath, "raw")),
    dictionaryTermCount: dictionaryText ? countDictionaryTerms(dictionaryText) : 0,
    index: indexText ? parseWorkspaceIndex(indexText) : emptyWorkspaceIndex(),
    mapTree: buildMapTree(mapPaths).slice(0, 40),
    hubExists,
  }
}

async function readGoalArtifact(workspacePath: string, filename: string): Promise<GoalArtifactSummary> {
  const goalPath = path.join("agent_reports", filename)
  const text = (await readTextFile(workspacePath, goalPath)) ?? ""
  return parseGoalArtifact(text, goalPath)
}

export async function getRoutesSnapshot(
  workspacePath: string,
  preferredSessionId?: string,
): Promise<RoutesSnapshot> {
  const goals: GoalArtifactSummary[] = []
  const reports: RoutesSnapshot["reports"] = []
  const coverage: RoutesSnapshot["coverage"] = []

  const glob = new Bun.Glob("agent_reports/*")
  for await (const entry of glob.scan({ cwd: workspacePath, onlyFiles: true })) {
    const name = entry.split("/").pop() ?? entry
    if (name.startsWith("g_") && name.endsWith(".md")) {
      goals.push(await readGoalArtifact(workspacePath, name))
      continue
    }
    if (name.startsWith("c_") && name.endsWith(".md")) {
      coverage.push({
        filename: name,
        path: entry,
        sessionId: sessionIdFromGoalFilename(name.replace(/^c_/, "g_")) ?? name.slice(2, -3),
      })
      continue
    }
    if (/^\d+_/.test(name) && name.endsWith(".md")) {
      const text = await readTextFile(workspacePath, entry)
      const meta: { title?: string; status?: string; sessionId?: string } = text ? parseReportFrontmatter(text) : {}
      reports.push({
        filename: name,
        path: entry,
        title: meta.title,
        status: meta.status,
        sessionId: meta.sessionId,
      })
    }
  }

  goals.sort((a, b) => b.filename.localeCompare(a.filename))
  reports.sort((a, b) => b.filename.localeCompare(a.filename))
  coverage.sort((a, b) => b.filename.localeCompare(a.filename))

  const notes = await readOrchestratorNotes(workspacePath)
  const overseerCounter = notes ? parseOrchestratorCounter(notes) : undefined
  const overseerAdvisories = notes ? parseOrchestratorAdvisories(notes) : undefined

  const activeGoal = preferredSessionId
    ? goals.find((goal) => goal.sessionId === preferredSessionId)
    : goals[0]

  return {
    goals,
    reports,
    coverage,
    overseerCounter,
    overseerAdvisories,
    activeGoal,
  }
}
