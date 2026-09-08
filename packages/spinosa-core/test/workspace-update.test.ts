import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { updateWorkspace } from "../src/commands/update"
import { writeWorkspaceFrameworkVersion } from "../src/workspace/meta"
import { registerWorkspace } from "../src/workspace/registry"

const previousSpinosaHome = process.env.SPINOSA_HOME

afterEach(() => {
  if (previousSpinosaHome === undefined) delete process.env.SPINOSA_HOME
  else process.env.SPINOSA_HOME = previousSpinosaHome
})

describe("workspace metadata and updates", () => {
  test("writes framework version to a legacy workspace marker", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "spinosa-meta-"))
    const marker = path.join(workspace, "framework", "spinosa", "workspace")

    try {
      await mkdir(path.dirname(marker), { recursive: true })
      await writeFile(marker, "framework_version: 1.0.0\n")

      await writeWorkspaceFrameworkVersion(workspace, "v1.2.3")

      expect(await readFile(marker, "utf8")).toContain("framework_version: 1.2.3")
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test("reports a registered invalid workspace update as unsuccessful", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "spinosa-update-"))
    const spinosaHome = await mkdtemp(path.join(os.tmpdir(), "spinosa-home-"))
    const marker = path.join(workspace, ".spinosa", "workspace")
    const workspaceID = `spw_01_${"a".repeat(32)}`

    try {
      process.env.SPINOSA_HOME = spinosaHome
      await mkdir(path.dirname(marker), { recursive: true })
      await writeFile(marker, `workspace_id: ${workspaceID}\n`)
      await registerWorkspace(workspace, "test")
      await rm(marker)

      const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot: path.join(spinosaHome, "framework") })

      expect(result).toMatchObject({
        success: false,
        skipped: 0,
        presence: "invalid",
        error: "Workspace is invalid",
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(spinosaHome, { recursive: true, force: true })
    }
  })
})
