import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { defaultRegistry, type OrchestratedDecision } from "@spinosa/runtime"
import { spinosaMap } from "../src/application/spinosa-map"
import { writeWorkflowGoalArtifact } from "../src/artifacts/goal"
import { validateArtifact } from "../src/artifacts/validate"
import { createWorkspace } from "../src/commands/create"
import { generateAddPrompt } from "../src/commands/startup"
import { resolvePathWithinRoot } from "../src/utils/path"

function tempRoot(label: string): string {
  return mkdtempSync(path.join(tmpdir(), `spinosa-${label}-`))
}

function makeWorkspace(root: string): void {
  mkdirSync(path.join(root, ".spinosa"), { recursive: true })
  writeFileSync(path.join(root, ".spinosa", "workspace"), "setup_status: workspace_started\n")
}

function workflowPlan() {
  const decision: OrchestratedDecision = {
    mode: "orchestrated",
    operation: "research",
    strategy: "targeted_evidence",
    scope: "subset",
    coverage: "sufficient",
    outputs: ["report"],
    mutation: "none",
    verification: "normal",
    evaluation: "always",
    reason: "test",
    confidence: 1,
  }
  return { decision, plan: defaultRegistry.resolve(decision).build({ runID: "r1", decision }) }
}

describe("canonical workspace containment", () => {
  test("allows a workspace root symlink and rejects outside or dangling descendants", () => {
    const sandbox = tempRoot("path-boundary")
    try {
      const realRoot = path.join(sandbox, "workspace")
      const linkedRoot = path.join(sandbox, "workspace-link")
      const outside = path.join(sandbox, "outside")
      mkdirSync(path.join(realRoot, "maps"), { recursive: true })
      mkdirSync(outside)
      symlinkSync(realRoot, linkedRoot, "dir")

      expect(resolvePathWithinRoot(linkedRoot, "maps/topic.md")).toBe(path.join(linkedRoot, "maps", "topic.md"))

      symlinkSync(outside, path.join(realRoot, "agent_reports"), "dir")
      expect(() => resolvePathWithinRoot(linkedRoot, "agent_reports/report.md", "artifact path")).toThrow(/symlink/i)

      symlinkSync(path.join(sandbox, "missing-target.md"), path.join(realRoot, "maps", "dangling.md"))
      expect(() => resolvePathWithinRoot(linkedRoot, "maps/dangling.md", "artifact path")).toThrow(/symlink/i)

      const danglingRoot = path.join(sandbox, "dangling-root")
      symlinkSync(path.join(sandbox, "missing-workspace"), danglingRoot, "dir")
      expect(() => resolvePathWithinRoot(danglingRoot, "maps/topic.md", "artifact path")).toThrow(/symlink/i)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

describe("workspace artifact boundaries", () => {
  test("map reads and writes do not follow a maps symlink outside the workspace", async () => {
    const sandbox = tempRoot("map-boundary")
    try {
      const workspace = path.join(sandbox, "workspace")
      const outside = path.join(sandbox, "outside")
      makeWorkspace(workspace)
      mkdirSync(outside)
      writeFileSync(path.join(outside, "existing.md"), "# Existing\n\n[[raw/source]]\n")
      symlinkSync(outside, path.join(workspace, "maps"), "dir")

      const checked = await spinosaMap({
        action: "check",
        workspacePath: workspace,
        relativePath: "maps/existing.md",
      })
      expect(checked.ok).toBe(false)

      const written = await spinosaMap({
        action: "write_map",
        workspacePath: workspace,
        mapPath: "maps/victim.md",
        mapKind: "theme",
        title: "Victim",
        body: "[[raw/source]]",
      })
      expect(written.ok).toBe(false)
      expect(existsSync(path.join(outside, "victim.md"))).toBe(false)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  test("artifact validation and atomic goal writes reject an external agent_reports symlink", async () => {
    const sandbox = tempRoot("artifact-boundary")
    try {
      const workspace = path.join(sandbox, "workspace")
      const outside = path.join(sandbox, "outside")
      makeWorkspace(workspace)
      mkdirSync(outside)
      writeFileSync(path.join(outside, "report.md"), "# External report\n")
      symlinkSync(outside, path.join(workspace, "agent_reports"), "dir")

      const checked = await validateArtifact({
        workspacePath: workspace,
        relativePath: "agent_reports/report.md",
        validator: "report",
      })
      expect(checked).toMatchObject({ ok: false, retryable: false })

      const { decision, plan } = workflowPlan()
      await expect(writeWorkflowGoalArtifact(workspace, {
        runID: "r1",
        cleanedPrompt: "compare cohorts",
        decision,
        plan,
      })).rejects.toThrow(/symlink/i)
      expect(existsSync(path.join(outside, "g_r1.md"))).toBe(false)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

describe("workspace creation cleanup", () => {
  test("keeps a resumed importing workspace when the framework template is missing", async () => {
    const sandbox = tempRoot("resume-cleanup")
    try {
      const corpus = path.join(sandbox, "corpus")
      const workspace = path.join(sandbox, "workspace")
      mkdirSync(corpus)
      mkdirSync(path.join(workspace, ".spinosa"), { recursive: true })
      writeFileSync(
        path.join(workspace, ".spinosa", "workspace"),
        `setup_status: importing\nsource_location: ${path.resolve(corpus)}\n`,
      )
      writeFileSync(path.join(workspace, "keep.txt"), "user state")

      const result = await createWorkspace({
        corpusPath: corpus,
        frameworkRoot: path.join(sandbox, "missing-framework"),
        resumeWorkspacePath: workspace,
      })

      expect(result.success).toBe(false)
      expect(existsSync(path.join(workspace, "keep.txt"))).toBe(true)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  test("still removes a freshly reserved workspace when the framework template is missing", async () => {
    const sandbox = tempRoot("fresh-cleanup")
    try {
      const corpus = path.join(sandbox, "corpus")
      const workspaceName = "fresh-workspace"
      const workspace = path.join(sandbox, workspaceName)
      mkdirSync(corpus)

      const result = await createWorkspace({
        corpusPath: corpus,
        frameworkRoot: path.join(sandbox, "missing-framework"),
        workspaceName,
      })

      expect(result.success).toBe(false)
      expect(existsSync(workspace)).toBe(false)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

describe("startup raw corpus walk", () => {
  test("does not count Markdown through symlinked directories or a symlinked raw root", async () => {
    const sandbox = tempRoot("startup-walk")
    try {
      const workspace = path.join(sandbox, "workspace")
      const outside = path.join(sandbox, "outside")
      mkdirSync(path.join(workspace, "raw"), { recursive: true })
      mkdirSync(outside)
      writeFileSync(path.join(workspace, "raw", "inside.md"), "# inside\n")
      writeFileSync(path.join(outside, "outside.md"), "# outside\n")
      symlinkSync(outside, path.join(workspace, "raw", "linked"), "dir")

      const nestedPrompt = await generateAddPrompt(workspace, "spinosa")
      expect(nestedPrompt).toContain("approximately 1 Markdown files")

      rmSync(path.join(workspace, "raw"), { recursive: true })
      symlinkSync(outside, path.join(workspace, "raw"), "dir")
      const rootPrompt = await generateAddPrompt(workspace, "spinosa")
      expect(rootPrompt).toContain("approximately 0 Markdown files")
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})
