import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
  cpSync,
  renameSync,
} from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { safeCopy, copyDirContents, cleanMacMetadata, isCloudStoragePath, writeTextAtomic } from "../utils/fs"
import { compareFrameworkVersions } from "../utils/version"
import { writeWorkspaceFrameworkVersion } from "../workspace/meta"
import { inspectWorkspacePresence, isUsableWorkspacePresence } from "../workspace/presence"
import { loadRegistry } from "../workspace/registry"
import { readFrameworkVersionFromRoot, resolveTemplateRootFromFrameworkRoot } from "../framework/discovery"
import { acquireWorkspaceUpdateLock } from "../system/update-lock"
import {
  FRAMEWORK_CHECKSUMS_RELPATH,
  filesMatch,
  isRetiredManagedName,
  managedFilesUnder,
  readFrameworkChecksums,
  recordFrameworkChecksums,
  sha256File,
  type FrameworkChecksums,
} from "../framework/checksums"
import { spinosaLogInfo, spinosaLogWarn } from "../utils/log"
import { resolvePathWithinRoot } from "../utils/path"
import { readFrameworkFilesTsv, type FrameworkManifestEntry } from "../framework/manifest"
import {
  mergeStartupPromptTemplate,
  stripStartupPromptWorkspaceSuffix,
  TEMPLATE_PACK_PROTOCOL_PROBES,
} from "../framework/template-pack-freshness"

const PROTOCOL_PROBE_SET = new Set<string>(TEMPLATE_PACK_PROTOCOL_PROBES)

/** Freshness-critical protocol files always refresh even under replace_if_unmodified. */
function isProtocolProbePath(relativePath: string): boolean {
  return PROTOCOL_PROBE_SET.has(relativePath)
}

export interface UpdateOptions {
  workspacePath: string
  frameworkRoot: string
  dryRun?: boolean
  force?: boolean
  lockTimeoutMs?: number
  onPhase?: (phase: string, detail: string) => void
}

export interface UpdateResult {
  success: boolean
  added: number
  updated: number
  removed: number
  skipped: number
  changes: boolean
  presence?: import("../types").SpinosaWorkspacePresence
  /** Human-readable failure reason when success is false. */
  error?: string
}

interface ManifestEntry {
  path: string
  kind: string
}

function readWorkspaceManifest(manifestPath: string): ManifestEntry[] {
  if (!existsSync(manifestPath)) return []
  const content = readFileSync(manifestPath, "utf-8")
  const entries: ManifestEntry[] = []
  const lines = content.split("\n")
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    const parts = trimmed.split("\t")
    entries.push({ path: parts[0] ?? "", kind: parts[1] ?? "" })
  }
  return entries
}

function readWorkspaceFrameworkVersion(workspacePath: string): string | undefined {
  const markerPath = path.join(workspacePath, ".spinosa", "workspace")
  if (!existsSync(markerPath)) return undefined
  const content = readFileSync(markerPath, "utf-8")
  const match = content.match(/^framework_version:\s*(.+)$/m)
  return match?.[1]?.trim()
}

function archiveToTrash(workspacePath: string, relative: string, bucket: string): void {
  const archiveRoot = path.join(workspacePath, ".trash", bucket)
  const target = resolvePathWithinRoot(workspacePath, relative, "workspace manifest path")
  const archived = resolvePathWithinRoot(archiveRoot, relative, "workspace manifest path")
  mkdirSync(path.dirname(archived), { recursive: true })
  rmSync(archived, { force: true, recursive: true })
  renameSync(target, archived)
}

function copyManagedDirectory(
  sourceTemplateRoot: string,
  workspacePath: string,
  entry: FrameworkManifestEntry,
  storedChecksums: FrameworkChecksums,
  force: boolean,
): { changed: boolean; failed: boolean } {
  let changed = false
  let failed = false
  for (const relativeFile of managedFilesUnder(sourceTemplateRoot, entry.path)) {
    const src = resolvePathWithinRoot(sourceTemplateRoot, relativeFile, "framework manifest path")
    const dst = resolvePathWithinRoot(workspacePath, relativeFile, "framework manifest path")
    if (!existsSync(dst)) {
      mkdirSync(path.dirname(dst), { recursive: true })
      if (safeCopy(src, dst)) changed = true
      else failed = true
      continue
    }

    const srcStat = statSync(src)
    const dstStat = statSync(dst)
    if (!srcStat.isFile() || !dstStat.isFile()) {
      failed = true
      continue
    }
    if (filesMatch(src, dst)) continue

    const storedHash = storedChecksums[relativeFile]
    // Missing baseline ⇒ preserve (user edit or legacy), except protocol probes
    // which freshness treats as pack identity — skipping them leaves forever-stale.
    // Create seeds baselines so subsequent updates can refresh unmodified files.
    const mayReplace = entry.policy === "always_replace"
      || force
      || isProtocolProbePath(relativeFile)
      || (storedHash !== undefined && sha256File(dst) === storedHash)
    if (!mayReplace) continue

    if (safeCopy(src, dst)) changed = true
    else failed = true
  }
  return { changed, failed }
}

