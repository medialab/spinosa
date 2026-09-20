import { cleanupStaleInstallDirectories, type SpinosaCleanupResult } from "./maintenance"
import {
  loadRegistry,
  registerWorkspace,
  setWorkspacePresence,
} from "../workspace/registry"
import { inspectWorkspacePresence, type WorkspacePresence } from "../workspace/presence"
import { spinosaLogError, spinosaLogInfo, spinosaLogWarn } from "../utils/log"
import {
  advertisedOpenCodeVersion,
  syncOpenCodeCompatVersion,
} from "@spinosa/kernel-core/installation/opencode-compat"

export type SpinosaBootOperationStatus = "pending" | "running" | "complete" | "warning" | "error"

export type SpinosaBootOperation = {
  id: "workspace-index" | "maintenance" | "ready"
  label: string
  status: SpinosaBootOperationStatus
  detail?: string
}

export type SpinosaBootHealth = {
  workspaces: Array<WorkspacePresence & { name: string }>
  cleanup: SpinosaCleanupResult
  error?: string
}

export const SPINOSA_BOOT_OPERATIONS: readonly SpinosaBootOperation[] = [
  { id: "maintenance", label: "Cleaning up startup files", status: "pending" },
  { id: "workspace-index", label: "Checking workspace IDs and locations", status: "pending" },
  { id: "ready", label: "Starting Spinosa TUI", status: "pending" },
]

const EMPTY_SPINOSA_CLEANUP: SpinosaCleanupResult = {
  installInProgress: false,
  staleInstallDirectories: [],
  staleTempDirectories: [],
  staleNodeModulesDirectories: 0,
  dependencyRepairRequired: false,
  dormantVersionDirectories: [],
  removedDirectories: [],
}

export const LAUNCH_BOOT_INSTALL_IN_PROGRESS = "Install in progress; cleanup deferred."

export function formatLaunchBootCleaned(count: number): string {
  return `Cleaned ${count} stale install path${count === 1 ? "" : "s"}.`
}

export function formatLaunchBootMissing(count: number): string {
  return `${count} registered workspace${count === 1 ? " is" : "s are"} missing.`
}

export function formatLaunchBootAttention(detail: string): string {
  return `Workspace index needs attention: ${detail}`
}

export function formatLaunchBootFailed(detail: string): string {
  return `Startup cleanup failed: ${detail}`
}

export type LaunchBootHealthInput = {
  searchRoots?: string[]
  out?: (message: string) => void
  err?: (message: string) => void
  runHealth?: (input: {
    searchRoots?: string[]
    minimumOperationDurationMs?: number
  }) => Promise<SpinosaBootHealth>
  syncOpenCodeCompat?: () => Promise<{ version: string; source: string }>
}

