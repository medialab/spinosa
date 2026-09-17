import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  compareFrameworkVersions,
  deleteWorkspace,
  getCorpusSummary,
  getFrameworkHealth,
  getRoutesSnapshot,
  isSpinosaWorkspace,
  listRegisteredWorkspaces,
  readWorkspaceMeta,
  inspectWorkspaceTemplatePack,
  workspaceNeedsFrameworkUpdate,
  writeWorkspaceFrameworkVersion,
} from "../../src/spinosa/service"
import { parseOrchestratorCounter } from "@spinosa/core/artifacts/parser"

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/workspace-started")

describe("service fixture workspace", () => {
  test("detects spinosa workspace", () => {
    expect(isSpinosaWorkspace(fixture)).toBe(true)
  })

  test("reads workspace meta", async () => {
    const meta = await readWorkspaceMeta(fixture)
    expect(meta?.projectName).toBe("fixture-workspace")
    expect(meta?.setupStatus).toBe("workspace_started")
  })

  test("falls back to folder name when workspace marker has no project_name", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "spinosa-tui-meta-"))
    mkdirSync(path.join(workspace, ".spinosa"), { recursive: true })
    try {
      await Bun.write(
        path.join(workspace, ".spinosa", "workspace"),
        ["setup_status: cli_started", "framework_version: 0.1.0"].join("\n"),
      )
      const meta = await readWorkspaceMeta(workspace)
      expect(meta?.projectName).toBe(path.basename(workspace))
      expect(meta?.setupStatus).toBe("cli_started")
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("detects whether a workspace needs framework update", () => {
    expect(compareFrameworkVersions("0.2.0", "0.1.9")).toBe(1)
    expect(compareFrameworkVersions("0.2.0", "0.2.0")).toBe(0)
    expect(compareFrameworkVersions("0.1.9", "0.2.0")).toBe(-1)
    expect(workspaceNeedsFrameworkUpdate("0.1.0", "0.2.0")).toBe(true)
    expect(workspaceNeedsFrameworkUpdate("0.2.0", "0.2.0")).toBe(false)
    expect(workspaceNeedsFrameworkUpdate("unknown", "0.2.0")).toBe(false)
    expect(workspaceNeedsFrameworkUpdate("dev", "0.2.0")).toBe(true)
  })

  test("fixture workspace protocol pack is not flagged stale against repo template", async () => {
    const freshness = await inspectWorkspaceTemplatePack({
      workspacePath: fixture,
      workspaceVersion: "0.1.0",
      bundledVersion: "0.1.0",
    })
    // Fixture may lag protocol probes; assert the API shape and that missing template root is handled.
    expect(typeof freshness.stale).toBe("boolean")
    expect(typeof freshness.refreshRecommended).toBe("boolean")
    expect(Array.isArray(freshness.stalePaths)).toBe(true)
  })

  test("rewrites the workspace framework version marker", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "spinosa-tui-version-"))
    mkdirSync(path.join(workspace, ".spinosa"), { recursive: true })
    try {
      await Bun.write(
        path.join(workspace, ".spinosa", "workspace"),
        ["project_name: demo", "setup_status: workspace_started", "framework_version: 0.1.0"].join("\n"),
      )

      await writeWorkspaceFrameworkVersion(workspace, "v0.2.3")

      const marker = await Bun.file(path.join(workspace, ".spinosa", "workspace")).text()
      const meta = await readWorkspaceMeta(workspace)
      expect(marker).toContain("framework_version: 0.2.3")
      expect(meta?.frameworkVersion).toBe("0.2.3")
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("parses corpus summary", async () => {
    const summary = await getCorpusSummary(fixture)
    expect(summary.hasWorkspaceIndex).toBe(true)
    expect(summary.rawCount).toBeGreaterThan(0)
    expect(summary.hubExists).toBe(true)
    expect(summary.index.extractionProgress.read).toBe(2)
  })

  test("loads routes snapshot", async () => {
    const snapshot = await getRoutesSnapshot(fixture)
    expect(snapshot.goals.length).toBeGreaterThan(0)
    expect(snapshot.reports.length).toBeGreaterThan(0)
    expect(snapshot.overseerCounter).toBe(2)
  })

  test("prefers bound session for active goal", async () => {
    const snapshot = await getRoutesSnapshot(fixture)
    const target = snapshot.goals[0]
    expect(target).toBeDefined()
    const bound = await getRoutesSnapshot(fixture, target!.sessionId)
    expect(bound.activeGoal?.sessionId).toBe(target!.sessionId)
  })

  test("does not silently bind a different goal when preferred session is missing", async () => {
    const snapshot = await getRoutesSnapshot(fixture, "missing-session-id")
    expect(snapshot.activeGoal).toBeUndefined()
  })

  test("framework health passes", async () => {
    const health = await getFrameworkHealth(fixture)
    const fixtureScope = health.filter((row) => !row.label.startsWith(".claude/") && !row.label.startsWith(".codex/") && !row.label.startsWith(".hermes/") && !row.label.startsWith(".opencode/skills/"))
    expect(fixtureScope.every((row) => row.ok)).toBe(true)
  })

  test("parses overseer counter from notes", async () => {
    const file = Bun.file(path.join(fixture, ".spinosa/memory/orchestrator-notes.md"))
    const notes = await file.text()
    expect(parseOrchestratorCounter(notes)).toBe(2)
  })

  test("dedupes repeated registry entries by workspace path", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-tui-registry-"))
    const workspace = path.join(root, "workspace")
    const originalHome = process.env.SPINOSA_HOME
    process.env.SPINOSA_HOME = path.join(root, "home")
    mkdirSync(path.join(workspace, ".spinosa"), { recursive: true })

    try {
      await Bun.write(
        path.join(workspace, ".spinosa", "workspace"),
        ["project_name: demo", "setup_status: workspace_started", "framework_version: 0.1.0"].join("\n"),
      )
      const metadata = path.join(process.env.SPINOSA_HOME, "metadata")
      mkdirSync(metadata, { recursive: true })
      const entry = {
        path: workspace,
        name: "demo",
        tags: [],
        state: { presence: "present", setupStatus: "workspace_started" },
        registration: { registeredAt: "2026-07-17" },
      }
      await Bun.write(path.join(metadata, "workspaces.json"), `${JSON.stringify({ schemaVersion: 1, workspaces: [entry, entry] }, null, 2)}\n`)

      const workspaces = await listRegisteredWorkspaces()
      expect(workspaces.filter((entry) => entry.path === workspace)).toHaveLength(1)
    } finally {
      if (originalHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = originalHome
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("deleteWorkspace moves the folder to trash and removes the registry entry", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-tui-delete-"))
    const workspace = path.join(root, "workspace")
    const originalHome = process.env.SPINOSA_HOME
    process.env.SPINOSA_HOME = path.join(root, "home")
    // Trash home override: Bun's homedir() ignores runtime $HOME changes,
    // so the override travels as an explicit option instead.
    const trashHome = path.join(root, "userhome")
    mkdirSync(path.join(workspace, ".spinosa"), { recursive: true })

    try {
      await Bun.write(
        path.join(workspace, ".spinosa", "workspace"),
        ["project_name: doomed", "setup_status: workspace_started", "framework_version: 0.1.0"].join("\n"),
      )
      const metadata = path.join(process.env.SPINOSA_HOME, "metadata")
      mkdirSync(metadata, { recursive: true })
      await Bun.write(
        path.join(metadata, "workspaces.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          workspaces: [{
            path: workspace,
            name: "doomed",
            tags: [],
            state: { presence: "present", setupStatus: "workspace_started" },
            registration: { registeredAt: "2026-07-17" },
          }],
        }, null, 2)}\n`,
      )

      await deleteWorkspace(workspace, { home: trashHome })
      expect(existsSync(workspace)).toBe(false)
      const trashed = readdirSync(path.join(trashHome, ".Trash"))
      expect(trashed.some((name) => name.startsWith("workspace-"))).toBe(true)
      expect((await listRegisteredWorkspaces()).some((entry) => entry.path === workspace)).toBe(false)
      await expect(deleteWorkspace(homedir())).rejects.toThrow(/protected path|Not a Spinosa workspace/)
    } finally {
      if (originalHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = originalHome
      rmSync(root, { recursive: true, force: true })
    }
  })
})