/**
 * Archive files inside managed framework directories that the template no longer ships,
 * when safe: always_replace / force / unmodified baseline / known Pilosa retired names.
 * Unknown user files inside those directories are left in place.
 */
function retireOrphanManagedFiles(options: {
  sourceTemplateRoot: string
  workspacePath: string
  fwEntries: FrameworkManifestEntry[]
  storedChecksums: FrameworkChecksums
  force: boolean
  dryRun: boolean
}): { removed: number; failed: boolean } {
  let removed = 0
  let failed = false
  const { sourceTemplateRoot, workspacePath, fwEntries, storedChecksums, force, dryRun } = options

  for (const entry of fwEntries) {
    if (entry.role === "user_state") continue
    if (entry.policy === "never_replace" || entry.policy === "exclude_from_update") continue

    const srcRoot = resolvePathWithinRoot(sourceTemplateRoot, entry.path, "framework manifest path")
    if (!existsSync(srcRoot) || !statSync(srcRoot).isDirectory()) continue

    const templateFiles = new Set(managedFilesUnder(sourceTemplateRoot, entry.path))
    for (const relative of managedFilesUnder(workspacePath, entry.path)) {
      if (templateFiles.has(relative)) continue

      const dst = resolvePathWithinRoot(workspacePath, relative, "framework manifest path")
      if (!existsSync(dst) || !statSync(dst).isFile()) continue

      const storedHash = storedChecksums[relative]
      const unmodified = storedHash !== undefined && sha256File(dst) === storedHash
      const mayRetire = entry.policy === "always_replace"
        || force
        || unmodified
        || isRetiredManagedName(relative)
      if (!mayRetire) continue

      if (dryRun) {
        removed++
        continue
      }
      try {
        archiveToTrash(workspacePath, relative, "framework-update-retired")
        removed++
      } catch (error) {
        failed = true
        spinosaLogWarn("update", `retire failed: ${relative} — ${String(error)}`)
      }
    }
  }

  return { removed, failed }
}

