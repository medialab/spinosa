import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getWorkspaceLaunchDecision, STARTUP_PROMPT_FALLBACK } from "../../src/spinosa/workspace-launch"

async function createWorkspace(
  setupStatus: "cli_started" | "workspace_started" | "importing" | "not_started",
  options?: { projectName?: string },
) {
  const workspace = mkdtempSync(path.join(tmpdir(), "spinosa-tui-launch-"))
  mkdirSync(path.join(workspace, ".spinosa"), { recursive: true })
  try {
    await Bun.write(
      path.join(workspace, ".spinosa", "workspace"),
      [
        options?.projectName ? `project_name: ${options.projectName}` : "",
        `setup_status: ${setupStatus}`,
        "framework_version: 0.1.0",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    return workspace
  } catch (error) {
    rmSync(workspace, { recursive: true, force: true })
    throw error
  }
}

describe("getWorkspaceLaunchDecision", () => {
  test("requires a startup choice only for cli_started workspaces", async () => {
    const workspace = await createWorkspace("cli_started", { projectName: "launch-me" })
    try {
      const launch = await getWorkspaceLaunchDecision(workspace)
      expect(launch).toEqual({
        type: "startup-choice",
        workspacePath: workspace,
        workspaceName: "launch-me",
        prompt: STARTUP_PROMPT_FALLBACK,
      })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("opens chat directly for workspace_started workspaces", async () => {
    const workspace = await createWorkspace("workspace_started")
    try {
      const launch = await getWorkspaceLaunchDecision(workspace)
      expect(launch).toEqual({ type: "open" })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("asks what to do for importing (incomplete-import) workspaces", async () => {
    const workspace = await createWorkspace("importing", { projectName: "half-imported" })
    try {
      const launch = await getWorkspaceLaunchDecision(workspace)
      expect(launch).toEqual({
        type: "incomplete-import",
        workspacePath: workspace,
        workspaceName: "half-imported",
      })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("opens onboarding directly for not_started workspaces (no interstitial)", async () => {
    const workspace = await createWorkspace("not_started")
    try {
      const launch = await getWorkspaceLaunchDecision(workspace)
      expect(launch).toEqual({ type: "open" })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
