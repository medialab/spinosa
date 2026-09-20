import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createWorkspaceID } from "../src/workspace/identity"
import {
  formatLaunchBootAttention,
  formatLaunchBootCleaned,
  formatLaunchBootFailed,
  formatLaunchBootMissing,
  LAUNCH_BOOT_INSTALL_IN_PROGRESS,
  runLaunchBootHealth,
  type SpinosaBootHealth,
} from "../src/system/boot"
import { registerWorkspace, loadRegistry } from "../src/workspace/registry"
import type { SpinosaCleanupResult } from "../src/system/maintenance"

const skipOpenCodeCompat = async () => ({ version: "1.18.0", source: "min" })

function emptyCleanup(overrides: Partial<SpinosaCleanupResult> = {}): SpinosaCleanupResult {
  return {
    installInProgress: false,
    staleInstallDirectories: [],
    staleTempDirectories: [],
    staleNodeModulesDirectories: 0,
    dependencyRepairRequired: false,
    dormantVersionDirectories: [],
    removedDirectories: [],
    ...overrides,
  }
}

function health(overrides: Partial<SpinosaBootHealth> = {}): SpinosaBootHealth {
  return {
    workspaces: [],
    cleanup: emptyCleanup(),
    ...overrides,
  }
}

async function withSpinosaHome<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-boot-"))
  const originalHome = process.env.SPINOSA_HOME
  process.env.SPINOSA_HOME = path.join(root, "home")
  try {
    return await fn(root)
  } finally {
    if (originalHome === undefined) delete process.env.SPINOSA_HOME
    else process.env.SPINOSA_HOME = originalHome
    rmSync(root, { recursive: true, force: true })
  }
}

