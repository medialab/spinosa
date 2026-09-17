import { describe, expect, test } from "bun:test"
import {
  LAUNCH_STATUS_CHECKING,
  LAUNCH_STATUS_NO_UPDATES,
  LAUNCH_STATUS_UPGRADE_DONE,
  runLaunchPreflight,
  type PreflightDependencies,
} from "../../src/spinosa-cli/commands/preflight"

function dependencies(overrides: Partial<PreflightDependencies> = {}) {
  const output: string[] = []
  const updated: string[] = []
  const deps: PreflightDependencies = {
    checkUpgradeAvailable: async () => ({ available: false }),
    upgradeFramework: async () => ({
      success: true,
      newVersion: "1.1.0",
      workspaceUpgradesNeeded: ["/work/alpha", "/work/beta"],
    }),
    updateWorkspace: async (workspace) => {
      updated.push(workspace)
      return { success: true, added: 0, updated: 1, removed: 0, skipped: 0, changes: true }
    },
    confirm: async () => false,
    frameworkRoot: (version) => `/home/versions/${version}`,
    canPrompt: () => false,
    listPackCheckCandidates: async () => [],
    currentFrameworkRoot: () => undefined,
    out: (message) => output.push(message),
    ...overrides,
  }
  return { deps, output, updated }
}

describe("launch preflight", () => {
  test("continues directly when the installed version is current", async () => {
    const { deps, output } = dependencies()

    expect(await runLaunchPreflight(deps)).toBe("continue")
    expect(output).toEqual([LAUNCH_STATUS_CHECKING, LAUNCH_STATUS_NO_UPDATES])
  })

  test("continues when the user declines an available upgrade", async () => {
    const questions: string[] = []
    const { deps } = dependencies({
      checkUpgradeAvailable: async () => ({ available: true, currentVersion: "1.0.0", latestVersion: "1.1.0" }),
      confirm: async (question) => { questions.push(question); return false },
    })

    expect(await runLaunchPreflight(deps)).toBe("continue")
    expect(questions).toEqual(["\x1b[36m?\x1b[0m \x1b[1mSpinosa v1.1.0\x1b[0m is available (current \x1b[32mv1.0.0\x1b[0m). Upgrade now?"])
  })

  test("upgrades outdated workspaces and exits without auto-launching", async () => {
    const answers = [true, true]
    const roots: string[] = []
    const { deps, output, updated } = dependencies({
      checkUpgradeAvailable: async () => ({ available: true, currentVersion: "1.0.0", latestVersion: "1.1.0" }),
      confirm: async () => answers.shift() ?? false,
      updateWorkspace: async (workspace, root) => {
        updated.push(workspace)
        roots.push(root)
        return { success: true, added: 0, updated: 1, removed: 0, skipped: 0, changes: true }
      },
    })

    expect(await runLaunchPreflight(deps)).toBe("exit")
    expect(updated).toEqual(["/work/alpha", "/work/beta"])
    expect(roots).toEqual(["/home/versions/1.1.0", "/home/versions/1.1.0"])
    expect(output.at(-1)).toBe(LAUNCH_STATUS_UPGRADE_DONE)
  })

  test("does not claim success when the framework upgrade fails", async () => {
    const { deps, output } = dependencies({
      checkUpgradeAvailable: async () => ({ available: true, currentVersion: "1.0.0", latestVersion: "1.1.0" }),
      confirm: async () => true,
      upgradeFramework: async () => ({
        success: false,
        workspaceUpgradesNeeded: [],
        error: "Installer checksum verification failed",
      }),
    })

    await expect(runLaunchPreflight(deps)).rejects.toThrow(
      "Spinosa upgrade failed: Installer checksum verification failed",
    )
    expect(output).toEqual([LAUNCH_STATUS_CHECKING])
  })

  test("still exits cleanly when one workspace update throws", async () => {
    const answers = [true, true]
    const { deps, output } = dependencies({
      checkUpgradeAvailable: async () => ({ available: true, currentVersion: "1.0.0", latestVersion: "1.1.0" }),
      upgradeFramework: async () => ({
        success: true,
        newVersion: "1.1.0",
        workspaceUpgradesNeeded: ["/work/missing"],
      }),
      confirm: async () => answers.shift() ?? false,
      updateWorkspace: async () => { throw new Error("workspace is missing") },
    })

    expect(await runLaunchPreflight(deps)).toBe("exit")
    expect(output.join("\n")).toContain("Could not update missing: workspace is missing")
    expect(output.at(-1)).toBe(LAUNCH_STATUS_UPGRADE_DONE)
  })
})