async function updateWorkspaceUnlocked(options: UpdateOptions): Promise<UpdateResult> {
  const { workspacePath, frameworkRoot, dryRun = false, force = false, onPhase } = options
  const phase = onPhase ?? ((_p: string, _d: string) => {})
  spinosaLogInfo("update", `workspacePath=${workspacePath} dryRun=${dryRun}`)

  const sourceTemplateRoot = resolveTemplateRootFromFrameworkRoot(frameworkRoot)
  if (!sourceTemplateRoot) {
    return {
      success: false,
      added: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      changes: false,
      error: "Couldn’t find the workspace template for this install",
    }
  }
  const fwManifestPath = path.join(sourceTemplateRoot, ".spinosa", "workspace-files.tsv")
  const wsManifestPath = path.join(workspacePath, ".spinosa", "manifest.tsv")

  if (!existsSync(fwManifestPath)) {
    return {
      success: false,
      added: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      changes: false,
      error: "Workspace template manifest is missing",
    }
  }

  const fwEntries = readFrameworkFilesTsv(fwManifestPath)
  const wsManifest = readWorkspaceManifest(wsManifestPath)

  for (const entry of fwEntries) {
    resolvePathWithinRoot(sourceTemplateRoot, entry.path, "framework manifest path")
    resolvePathWithinRoot(workspacePath, entry.path, "framework manifest path")
  }
  for (const entry of wsManifest) {
    if (!entry.path || entry.path === "path") continue
    resolvePathWithinRoot(workspacePath, entry.path, "workspace manifest path")
  }

  const installedVersion = readFrameworkVersionFromRoot(frameworkRoot)
  const workspaceVersion = readWorkspaceFrameworkVersion(workspacePath)

  if (
    installedVersion !== "dev" &&
    workspaceVersion !== undefined &&
    workspaceVersion !== "unknown" &&
    workspaceVersion !== "dev"
  ) {
    const cmp = compareFrameworkVersions(installedVersion, workspaceVersion)
    if (cmp !== undefined && cmp < 0) {
      return {
        success: false,
        added: 0,
        updated: 0,
        removed: 0,
        skipped: 0,
        changes: false,
        error: `Installed framework (${installedVersion}) is older than this workspace (${workspaceVersion})`,
      }
    }
  }

  const manifestHasEntries = wsManifest.length > 0
  const declaredPaths = new Set(fwEntries.map((e) => e.path))
  const storedChecksums = readFrameworkChecksums(workspacePath)

  const changedPaths: string[] = []
  let added = 0
  let updated = 0
  let removed = 0
  let skipped = 0
  let hadFailures = false

  // Phase 1-2: ADD + REPLACE from workspace-files.tsv
  phase("1", `Process ${fwEntries.length} template paths`)
  for (const entry of fwEntries) {
    if (entry.policy === "never_replace" || entry.policy === "exclude_from_update") {
      skipped++
      continue
    }

    const src = resolvePathWithinRoot(sourceTemplateRoot, entry.path, "framework manifest path")
    const dst = resolvePathWithinRoot(workspacePath, entry.path, "framework manifest path")

    if (!existsSync(src)) {
      skipped++
      continue
    }

    if (!existsSync(dst)) {
      if (dryRun) {
        added++
        changedPaths.push(entry.path)
        continue
      }
      phase("2", `Add ${entry.path}`)
      mkdirSync(path.dirname(dst), { recursive: true })
      const s = statSync(src)
      if (s.isDirectory()) {
        try {
          copyDirContents(src, dst)
        } catch (error) {
          hadFailures = true
          spinosaLogWarn("update", `copy failed: ${entry.path} — ${String(error)}`)
          continue
        }
      } else {
        if (!safeCopy(src, dst)) {
          hadFailures = true
          spinosaLogWarn("update", `copy failed: ${entry.path}`)
          continue
        }
      }
      added++
      changedPaths.push(entry.path)
      continue
    }

    const srcStat = statSync(src)
    const dstStat = statSync(dst)

    // replace_if_unmodified: skip if user modified since last update
    if (entry.policy === "replace_if_unmodified" && srcStat.isFile() && dstStat.isFile() && !force) {
      const storedHash = storedChecksums[entry.path]
      if (storedHash !== undefined) {
        const currentHash = sha256File(dst)
        if (currentHash !== storedHash) {
          skipped++
          continue
        }
      }
    }

    // startup-prompt.md always has an onboarding footer — compare protocol body only.
    if (entry.path === "startup-prompt.md" && srcStat.isFile() && dstStat.isFile()) {
      const templateBody = stripStartupPromptWorkspaceSuffix(readFileSync(src, "utf-8"))
      const workspaceBody = stripStartupPromptWorkspaceSuffix(readFileSync(dst, "utf-8"))
      if (templateBody === workspaceBody) {
        skipped++
        continue
      }
      if (dryRun) {
        updated++
        changedPaths.push(entry.path)
        continue
      }
      phase("2", "Update startup-prompt.md (preserve workspace metadata)")
      const merged = mergeStartupPromptTemplate(readFileSync(src, "utf-8"), readFileSync(dst, "utf-8"))
      writeFileSync(dst, merged, "utf-8")
      updated++
      changedPaths.push(entry.path)
      continue
    }

    if (srcStat.isFile() && dstStat.isFile() && filesMatch(src, dst)) {
      skipped++
      continue
    }

    if (dryRun) {
      updated++
      changedPaths.push(entry.path)
      continue
    }

    phase("2", `${dstStat.isDirectory() ? "Sync" : "Update"} ${entry.path}`)
    mkdirSync(path.dirname(dst), { recursive: true })
    if (srcStat.isDirectory()) {
      let sync: { changed: boolean; failed: boolean }
      try {
        sync = copyManagedDirectory(sourceTemplateRoot, workspacePath, entry, storedChecksums, force)
      } catch (error) {
        hadFailures = true
        spinosaLogWarn("update", `directory sync failed: ${entry.path} — ${String(error)}`)
        continue
      }
      if (sync.failed) hadFailures = true
      if (!sync.changed) {
        skipped++
        continue
      }
    } else {
      if (!safeCopy(src, dst)) {
        hadFailures = true
        spinosaLogWarn("update", `copy failed: ${entry.path}`)
        continue
      }
    }
    updated++
    changedPaths.push(entry.path)
  }

  // Substitute placeholders in workspace files (AGENTS.md, CLAUDE.md, etc.)
  for (const relPath of ["AGENTS.md", "CLAUDE.md"]) {
    const filePath = path.join(workspacePath, relPath)
    if (!existsSync(filePath)) continue
    let content = readFileSync(filePath, "utf-8")
    const replaced = content.replaceAll("{{WORKSPACE_PATH}}", workspacePath)
    if (replaced !== content) {
      writeFileSync(filePath, replaced, "utf-8")
      if (!changedPaths.includes(relPath)) {
        updated++
        changedPaths.push(relPath)
      }
    }
  }

  // Phase 3: remove top-level files no longer in framework TSV
  phase("3", "Remove files absent from framework")
  if (manifestHasEntries && !hadFailures) {
    for (const mentry of wsManifest) {
      if (mentry.kind === "dir") continue
      if (!mentry.path || mentry.path === "path") continue
      if (declaredPaths.has(mentry.path)) {
        skipped++
        continue
      }

      const target = resolvePathWithinRoot(workspacePath, mentry.path, "workspace manifest path")
      if (!existsSync(target)) continue

      if (dryRun) {
        removed++
      } else {
        try {
          archiveToTrash(workspacePath, mentry.path, "framework-update-retired")
          removed++
        } catch (error) {
          hadFailures = true
          spinosaLogWarn("update", `remove failed: ${mentry.path} — ${String(error)}`)
        }
      }
    }
  }

  // Phase 4: retire orphaned files inside managed framework directories only.
  // Never scan the corpus by extension — user .jsonl / .bak / logs stay put.
  phase("4", "Retire orphaned managed files")
  if (!hadFailures) {
    const retired = retireOrphanManagedFiles({
      sourceTemplateRoot,
      workspacePath,
      fwEntries,
      storedChecksums,
      force,
      dryRun,
    })
    removed += retired.removed
    if (retired.failed) hadFailures = true
  }

  // Regenerate manifest.tsv
  phase("5", "Regenerate manifest")
  if (!dryRun && !hadFailures) {
    const manifestLines = ["path\tkind"]
    for (const entry of fwEntries) {
      const fullPath = resolvePathWithinRoot(workspacePath, entry.path, "framework manifest path")
      if (!existsSync(fullPath)) continue
      const kind = statSync(fullPath).isDirectory() ? "dir" : "file"
      manifestLines.push(`${entry.path}\t${kind}`)
    }
    mkdirSync(path.dirname(wsManifestPath), { recursive: true })
    writeTextAtomic(wsManifestPath, manifestLines.join("\n") + "\n")
  }

  if (!dryRun && !hadFailures && installedVersion && installedVersion !== "dev") {
    phase("5", "Update framework version")
    await writeWorkspaceFrameworkVersion(workspacePath, installedVersion)
  }

  if (!dryRun && !hadFailures && !isCloudStoragePath(workspacePath)) {
    phase("5", "Clean macOS metadata")
    cleanMacMetadata(workspacePath)
  }

  if (!dryRun && !hadFailures) {
    phase("5", "Record file checksums")
    recordFrameworkChecksums(sourceTemplateRoot, workspacePath)
  }

  return {
    success: !hadFailures,
    added,
    updated,
    removed,
    skipped,
    changes: added > 0 || updated > 0 || removed > 0,
    error: hadFailures ? "Some framework files could not be updated; earlier changes were rolled back" : undefined,
  }
}