describe("launch boot health", () => {
  test("prints nothing when cleanup and index are clean", async () => {
    const output: string[] = []
    const errors: string[] = []
    const result = await runLaunchBootHealth({
      syncOpenCodeCompat: skipOpenCodeCompat,
      runHealth: async () => health(),
      out: (message) => output.push(message),
      err: (message) => errors.push(message),
    })
    expect(result.error).toBeUndefined()
    expect(output).toEqual([])
    expect(errors).toEqual([])
  })

  test("prints one line when stale install paths were removed", async () => {
    const output: string[] = []
    await runLaunchBootHealth({
      syncOpenCodeCompat: skipOpenCodeCompat,
      runHealth: async () =>
        health({
          cleanup: emptyCleanup({ removedDirectories: ["/tmp/a", "/tmp/b"] }),
        }),
      out: (message) => output.push(message),
      err: () => {},
    })
    expect(output).toEqual([formatLaunchBootCleaned(2)])
  })

  test("prints one line when registered workspaces are missing", async () => {
    const output: string[] = []
    await runLaunchBootHealth({
      syncOpenCodeCompat: skipOpenCodeCompat,
      runHealth: async () =>
        health({
          workspaces: [
            { indexedPath: "/gone", name: "gone", status: "non_existent" },
            { indexedPath: "/ok", name: "ok", status: "present" },
          ],
        }),
      out: (message) => output.push(message),
      err: () => {},
    })
    expect(output).toEqual([formatLaunchBootMissing(1)])
  })

  test("prints install-in-progress without failing", async () => {
    const output: string[] = []
    const result = await runLaunchBootHealth({
      syncOpenCodeCompat: skipOpenCodeCompat,
      runHealth: async () =>
        health({
          cleanup: emptyCleanup({ installInProgress: true }),
        }),
      out: (message) => output.push(message),
      err: () => {},
    })
    expect(result.error).toBeUndefined()
    expect(output).toEqual([LAUNCH_BOOT_INSTALL_IN_PROGRESS])
  })

  test("prints index errors to stderr and still returns", async () => {
    const output: string[] = []
    const errors: string[] = []
    const result = await runLaunchBootHealth({
      syncOpenCodeCompat: skipOpenCodeCompat,
      runHealth: async () => health({ error: "disk full" }),
      out: (message) => output.push(message),
      err: (message) => errors.push(message),
    })
    expect(result.error).toBe("disk full")
    expect(errors).toEqual([formatLaunchBootAttention("disk full")])
    expect(output).toEqual([])
  })

  test("catches thrown health checks and does not rethrow", async () => {
    const errors: string[] = []
    const result = await runLaunchBootHealth({
      syncOpenCodeCompat: skipOpenCodeCompat,
      runHealth: async () => {
        throw new Error("boom")
      },
      out: () => {},
      err: (message) => errors.push(message),
    })
    expect(result.error).toBe("boom")
    expect(result.workspaces).toEqual([])
    expect(errors).toEqual([formatLaunchBootFailed("boom")])
  })

  test("indexes a live registry without failing on a clean home", async () => {
    await withSpinosaHome(async () => {
      const errors: string[] = []
      const result = await runLaunchBootHealth({
        syncOpenCodeCompat: skipOpenCodeCompat,
        out: () => {},
        err: (message) => errors.push(message),
      })
      expect(result.error).toBeUndefined()
      expect(errors).toEqual([])
    })
  })

  test("marks missing entries and repairs a uniquely moved workspace", async () => {
    await withSpinosaHome(async (root) => {
      const existing = path.join(root, "existing")
      mkdirSync(path.join(existing, ".spinosa"), { recursive: true })
      const existingID = createWorkspaceID()
      await Bun.write(path.join(existing, ".spinosa", "workspace"), `workspace_id: ${existingID}\nsetup_status: workspace_started\n`)
      await registerWorkspace(existing, "existing", undefined, existingID)

      const oldPath = path.join(root, "old", "moved")
      const movedPath = path.join(root, "new", "moved")
      const movedID = createWorkspaceID()
      mkdirSync(path.join(oldPath, ".spinosa"), { recursive: true })
      await Bun.write(path.join(oldPath, ".spinosa", "workspace"), `workspace_id: ${movedID}\n`)
      await registerWorkspace(oldPath, "moved", undefined, movedID)
      mkdirSync(path.dirname(movedPath), { recursive: true })
      renameSync(oldPath, movedPath)

      const missingPath = path.join(root, "deleted")
      const missingID = createWorkspaceID()
      mkdirSync(path.join(missingPath, ".spinosa"), { recursive: true })
      await Bun.write(path.join(missingPath, ".spinosa", "workspace"), `workspace_id: ${missingID}\n`)
      await registerWorkspace(missingPath, "deleted", undefined, missingID)
      rmSync(missingPath, { recursive: true, force: true })

      const output: string[] = []
      const errors: string[] = []
      const result = await runLaunchBootHealth({
        syncOpenCodeCompat: skipOpenCodeCompat,
        searchRoots: [root],
        out: (message) => output.push(message),
        err: (message) => errors.push(message),
      })

      expect(errors).toEqual([])
      expect(output).toEqual([formatLaunchBootMissing(1)])
      expect(result.workspaces.find((workspace) => workspace.indexedPath === missingPath)?.status).toBe("non_existent")
      expect(result.workspaces.find((workspace) => workspace.indexedPath === oldPath)?.status).toBe("moved")

      const entries = await loadRegistry(undefined, { allowMissingMarker: true })
      expect(entries.find((entry) => entry.path === missingPath)?.presence).toBe("non_existent")
      expect(entries.find((entry) => entry.path === movedPath)?.presence).toBe("present")
      expect(entries.some((entry) => entry.path === oldPath)).toBe(false)
    })
  })

  test("runs the OpenCode Console compat probe before workspace index", async () => {
    const order: string[] = []
    await runLaunchBootHealth({
      syncOpenCodeCompat: async () => {
        order.push("compat")
        return { version: "1.18.31", source: "npm" }
      },
      runHealth: async () => {
        order.push("health")
        return health()
      },
      out: () => {},
      err: () => {},
    })
    expect(order).toEqual(["compat", "health"])
  })
})
