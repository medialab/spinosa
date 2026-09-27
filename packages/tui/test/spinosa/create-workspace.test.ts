import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { resolveFrameworkRoot } from "@spinosa/core/framework/discovery"
import { createWorkspace } from "@spinosa/core/commands/create"
import { validateWorkspace } from "@spinosa/core/workspace/registry"
import { readWorkspaceMeta } from "@spinosa/core/workspace/meta"
import { writeWorkspaceStatus } from "@spinosa/core/workspace/meta"
import { cleanupCreatedWorkspaces, trackCreatedWorkspace } from "../fixture/spinosa-test-home"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

function frameworkRoot(): string {
  return repoRoot
}

let corpusDir: string
let testRoot: string

beforeAll(() => {
  // Create a temporary corpus (simulates a user folder they want to import)
  testRoot = mkdtempSync(path.join(tmpdir(), "spinosa-e2e-"))
  corpusDir = path.join(testRoot, "my-project")
  mkdirSync(corpusDir, { recursive: true })
  writeFileSync(path.join(corpusDir, "README.md"), "# My Project\n")
  writeFileSync(path.join(corpusDir, "data.csv"), "a,b,c\n1,2,3\n")
})

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

afterEach(async () => {
  await cleanupCreatedWorkspaces()
})

async function createTrackedWorkspace(options: Parameters<typeof createWorkspace>[0]) {
  const result = await createWorkspace(options)
  if (result.success) trackCreatedWorkspace(result.workspacePath)
  return result
}

describe("E2E: Workspace creation flow", () => {
  test("resolveFrameworkRoot finds the repo root", () => {
    const root = frameworkRoot()
    expect(root).toBeTruthy()
    // Verify the marker exists at the expected path
    const marker = path.join(root, "workspace-template", ".spinosa", "workspace-files.tsv")
    expect(existsSync(marker)).toBe(true)
  })

  test("createWorkspace succeeds with valid framework root", async () => {
    const root = frameworkRoot()
    expect(root).toBeTruthy()

    const result = await createTrackedWorkspace({
      corpusPath: corpusDir,
      frameworkRoot: root,
      workspaceName: "e2e-test-workspace",
    })

    // Verify success
    expect(result.success).toBe(true)
    expect(result.workspacePath).toBeTruthy()

    // Verify workspace structure
    const ws = result.workspacePath
    expect(validateWorkspace(ws)).toBe(true)

    // Check canonical workspace paths
    expect(existsSync(path.join(ws, ".spinosa", "workspace"))).toBe(true)
    expect(existsSync(path.join(ws, "AGENTS.md"))).toBe(true)
    expect(existsSync(path.join(ws, "startup-prompt.md"))).toBe(true)
    expect(existsSync(path.join(ws, ".bin", "spinosa"))).toBe(true)
    expect(existsSync(path.join(ws, ".bin", "run-with-timeout.ts"))).toBe(false)
    expect(existsSync(path.join(ws, ".agents"))).toBe(true)
    expect(existsSync(path.join(ws, ".spinosa", "framework-checksums.json"))).toBe(true)
    const checksums = await Bun.file(path.join(ws, ".spinosa", "framework-checksums.json")).json() as Record<string, string>
    expect(Object.keys(checksums).length).toBeGreaterThan(10)
    expect(existsSync(path.join(ws, ".spinosa", "agents"))).toBe(true)
    expect(existsSync(path.join(ws, ".opencode"))).toBe(false)
    expect(existsSync(path.join(ws, ".claude"))).toBe(false)
    expect(existsSync(path.join(ws, ".codex"))).toBe(false)
    expect(existsSync(path.join(ws, ".hermes"))).toBe(false)
    expect(existsSync(path.join(ws, "CLAUDE.md"))).toBe(false)

    // Check user-state directories
    expect(existsSync(path.join(ws, "raw"))).toBe(true)
    expect(existsSync(path.join(ws, "raw", ".gitkeep"))).toBe(true)
    expect(existsSync(path.join(ws, "maps"))).toBe(true)
    expect(existsSync(path.join(ws, ".logs"))).toBe(true)
    expect(existsSync(path.join(ws, "agent_reports"))).toBe(true)
    expect(existsSync(path.join(ws, ".trash"))).toBe(true)

    // Check deleted legacy workspace layout should NOT exist
    expect(existsSync(path.join(ws, "framework", "spinosa", "workspace"))).toBe(false)
  })

  test("readWorkspaceMeta returns correct metadata", async () => {
    const root = frameworkRoot()
    expect(root).toBeTruthy()

    const result = await createTrackedWorkspace({
      corpusPath: corpusDir,
      frameworkRoot: root,
      workspaceName: "e2e-meta-test",
    })

    expect(result.success).toBe(true)

    const meta = await readWorkspaceMeta(result.workspacePath)
    expect(meta).toBeTruthy()
    expect(meta!.projectName).toBe("e2e-meta-test")
    expect(meta!.setupStatus).toBe("not_started")
    expect(meta!.workspaceID).toMatch(/^spw_01_[0-9a-f]{32}$/)
  })

  test("second workspace creation auto-increments name", async () => {
    const root = frameworkRoot()
    expect(root).toBeTruthy()

    const ws1 = await createTrackedWorkspace({
      corpusPath: corpusDir,
      frameworkRoot: root,
      workspaceName: "e2e-dup-test",
    })
    expect(ws1.success).toBe(true)

    // Same name should create a numbered variant
    const ws2 = await createTrackedWorkspace({
      corpusPath: corpusDir,
      frameworkRoot: root,
      workspaceName: "e2e-dup-test",
    })
    expect(ws2.success).toBe(true)
    expect(ws2.workspacePath).not.toBe(ws1.workspacePath)
  })

  test("reuses an interrupted import workspace and preserves partial output", async () => {
    const root = frameworkRoot()
    expect(root).toBeTruthy()
    const first = await createTrackedWorkspace({
      corpusPath: corpusDir,
      frameworkRoot: root,
      workspaceName: "e2e-resume-test",
    })
    await writeWorkspaceStatus(first.workspacePath, "importing")
    const before = (await readWorkspaceMeta(first.workspacePath))!.workspaceID
    await Bun.write(path.join(first.workspacePath, "raw", "partial.md"), "partial\n")

    const resumed = await createTrackedWorkspace({
      corpusPath: corpusDir,
      frameworkRoot: root,
      workspaceName: "a-name-that-would-not-find-the-interrupted-workspace",
      resumeWorkspacePath: first.workspacePath,
    })

    expect(resumed.workspacePath).toBe(first.workspacePath)
    expect(resumed.resumed).toBe(true)
    expect((await readWorkspaceMeta(resumed.workspacePath))!.workspaceID).toBe(before)
    expect(await Bun.file(path.join(resumed.workspacePath, "raw", "partial.md")).text()).toBe("partial\n")
  })

  test("failed workspace creation cleans up reserved directory", async () => {
    const result = await createTrackedWorkspace({
      corpusPath: corpusDir,
      frameworkRoot: path.join(testRoot, "missing-framework"),
      workspaceName: "e2e-cleanup-test",
    })

    expect(result.success).toBe(false)
    expect(existsSync(result.workspacePath)).toBe(false)
  })
})