type UpdateSnapshot = {
  root: string
  relativePaths: string[]
  topLevelEntries: string[]
}

function createUpdateSnapshot(options: UpdateOptions): UpdateSnapshot | undefined {
  if (options.dryRun) return
  const sourceTemplateRoot = resolveTemplateRootFromFrameworkRoot(options.frameworkRoot)
  if (!sourceTemplateRoot) return
  const frameworkManifest = path.join(sourceTemplateRoot, ".spinosa", "workspace-files.tsv")
  const workspaceManifest = path.join(options.workspacePath, ".spinosa", "manifest.tsv")
  if (!existsSync(frameworkManifest)) return

  // Record the top-level workspace layout before any write so rollback can
  // also remove paths this update created (e.g. a newly added template dir).
  let topLevelEntries: string[] = []
  try {
    topLevelEntries = readdirSync(options.workspacePath).map((name) => name)
  } catch {
    topLevelEntries = []
  }

  const fwEntries = readFrameworkFilesTsv(frameworkManifest)
  const managedNested: string[] = []
  for (const entry of fwEntries) {
    if (entry.policy === "never_replace" || entry.policy === "exclude_from_update") continue
    const src = resolvePathWithinRoot(sourceTemplateRoot, entry.path, "framework manifest path")
    if (existsSync(src) && statSync(src).isDirectory()) {
      managedNested.push(...managedFilesUnder(options.workspacePath, entry.path))
    }
  }

  const candidates = [
    ...fwEntries
      .filter((entry) => entry.policy !== "never_replace" && entry.policy !== "exclude_from_update")
      .map((entry) => entry.path),
    ...readWorkspaceManifest(workspaceManifest).map((entry) => entry.path),
    ...managedNested,
    ".spinosa/manifest.tsv",
    FRAMEWORK_CHECKSUMS_RELPATH,
    ".spinosa/workspace",
  ].filter(Boolean)
  const unique = [...new Set(candidates)]
    .sort((a, b) => a.length - b.length)
    .filter((relative, index, all) => !all.slice(0, index).some((parent) => relative.startsWith(`${parent}${path.sep}`)))
  // Use os tmpdir, not workspace parent, to avoid permission / cross-device issues
  // and to not pollute the user's project parent (e.g. / or /tmp parent).
  const root = path.join(tmpdir(), `spinosa-update-backup-${process.pid}-${crypto.randomUUID()}`)
  mkdirSync(root, { recursive: true })
  for (const relative of unique) {
    const source = resolvePathWithinRoot(options.workspacePath, relative, "workspace manifest path")
    if (!existsSync(source)) continue
    const backup = resolvePathWithinRoot(root, relative, "workspace manifest path")
    mkdirSync(path.dirname(backup), { recursive: true })
    cpSync(source, backup, { recursive: true, force: true })
  }
  return { root, relativePaths: unique, topLevelEntries }
}

