import { type Dirent } from "node:fs"
import { readdir, rm, stat } from "node:fs/promises"
import { homedir, tmpdir as osTmpdir } from "node:os"
import path from "node:path"
import { resolveFrameworkRoot } from "../framework/discovery"

const STALE_INSTALL_DIRECTORY = /^\.\d[\w.+-]*\.(?:staging|backup)\.(\d+)$/
/** Temp entries Spinosa creates and may abandon on crash/kill. */
const STALE_TEMP_DIR_PREFIXES = [
  "spinosa-launch-",
  "spinosa-upgrade-",
  "spinosa-upgrade-err-",
  "spinosa-install.",
  "spinosa-pack-",
  // Import-pipeline and update leftovers (each OCR/vision run owns one dir;
  // worker payloads are single files). Age gate + live-PID guard apply.
  "spinosa-tess-",
  "spinosa-vision-pdf-",
  "spinosa-update-backup-",
  "spinosa-worker-payload-",
] as const

export const MIN_STALE_INSTALL_AGE_MS = 60 * 60 * 1000
/** Same age gate for OS temp leftovers (launch scripts, failed extracts). */
export const MIN_STALE_TEMP_AGE_MS = MIN_STALE_INSTALL_AGE_MS

export type SpinosaMaintenanceStatus = {
  installInProgress: boolean
  staleInstallDirectories: string[]
  staleTempDirectories: string[]
  staleNodeModulesDirectories: number
  dependencyRepairRequired: boolean
  /** Dormant legacy version trees under ~/.spinosa/versions (never auto-deleted). */
  dormantVersionDirectories: string[]
}

export type SpinosaCleanupResult = SpinosaMaintenanceStatus & {
  removedDirectories: string[]
}

function spinosaHome(): string {
  return process.env.SPINOSA_HOME ?? path.join(homedir(), ".spinosa")
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code !== "ESRCH"
  }
}

async function findStaleInstallerDirectories(versionsDir: string, now: number): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(versionsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }

  const stale: string[] = []
  for (const entry of entries) {
    const match = entry.isDirectory() ? STALE_INSTALL_DIRECTORY.exec(entry.name) : undefined
    if (!match) continue
    const pid = Number.parseInt(match[1]!, 10)
    const candidate = path.join(versionsDir, entry.name)
    const info = await stat(candidate)
    if (now - info.mtimeMs < MIN_STALE_INSTALL_AGE_MS || isProcessAlive(pid)) continue
    stale.push(candidate)
  }
  return stale
}

async function findDormantVersionDirectories(versionsDir: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(versionsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(versionsDir, entry.name))
}

function looksLikeSpinosaTempName(name: string): boolean {
  if (STALE_TEMP_DIR_PREFIXES.some((prefix) => name.startsWith(prefix))) return true
  // Failed atomic template extracts: `<cache>.extracting-<pid>-<ts>`
  if (name.includes(".extracting-")) return true
  return false
}

function extractingPid(name: string): number | undefined {
  const match = /\.extracting-(\d+)(?:-|$)/.exec(name)
  if (!match) return undefined
  const pid = Number.parseInt(match[1]!, 10)
  return Number.isFinite(pid) ? pid : undefined
}

async function collectStaleTempEntries(root: string, now: number): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }

  const stale: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isFile()) continue
    if (!looksLikeSpinosaTempName(entry.name)) continue
    const candidate = path.join(root, entry.name)
    try {
      const info = await stat(candidate)
      if (now - info.mtimeMs < MIN_STALE_TEMP_AGE_MS) continue
      const pid = extractingPid(entry.name)
      if (pid !== undefined && isProcessAlive(pid)) continue
      stale.push(candidate)
    } catch {
      // Race with concurrent cleanup — skip.
    }
  }
  return stale
}

async function findStaleTempDirectories(home: string, now: number, tempRoots?: string[]): Promise<string[]> {
  const roots = new Set<string>([
    path.join(home, "templates"),
    ...(tempRoots !== undefined ? tempRoots : [osTmpdir(), "/tmp"]),
  ])
  // Avoid double-scanning when os.tmpdir() === /tmp (Linux).
  const found = new Set<string>()
  for (const root of roots) {
    for (const candidate of await collectStaleTempEntries(root, now)) {
      found.add(candidate)
    }
  }
  return [...found]
}

function isInstalledRelease(frameworkRoot: string | undefined, versionsDir: string): boolean {
  if (!frameworkRoot) return false
  const relative = path.relative(versionsDir, frameworkRoot)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

export async function inspectSpinosaMaintenance(input: {
  home?: string
  frameworkRoot?: string
  now?: number
  tempRoots?: string[]
} = {}): Promise<SpinosaMaintenanceStatus> {
  const home = input.home ?? spinosaHome()
  const versionsDir = path.join(home, "versions")
  const frameworkRoot = input.frameworkRoot ?? resolveFrameworkRoot()
  const now = input.now ?? Date.now()
  // Binary installer locks under .staging/; legacy source installer used versions/.
  const installInProgress =
    (await exists(path.join(home, ".staging", ".install.lock"))) ||
    (await exists(path.join(versionsDir, ".install.lock")))
  const staleInstallDirectories = installInProgress
    ? []
    : await findStaleInstallerDirectories(versionsDir, now)
  const staleTempDirectories = installInProgress
    ? []
    : await findStaleTempDirectories(home, now, input.tempRoots)
  const staleNodeModulesDirectories = (
    await Promise.all(staleInstallDirectories.map((directory) => exists(path.join(directory, "node_modules"))))
  ).filter(Boolean).length
  const dependencyRepairRequired =
    isInstalledRelease(frameworkRoot, versionsDir) && !(await exists(path.join(frameworkRoot!, "node_modules")))
  const dormantVersionDirectories = await findDormantVersionDirectories(versionsDir)

  return {
    installInProgress,
    staleInstallDirectories,
    staleTempDirectories,
    staleNodeModulesDirectories,
    dependencyRepairRequired,
    dormantVersionDirectories,
  }
}

export async function cleanupStaleInstallDirectories(input: {
  home?: string
  frameworkRoot?: string
  now?: number
  tempRoots?: string[]
} = {}): Promise<SpinosaCleanupResult> {
  const status = await inspectSpinosaMaintenance(input)
  if (status.installInProgress) return { ...status, removedDirectories: [] }

  const removedDirectories: string[] = []
  for (const directory of [...status.staleInstallDirectories, ...status.staleTempDirectories]) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 2 })
      removedDirectories.push(directory)
    } catch {
      // Best-effort: locked/busy temps are retried next boot.
    }
  }
  return { ...status, removedDirectories }
}
