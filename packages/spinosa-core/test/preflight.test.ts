import { describe, expect, test } from "bun:test"
import {
  LAUNCH_STATUS_CHECKING,
  LAUNCH_STATUS_LAUNCHING,
  LAUNCH_STATUS_NO_UPDATES,
  LAUNCH_STATUS_UPGRADE_DONE,
  offerStaleTemplatePackUpdates,
  runLaunchPreflight,
  type PreflightDependencies,
} from "../src/commands/preflight"
import type { TemplatePackFreshness } from "../src/framework/template-pack-freshness"

function freshness(overrides: Partial<TemplatePackFreshness> = {}): TemplatePackFreshness {
  return {
    stale: true,
    refreshRecommended: true,
    versionBehind: false,
    protocolBehind: true,
    stalePaths: ["AGENTS.md", "startup-prompt.md"],
    missingPaths: [],
    message: "stale",
    ...overrides,
  }
}

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
    currentFrameworkRoot: () => "/framework",
    listPackCheckCandidates: async () => [],
    canPrompt: () => false,
    out: (message) => output.push(message),
    sleep: async () => {},
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

  test("offers stale template pack update and continues into TUI after accept", async () => {
    const forced: boolean[] = []
    const updated: string[] = []
    let inspectCalls = 0
    const { deps, output } = dependencies({
      canPrompt: () => true,
      listPackCheckCandidates: async () => ["/work/stale"],
      inspectPack: async () => {
        inspectCalls++
        if (inspectCalls === 1) return freshness()
        return freshness({
          refreshRecommended: false,
          stale: false,
          protocolBehind: false,
          stalePaths: [],
          missingPaths: [],
        })
      },
      confirm: async () => true,
      updateWorkspace: async (workspace, _root, options) => {
        updated.push(workspace)
        forced.push(Boolean(options?.force))
        return { success: true, added: 0, updated: 1, removed: 0, skipped: 0, changes: true }
      },
    })

    expect(await runLaunchPreflight(deps)).toBe("continue")
    expect(updated).toEqual(["/work/stale"])
    expect(forced).toEqual([true])
    expect(inspectCalls).toBe(2)
    expect(output.join("\n")).toContain("Workspace template pack update available for 1 workspace(s):")
    expect(output.join("\n")).toContain("stale — AGENTS.md, startup-prompt.md")
    expect(output.join("\n")).toContain("Updated stale — template pack current")
    expect(output.join("\n")).not.toContain(LAUNCH_STATUS_UPGRADE_DONE)
  })

  test("reports when forced pack update leaves probes stale", async () => {
    const { deps, output, updated } = dependencies({
      canPrompt: () => true,
      listPackCheckCandidates: async () => ["/work/stale"],
      inspectPack: async () => freshness({ stalePaths: [".agents/references/classification.md"] }),
      confirm: async () => true,
      updateWorkspace: async (workspace) => {
        updated.push(workspace)
        return { success: true, added: 0, updated: 0, removed: 0, skipped: 10, changes: false }
      },
    })

    expect(await runLaunchPreflight(deps)).toBe("continue")
    expect(updated).toEqual(["/work/stale"])
    expect(output.join("\n")).toContain("stale still stale after update: .agents/references/classification.md")
    expect(output.join("\n")).toContain("1 workspace update(s) failed; run 'spinosa update <workspace> --force' to retry.")
  })

  test("continues without updating when user declines pack refresh", async () => {
    const { deps, output, updated } = dependencies({
      canPrompt: () => true,
      listPackCheckCandidates: async () => ["/work/stale"],
      inspectPack: async () => freshness(),
      confirm: async () => false,
    })

    expect(await runLaunchPreflight(deps)).toBe("continue")
    expect(updated).toEqual([])
    expect(output).toContain("Continuing without updating — you can run Update workspace from Home later.")
  })

  test("skips pack prompt when non-interactive", async () => {
    const { deps, output, updated } = dependencies({
      canPrompt: () => false,
      listPackCheckCandidates: async () => ["/work/stale"],
      inspectPack: async () => freshness(),
    })

    expect(await runLaunchPreflight(deps)).toBe("continue")
    expect(updated).toEqual([])
    expect(output).toEqual([LAUNCH_STATUS_CHECKING, LAUNCH_STATUS_NO_UPDATES])
  })
})

describe("offerStaleTemplatePackUpdates", () => {
  test("uses target workspace candidates when provided", async () => {
    const seen: Array<string | undefined> = []
    let inspectCalls = 0
    const { deps, updated } = dependencies({
      canPrompt: () => true,
      listPackCheckCandidates: async (target) => {
        seen.push(target)
        return target ? [target] : []
      },
      inspectPack: async () => {
        inspectCalls++
        if (inspectCalls === 1) return freshness()
        return freshness({
          refreshRecommended: false,
          stale: false,
          protocolBehind: false,
          stalePaths: [],
          missingPaths: [],
        })
      },
      confirm: async () => true,
    })

    await offerStaleTemplatePackUpdates(deps, { targetWorkspace: "/work/target" })
    expect(seen).toEqual(["/work/target"])
    expect(updated).toEqual(["/work/target"])
  })
})

describe("launch status constants", () => {
  test("exports stable launch status lines", () => {
    expect(LAUNCH_STATUS_LAUNCHING).toBe("Launching TUI...")
  })
})