function restoreUpdateSnapshot(workspacePath: string, snapshot: UpdateSnapshot): void {
  for (const relative of [...snapshot.relativePaths].sort((a, b) => b.length - a.length)) {
    const target = resolvePathWithinRoot(workspacePath, relative, "workspace snapshot path")
    rmSync(target, { recursive: true, force: true })
  }
  for (const relative of snapshot.relativePaths) {
    const backup = resolvePathWithinRoot(snapshot.root, relative, "workspace snapshot path")
    if (!existsSync(backup)) continue
    const target = resolvePathWithinRoot(workspacePath, relative, "workspace snapshot path")
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(backup, target, { recursive: true, force: true })
  }
  // Remove top-level entries the update created so the workspace returns to
  // exactly its pre-update layout. Snapshot bookkeeping lives under
  // `.spinosa/`, which is part of the original listing, so it is never touched.
  let currentTopLevel: string[] = []
  try {
    currentTopLevel = readdirSync(workspacePath)
  } catch {
    return
  }
  const original = new Set(snapshot.topLevelEntries)
  for (const name of currentTopLevel) {
    if (original.has(name)) continue
    const target = resolvePathWithinRoot(workspacePath, name, "workspace snapshot path")
    rmSync(target, { recursive: true, force: true })
  }
}

export async function updateWorkspace(options: UpdateOptions): Promise<UpdateResult> {
  const registered = (await loadRegistry(undefined, { allowMissingMarker: true }))
    .find((entry) => entry.path === options.workspacePath)
  const presence = registered || existsSync(options.workspacePath)
    ? inspectWorkspacePresence({ workspacePath: options.workspacePath, workspaceID: registered?.workspaceID })
    : undefined
  if (presence && !isUsableWorkspacePresence(presence)) {
    if (registered || presence.status !== "invalid") {
      spinosaLogWarn("update", `Skipping ${options.workspacePath}: workspace is ${presence.status}`)
      if (presence.status === "non_existent") {
        return { success: true, added: 0, updated: 0, removed: 0, skipped: 1, changes: false, presence: presence.status }
      }
      return {
        success: false,
        added: 0,
        updated: 0,
        removed: 0,
        skipped: 0,
        changes: false,
        presence: presence.status,
        error: `Workspace is ${presence.status}`,
      }
    }
  }

  let lock: ReturnType<typeof acquireWorkspaceUpdateLock>
  try {
    lock = acquireWorkspaceUpdateLock(options.workspacePath, { timeoutMs: options.lockTimeoutMs ?? 10_000 })
  } catch (error) {
    return {
      success: false,
      added: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      changes: false,
      error: error instanceof Error ? error.message : "Another update is already in progress for this workspace",
    }
  }

  let snapshot: UpdateSnapshot | undefined
  try {
    snapshot = createUpdateSnapshot(options)
    const result = await updateWorkspaceUnlocked(options)
    if (!result.success && snapshot) restoreUpdateSnapshot(options.workspacePath, snapshot)
    return result
  } catch (error) {
    if (snapshot) restoreUpdateSnapshot(options.workspacePath, snapshot)
    throw error
  } finally {
    if (snapshot) rmSync(snapshot.root, { recursive: true, force: true })
    lock.release()
  }
}
