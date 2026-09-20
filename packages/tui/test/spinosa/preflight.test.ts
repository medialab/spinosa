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
      workspaceUpgradesNeeded: [],
    }),
    updateWorkspace: async (workspace) => {
      updated.push(workspace)
      return { success: true, added: 0, updated: 1, removed: 0, skipped: 0, changes: true }
    },
    confirm: async () => false,
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

  test("exits after a Spinosa upgrade without updating workspaces", async () => {
    const upgrades: Array<{ version?: string } | undefined> = []
    const { deps, output, updated } = dependencies({
      checkUpgradeAvailable: async () => ({ available: true, currentVersion: "1.0.0", latestVersion: "1.1.0" }),
      confirm: async () => true,
      upgradeFramework: async (options) => {
        upgrades.push(options)
        return { success: true, newVersion: "1.1.0", workspaceUpgradesNeeded: [] }
      },
    })

    expect(await runLaunchPreflight(deps)).toBe("exit")
    expect(upgrades).toEqual([{ version: "1.1.0" }])
    expect(updated).toEqual([])
    expect(output.at(-1)).toBe(LAUNCH_STATUS_UPGRADE_DONE)
  })

  // An optional upgrade must never block launch: the host exits 1 on a throw.
  test("reports a failed framework upgrade and still continues into the TUI", async () => {
    const { deps, output } = dependencies({
      checkUpgradeAvailable: async () => ({ available: true, currentVersion: "1.0.0", latestVersion: "1.1.0" }),
      confirm: async () => true,
      upgradeFramework: async () => ({
        success: false,
        workspaceUpgradesNeeded: [],
        error: "Installer checksum verification failed",
      }),
    })

    expect(await runLaunchPreflight(deps)).toBe("continue")
    expect(output).not.toContain(LAUNCH_STATUS_UPGRADE_DONE)
    expect(output.some((line) => line.includes("Spinosa upgrade failed: Installer checksum verification failed"))).toBe(
      true,
    )
  })
})