export async function runSpinosaBootHealth(input: {
  searchRoots?: string[]
  onProgress?: (operation: SpinosaBootOperation) => void
  minimumOperationDurationMs?: number
} = {}): Promise<SpinosaBootHealth> {
  const minimumOperationDurationMs = input.minimumOperationDurationMs ?? 1_000
  const operations = new Map(SPINOSA_BOOT_OPERATIONS.map((operation) => [operation.id, operation]))
  const progress = (id: SpinosaBootOperation["id"], status: SpinosaBootOperationStatus, detail?: string) => {
    const next = { ...operations.get(id)!, status, ...(detail ? { detail } : {}) }
    operations.set(id, next)
    input.onProgress?.(next)
  }

  const holdOperation = async (startedAt: number) => {
    const remaining = minimumOperationDurationMs - (Date.now() - startedAt)
    if (remaining > 0) await Bun.sleep(remaining)
  }

  progress("maintenance", "running")
  const maintenanceStartedAt = Date.now()
  let cleanup: SpinosaCleanupResult
  let cleanupError = false
  let indexError: string | undefined
  try {
    cleanup = await cleanupStaleInstallDirectories()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    indexError = detail
    cleanupError = true
    cleanup = { ...EMPTY_SPINOSA_CLEANUP }
    progress("maintenance", "error", detail)
  }
  await holdOperation(maintenanceStartedAt)
  if (!cleanupError) {
    progress(
      "maintenance",
      cleanup.installInProgress ? "warning" : "complete",
      cleanup.installInProgress
        ? "Install in progress; cleanup deferred"
        : cleanup.removedDirectories.length > 0
          ? `Removed ${cleanup.removedDirectories.length} stale temp/install path${cleanup.removedDirectories.length === 1 ? "" : "s"}`
          : "No stale installer or temp files found",
    )
  }

  progress("workspace-index", "running")
  const workspaceIndexStartedAt = Date.now()
  let entries: Awaited<ReturnType<typeof loadRegistry>>
  try {
    entries = await loadRegistry(undefined, { allowMissingMarker: true })
  } catch (error) {
    indexError ??= error instanceof Error ? error.message : String(error)
    entries = []
    progress("workspace-index", "error", indexError)
  }
  const workspaces: Array<WorkspacePresence & { name: string }> = []
  for (const entry of entries) {
    try {
      const presence = inspectWorkspacePresence({
        workspacePath: entry.path,
        workspaceID: entry.workspaceID,
        searchRoots: input.searchRoots ?? [],
      })
      workspaces.push({ ...presence, name: entry.name })

      if (presence.status === "moved" && presence.resolvedPath && presence.currentWorkspaceID) {
        await registerWorkspace(presence.resolvedPath, entry.name, undefined, presence.currentWorkspaceID, {
          presence: "present",
          replacePath: entry.path,
        })
        continue
      }

      await setWorkspacePresence({
        workspacePath: entry.path,
        workspaceID: entry.workspaceID,
        presence: presence.status,
      })
    } catch (error) {
      indexError ??= error instanceof Error ? error.message : String(error)
      progress("workspace-index", "warning", `Could not persist ${entry.name || entry.path}: ${indexError}`)
    }
  }

  const missing = workspaces.filter((workspace) => workspace.status === "non_existent").length
  const moved = workspaces.filter((workspace) => workspace.status === "moved").length
  await holdOperation(workspaceIndexStartedAt)
  progress(
    "workspace-index",
    missing > 0 || indexError ? "warning" : "complete",
    `${entries.length} indexed workspace(s) checked; ${missing} NON EXISTENT${moved ? `; ${moved} moved path(s) recovered` : ""}${indexError ? `; ${indexError}` : ""}`,
  )

  progress("ready", "running")
  const readyStartedAt = Date.now()
  await holdOperation(readyStartedAt)
  progress("ready", indexError ? "warning" : "complete", indexError ? "Workspace index needs attention" : "Workspace checks complete")

  return { workspaces, cleanup, ...(indexError ? { error: indexError } : {}) }
}

/** Parent-process boot checks. Never throws. Failures print one line and still continue into the TUI. */
export async function runLaunchBootHealth(input: LaunchBootHealthInput = {}): Promise<SpinosaBootHealth> {
  const out = input.out ?? ((message) => process.stdout.write(`${message}\n`))
  const err = input.err ?? ((message) => process.stderr.write(`${message}\n`))
  const runHealth = input.runHealth ?? runSpinosaBootHealth
  try {
    spinosaLogInfo("boot", `console user-agent opencode/${advertisedOpenCodeVersion()}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    spinosaLogWarn("boot", `opencode compat probe failed: ${message}`)
  }
  void (input.syncOpenCodeCompat ?? syncOpenCodeCompatVersion)()
    .then((compat) => {
      spinosaLogInfo("boot", `console user-agent refreshed opencode/${compat.version} source=${compat.source}`)
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      spinosaLogWarn("boot", `opencode compat probe failed: ${message}`)
    })
  try {
    const health = await runHealth({
      searchRoots: input.searchRoots,
      minimumOperationDurationMs: 0,
    })
    const missing = health.workspaces.filter((workspace) => workspace.status === "non_existent").length
    const moved = health.workspaces.filter((workspace) => workspace.status === "moved").length
    spinosaLogInfo(
      "boot",
      `index workspaces=${health.workspaces.length} missing=${missing} moved=${moved} removed=${health.cleanup.removedDirectories.length}${health.error ? ` error=${health.error}` : ""}`,
    )
    if (health.error) {
      spinosaLogWarn("boot", health.error)
      err(formatLaunchBootAttention(health.error))
    }
    if (health.cleanup.removedDirectories.length > 0) {
      out(formatLaunchBootCleaned(health.cleanup.removedDirectories.length))
    }
    if (health.cleanup.installInProgress) {
      out(LAUNCH_BOOT_INSTALL_IN_PROGRESS)
    }
    if (missing > 0) {
      out(formatLaunchBootMissing(missing))
    }
    return health
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    spinosaLogError("boot", `launch boot health failed: ${message}`)
    err(formatLaunchBootFailed(message))
    return { workspaces: [], cleanup: { ...EMPTY_SPINOSA_CLEANUP }, error: message }
  }
}
