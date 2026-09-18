import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "../fixture/fixture"
import { updateWorkspace } from "@spinosa/core/commands/update"
import { createWorkspaceID } from "@spinosa/core/workspace/identity"

describe("workspace update flow", () => {
  const repoRoot = path.resolve(import.meta.dir, "../../../..")

  test("skips a registered workspace that is no longer present", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.SPINOSA_HOME
    process.env.SPINOSA_HOME = path.join(tmp.path, "home")
    try {
      const missing = path.join(tmp.path, "deleted-workspace")
      const registry = path.join(process.env.SPINOSA_HOME, "metadata", "workspaces.json")
      await mkdir(path.dirname(registry), { recursive: true })
      await Bun.write(registry, `${JSON.stringify({
        schemaVersion: 1,
        workspaces: [{
          id: createWorkspaceID(),
          path: missing,
          name: "deleted",
          tags: [],
          state: { presence: "non_existent", setupStatus: "unknown" },
          registration: { registeredAt: "2026-07-17" },
        }],
      }, null, 2)}\n`)

      const result = await updateWorkspace({ workspacePath: missing, frameworkRoot: tmp.path })

      expect(result).toMatchObject({ success: true, skipped: 1, changes: false, presence: "non_existent" })
    } finally {
      if (originalHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = originalHome
    }
  })

  test("refreshes stale startup-prompt.md while preserving workspace metadata", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")

    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await Bun.write(path.join(frameworkRoot, "package.json"), JSON.stringify({ version: "1.2.3" }) + "\n")
    await Bun.write(
      path.join(templateRoot, ".spinosa", "workspace-files.tsv"),
      ["path\trole\tupdate_policy", "startup-prompt.md\tframework\talways_replace"].join("\n") + "\n",
    )
    await Bun.write(
      path.join(templateRoot, "startup-prompt.md"),
      ["# Index This Workspace", "", "## Hard ban during startup", "", "Do not invoke spinosa-overseer", ""].join("\n"),
    )
    await Bun.write(
      path.join(workspace, "startup-prompt.md"),
      [
        "# Index This Workspace",
        "",
        "Maps → writer/analyst",
        "extraction_batch_001.md",
        "",
        "## Workspace Metadata",
        "",
        "- **Project title:** FINALSPINOSATEST",
        "- **Preferred CLI:** Spinosa",
        "",
      ].join("\n"),
    )
    await Bun.write(
      path.join(workspace, ".spinosa", "workspace"),
      ["framework_version: 1.2.3", "setup_status: cli_started", "project_name: FINALSPINOSATEST"].join("\n") + "\n",
    )

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })
    expect(result.success).toBe(true)
    const prompt = await Bun.file(path.join(workspace, "startup-prompt.md")).text()
    expect(prompt).toContain("## Hard ban during startup")
    expect(prompt).toContain("Do not invoke spinosa-overseer")
    expect(prompt).not.toContain("extraction_batch_001.md")
    expect(prompt).toContain("## Workspace Metadata")
    expect(prompt).toContain("FINALSPINOSATEST")
  })

  test("updates a workspace from repo-root workspace-template layout", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")

    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(templateRoot, ".logs"), { recursive: true })
    await mkdir(path.join(templateRoot, "docs"), { recursive: true })
    await mkdir(path.join(frameworkRoot, "metadata"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await Bun.write(path.join(frameworkRoot, "metadata", "version"), "1.2.3\n")
    await Bun.write(
      path.join(templateRoot, ".spinosa", "workspace-files.tsv"),
      [
        "path\trole\tupdate_policy",
        "AGENTS.md\tframework\talways_replace",
        "docs/guide.md\tframework\treplace_if_unmodified",
        ".logs/.gitkeep\tframework\treplace_if_unmodified",
      ].join("\n") + "\n",
    )
    await Bun.write(path.join(templateRoot, "AGENTS.md"), "# Agents\n")
    await Bun.write(path.join(templateRoot, "docs", "guide.md"), "# Guide\n")
    await Bun.write(path.join(templateRoot, ".logs", ".gitkeep"), "")
    await Bun.write(
      path.join(workspace, ".spinosa", "workspace"),
      [
        "workspace_version: 1",
        "framework_version: 1.0.0",
        "project_name: demo",
        "setup_status: cli_started",
      ].join("\n") + "\n",
    )
    await mkdir(path.join(workspace, "logs"), { recursive: true })
    await Bun.write(path.join(workspace, "logs", "user.log"), "keep me\n")

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(true)
    expect(await Bun.file(path.join(workspace, "AGENTS.md")).text()).toContain("# Agents")
    expect(await Bun.file(path.join(workspace, "docs", "guide.md")).text()).toContain("# Guide")
    expect(await Bun.file(path.join(workspace, ".spinosa", "workspace")).text()).toContain("framework_version: 1.2.3")
    expect(await Bun.file(path.join(workspace, ".spinosa", "manifest.tsv")).text()).toContain("docs/guide.md\tfile")
    expect(existsSync(path.join(workspace, ".spinosa", "framework-checksums.json"))).toBe(true)
    const checksums = await Bun.file(path.join(workspace, ".spinosa", "framework-checksums.json")).json() as Record<string, string>
    expect(checksums["AGENTS.md"]).toMatch(/^[a-f0-9]{64}$/)
    // Legacy visible logs/ user data is preserved across framework updates
    expect(existsSync(path.join(workspace, "logs", "user.log"))).toBe(true)
    expect(existsSync(path.join(workspace, ".logs", ".gitkeep"))).toBe(true)
  })

  test("rejects traversal paths from a workspace manifest", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    const sentinel = path.join(tmp.path, "sentinel.txt")

    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), "path\trole\tupdate_policy\n")
    await Bun.write(path.join(workspace, ".spinosa", "manifest.tsv"), "path\tkind\n../sentinel.txt\tfile\n")
    await Bun.write(sentinel, "keep\n")

    await expect(updateWorkspace({ workspacePath: workspace, frameworkRoot })).rejects.toThrow("Unsafe workspace manifest path")
    expect(await Bun.file(sentinel).text()).toBe("keep\n")
  })

  test("preserves nested user edits in replace_if_unmodified directories", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")

    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(templateRoot, ".agents"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".agents"), { recursive: true })
    await Bun.write(
      path.join(templateRoot, ".spinosa", "workspace-files.tsv"),
      "path\trole\tupdate_policy\n.agents/\tframework\treplace_if_unmodified\n",
    )
    await Bun.write(path.join(templateRoot, ".agents", "agent.md"), "framework update\n")
    await Bun.write(path.join(templateRoot, ".agents", "new.md"), "new managed file\n")
    await Bun.write(path.join(workspace, ".agents", "agent.md"), "user edit\n")

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(true)
    expect(await Bun.file(path.join(workspace, ".agents", "agent.md")).text()).toBe("user edit\n")
    expect(await Bun.file(path.join(workspace, ".agents", "new.md")).text()).toBe("new managed file\n")
  })

  test("refreshes protocol probe files under .agents even without checksum baseline", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")

    const probeDirs = [
      path.join(".agents", "references"),
      path.join(".agents", "agents"),
      path.join(".agents", "skills", "spinosa-overseer"),
    ]
    for (const root of [templateRoot, workspace]) {
      await mkdir(path.join(root, ".spinosa"), { recursive: true })
      for (const dir of probeDirs) await mkdir(path.join(root, dir), { recursive: true })
    }
    await Bun.write(
      path.join(templateRoot, ".spinosa", "workspace-files.tsv"),
      "path\trole\tupdate_policy\n.agents/\tframework\treplace_if_unmodified\n",
    )
    await Bun.write(path.join(templateRoot, ".agents", "references", "classification.md"), "template classification\n")
    await Bun.write(path.join(templateRoot, ".agents", "agents", "spinosa-overseer.md"), "template overseer\n")
    await Bun.write(path.join(templateRoot, ".agents", "skills", "spinosa-overseer", "SKILL.md"), "template skill\n")
    await Bun.write(path.join(templateRoot, ".agents", "custom.md"), "template custom\n")
    await Bun.write(path.join(workspace, ".agents", "references", "classification.md"), "stale classification\n")
    await Bun.write(path.join(workspace, ".agents", "agents", "spinosa-overseer.md"), "stale overseer\n")
    await Bun.write(path.join(workspace, ".agents", "skills", "spinosa-overseer", "SKILL.md"), "stale skill\n")
    await Bun.write(path.join(workspace, ".agents", "custom.md"), "user custom\n")
    // No framework-checksums.json — missing baseline previously skipped nested probes forever.

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(true)
    expect(await Bun.file(path.join(workspace, ".agents", "references", "classification.md")).text()).toBe("template classification\n")
    expect(await Bun.file(path.join(workspace, ".agents", "agents", "spinosa-overseer.md")).text()).toBe("template overseer\n")
    expect(await Bun.file(path.join(workspace, ".agents", "skills", "spinosa-overseer", "SKILL.md")).text()).toBe("template skill\n")
    // Non-probe managed files still preserve edits without a baseline.
    expect(await Bun.file(path.join(workspace, ".agents", "custom.md")).text()).toBe("user custom\n")
  })

  test("updates an unmodified managed file after a checksum baseline exists", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")

    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(templateRoot, "docs"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await Bun.write(
      path.join(templateRoot, ".spinosa", "workspace-files.tsv"),
      "path\trole\tupdate_policy\ndocs/\tframework\treplace_if_unmodified\n",
    )
    await Bun.write(path.join(templateRoot, "docs", "guide.md"), "v1\n")

    await updateWorkspace({ workspacePath: workspace, frameworkRoot })
    await Bun.write(path.join(templateRoot, "docs", "guide.md"), "v2\n")
    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(true)
    expect(await Bun.file(path.join(workspace, "docs", "guide.md")).text()).toBe("v2\n")
  })

  test("updates a first-run replace_if_unmodified file without a checksum baseline", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), "path\trole\tupdate_policy\nAGENTS.md\tframework\treplace_if_unmodified\n")
    await Bun.write(path.join(templateRoot, "AGENTS.md"), "new framework\n")
    await Bun.write(path.join(workspace, "AGENTS.md"), "old framework\n")

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(true)
    expect(await Bun.file(path.join(workspace, "AGENTS.md")).text()).toBe("new framework\n")
  })

  test("dry-run reports changes without mutating the workspace", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), "path\trole\tupdate_policy\nAGENTS.md\tframework\talways_replace\n")
    await Bun.write(path.join(templateRoot, "AGENTS.md"), "new\n")
    await Bun.write(path.join(workspace, "AGENTS.md"), "old\n")

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot, dryRun: true })

    expect(result).toMatchObject({ success: true, updated: 1, changes: true })
    expect(await Bun.file(path.join(workspace, "AGENTS.md")).text()).toBe("old\n")
  })

  test("archives files retired from the framework manifest", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), "path\trole\tupdate_policy\n")
    await Bun.write(path.join(workspace, ".spinosa", "manifest.tsv"), "path\tkind\nlegacy.md\tfile\n")
    await Bun.write(path.join(workspace, "legacy.md"), "user data\n")

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.removed).toBe(1)
    expect(existsSync(path.join(workspace, "legacy.md"))).toBe(false)
    expect(await Bun.file(path.join(workspace, ".trash", "framework-update-retired", "legacy.md")).text()).toBe("user data\n")
  })

  test("rejects a concurrent update lock", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa", "update.lock"), { recursive: true })
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), "path\trole\tupdate_policy\n")

    expect(await updateWorkspace({ workspacePath: workspace, frameworkRoot, lockTimeoutMs: 0 })).toEqual({
      success: false,
      added: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      changes: false,
      error: "Another update is already in progress for this workspace",
    })
  })

  test("rolls back earlier changes when a later managed directory fails", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(templateRoot, "collision"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), [
      "path\trole\tupdate_policy",
      "AGENTS.md\tframework\talways_replace",
      "collision/\tframework\talways_replace",
    ].join("\n") + "\n")
    await Bun.write(path.join(templateRoot, "AGENTS.md"), "new\n")
    await Bun.write(path.join(templateRoot, "collision", "nested.md"), "nested\n")
    await Bun.write(path.join(workspace, "AGENTS.md"), "old\n")
    await Bun.write(path.join(workspace, "collision"), "not a directory\n")

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(false)
    expect(await Bun.file(path.join(workspace, "AGENTS.md")).text()).toBe("old\n")
    expect(await Bun.file(path.join(workspace, "collision")).text()).toBe("not a directory\n")
  })

  test("force replaces nested user edits while protected policies remain untouched", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    for (const root of [templateRoot, workspace]) {
      await mkdir(path.join(root, ".spinosa"), { recursive: true })
      await mkdir(path.join(root, "managed"), { recursive: true })
    }
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), [
      "path\trole\tupdate_policy",
      "managed/\tframework\treplace_if_unmodified",
      "never.md\tuser_state\tnever_replace",
      "excluded.md\tuser_state\texclude_from_update",
    ].join("\n") + "\n")
    await Bun.write(path.join(templateRoot, "managed", "file.md"), "framework\n")
    await Bun.write(path.join(templateRoot, "never.md"), "framework\n")
    await Bun.write(path.join(templateRoot, "excluded.md"), "framework\n")
    await Bun.write(path.join(workspace, "managed", "file.md"), "user\n")
    await Bun.write(path.join(workspace, "never.md"), "user\n")
    await Bun.write(path.join(workspace, "excluded.md"), "user\n")

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot, force: true })

    expect(result.success).toBe(true)
    expect(await Bun.file(path.join(workspace, "managed", "file.md")).text()).toBe("framework\n")
    expect(await Bun.file(path.join(workspace, "never.md")).text()).toBe("user\n")
    expect(await Bun.file(path.join(workspace, "excluded.md")).text()).toBe("user\n")
  })

  test("aligns a newer workspace down to the installed framework", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(frameworkRoot, "metadata"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), "path\trole\tupdate_policy\nAGENTS.md\tframework\talways_replace\n")
    await Bun.write(path.join(frameworkRoot, "metadata", "version"), "1.0.0\n")
    await Bun.write(path.join(templateRoot, "AGENTS.md"), "old framework\n")
    await Bun.write(path.join(workspace, "AGENTS.md"), "current\n")
    await Bun.write(path.join(workspace, ".spinosa", "workspace"), "framework_version: 2.0.0\n")

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(await Bun.file(path.join(workspace, "AGENTS.md")).text()).toBe("old framework\n")
    expect(await Bun.file(path.join(workspace, ".spinosa", "workspace")).text()).toContain("framework_version: 1.0.0")
  })

  test("managed directory copies exclude macOS metadata and Python caches", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(templateRoot, "managed", "__pycache__"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), "path\trole\tupdate_policy\nmanaged/\tframework\treplace_if_unmodified\n")
    await Bun.write(path.join(templateRoot, "managed", "ok.md"), "ok\n")
    await Bun.write(path.join(templateRoot, "managed", ".DS_Store"), "metadata")
    await Bun.write(path.join(templateRoot, "managed", "__pycache__", "bad.pyc"), "cache")

    expect((await updateWorkspace({ workspacePath: workspace, frameworkRoot })).success).toBe(true)
    expect(existsSync(path.join(workspace, "managed", "ok.md"))).toBe(true)
    expect(existsSync(path.join(workspace, "managed", ".DS_Store"))).toBe(false)
    expect(existsSync(path.join(workspace, "managed", "__pycache__"))).toBe(false)
  })

  test("preserves legitimate corpus files that look like old contaminants", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, "raw", "notes"), { recursive: true })
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), "path\trole\tupdate_policy\nAGENTS.md\tframework\talways_replace\n")
    await Bun.write(path.join(templateRoot, "AGENTS.md"), "# Agents\n")
    await Bun.write(path.join(workspace, "AGENTS.md"), "old\n")
    await Bun.write(path.join(workspace, "raw", "corpus.jsonl"), '{"id":1}\n')
    await Bun.write(path.join(workspace, "raw", "notes", "session.bak"), "keep\n")
    await Bun.write(path.join(workspace, "raw", "scan-ocr-processed-meta.txt"), "keep\n")
    await Bun.write(path.join(workspace, "raw", "import.log"), "keep\n")
    await Bun.write(path.join(workspace, "research.jsonlines"), "keep\n")

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(true)
    expect(await Bun.file(path.join(workspace, "raw", "corpus.jsonl")).text()).toBe('{"id":1}\n')
    expect(await Bun.file(path.join(workspace, "raw", "notes", "session.bak")).text()).toBe("keep\n")
    expect(await Bun.file(path.join(workspace, "raw", "scan-ocr-processed-meta.txt")).text()).toBe("keep\n")
    expect(await Bun.file(path.join(workspace, "raw", "import.log")).text()).toBe("keep\n")
    expect(await Bun.file(path.join(workspace, "research.jsonlines")).text()).toBe("keep\n")
    expect(existsSync(path.join(workspace, ".trash", "framework-cleaned"))).toBe(false)
  })

  test("archives retired Pilosa agent files inside managed directories", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(templateRoot, ".agents"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".agents"), { recursive: true })
    await Bun.write(
      path.join(templateRoot, ".spinosa", "workspace-files.tsv"),
      "path\trole\tupdate_policy\n.agents/\tframework\treplace_if_unmodified\n",
    )
    await Bun.write(path.join(templateRoot, ".agents", "spinosa-searcher.md"), "new\n")
    await Bun.write(path.join(workspace, ".agents", "spinosa-searcher.md"), "new\n")
    await Bun.write(path.join(workspace, ".agents", "pilosa-searcher.md"), "legacy\n")
    await Bun.write(path.join(workspace, ".agents", "user-notes.md"), "mine\n")

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(true)
    expect(existsSync(path.join(workspace, ".agents", "pilosa-searcher.md"))).toBe(false)
    expect(await Bun.file(path.join(workspace, ".trash", "framework-update-retired", ".agents", "pilosa-searcher.md")).text()).toBe("legacy\n")
    expect(await Bun.file(path.join(workspace, ".agents", "user-notes.md")).text()).toBe("mine\n")
  })

  test("refreshes nested managed files after a create-time checksum baseline", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(templateRoot, ".agents"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".agents"), { recursive: true })
    await Bun.write(
      path.join(templateRoot, ".spinosa", "workspace-files.tsv"),
      "path\trole\tupdate_policy\n.agents/\tframework\treplace_if_unmodified\n",
    )
    await Bun.write(path.join(templateRoot, ".agents", "agent.md"), "v1\n")
    await Bun.write(path.join(workspace, ".agents", "agent.md"), "v1\n")

    // First update seeds checksums (simulates create-time baseline + later bump)
    expect((await updateWorkspace({ workspacePath: workspace, frameworkRoot })).success).toBe(true)
    await Bun.write(path.join(templateRoot, ".agents", "agent.md"), "v2\n")
    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(true)
    expect(await Bun.file(path.join(workspace, ".agents", "agent.md")).text()).toBe("v2\n")
  })

  test("skips contaminant cleanup after earlier update failures", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(templateRoot, "collision"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, "raw"), { recursive: true })
    await Bun.write(path.join(templateRoot, ".spinosa", "workspace-files.tsv"), [
      "path\trole\tupdate_policy",
      "AGENTS.md\tframework\talways_replace",
      "collision/\tframework\talways_replace",
    ].join("\n") + "\n")
    await Bun.write(path.join(templateRoot, "AGENTS.md"), "new\n")
    await Bun.write(path.join(templateRoot, "collision", "nested.md"), "nested\n")
    await Bun.write(path.join(workspace, "AGENTS.md"), "old\n")
    await Bun.write(path.join(workspace, "collision"), "not a directory\n")
    await Bun.write(path.join(workspace, "raw", "corpus.jsonl"), '{"ok":true}\n')

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(false)
    expect(await Bun.file(path.join(workspace, "raw", "corpus.jsonl")).text()).toBe('{"ok":true}\n')
    expect(await Bun.file(path.join(workspace, "AGENTS.md")).text()).toBe("old\n")
  })

  test("upgrades a simulated 1.0.0 workspace: Pilosa agents retired, corpus kept, checksums seeded", async () => {
    await using tmp = await tmpdir()
    const frameworkRoot = path.join(tmp.path, "install")
    const templateRoot = path.join(frameworkRoot, "workspace-template")
    const workspace = path.join(tmp.path, "legacy-1.0.0-workspace")

    await mkdir(path.join(templateRoot, ".spinosa"), { recursive: true })
    await mkdir(path.join(templateRoot, ".agents"), { recursive: true })
    await mkdir(path.join(templateRoot, ".codex", "agents"), { recursive: true })
    await mkdir(path.join(frameworkRoot, "metadata"), { recursive: true })
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })
    await mkdir(path.join(workspace, ".agents"), { recursive: true })
    await mkdir(path.join(workspace, ".codex", "agents"), { recursive: true })
    await mkdir(path.join(workspace, "raw"), { recursive: true })

    await Bun.write(path.join(frameworkRoot, "metadata", "version"), "1.0.3-beta.5\n")
    await Bun.write(
      path.join(templateRoot, ".spinosa", "workspace-files.tsv"),
      [
        "path\trole\tupdate_policy",
        "AGENTS.md\tframework\talways_replace",
        ".agents/\tframework\treplace_if_unmodified",
        ".codex/\tframework\treplace_if_unmodified",
      ].join("\n") + "\n",
    )
    await Bun.write(path.join(templateRoot, "AGENTS.md"), "# Spinosa\n")
    await Bun.write(path.join(templateRoot, ".agents", "spinosa-searcher.md"), "spinosa searcher\n")
    await Bun.write(path.join(templateRoot, ".codex", "agents", "spinosa-searcher.toml"), "name = \"spinosa-searcher\"\n")

    // Legacy 1.0.0 workspace: no checksum baseline, Pilosa names, user corpus
    await Bun.write(
      path.join(workspace, ".spinosa", "workspace"),
      [
        "workspace_version: 1",
        "framework_version: 1.0.0",
        "project_name: legacy",
        "setup_status: cli_started",
      ].join("\n") + "\n",
    )
    await Bun.write(path.join(workspace, "AGENTS.md"), "# Pilosa\n")
    await Bun.write(path.join(workspace, ".agents", "pilosa-searcher.md"), "old agent\n")
    await Bun.write(path.join(workspace, ".agents", "user-custom.md"), "keep me\n")
    await Bun.write(path.join(workspace, ".codex", "agents", "pilosa-searcher.toml"), "name = \"pilosa-searcher\"\n")
    await Bun.write(path.join(workspace, "raw", "interviews.jsonl"), '{"q":1}\n')
    expect(existsSync(path.join(workspace, ".spinosa", "framework-checksums.json"))).toBe(false)

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot })

    expect(result.success).toBe(true)
    expect(await Bun.file(path.join(workspace, "AGENTS.md")).text()).toBe("# Spinosa\n")
    expect(await Bun.file(path.join(workspace, ".agents", "spinosa-searcher.md")).text()).toBe("spinosa searcher\n")
    expect(existsSync(path.join(workspace, ".agents", "pilosa-searcher.md"))).toBe(false)
    expect(existsSync(path.join(workspace, ".codex", "agents", "pilosa-searcher.toml"))).toBe(false)
    expect(await Bun.file(path.join(workspace, ".agents", "user-custom.md")).text()).toBe("keep me\n")
    expect(await Bun.file(path.join(workspace, "raw", "interviews.jsonl")).text()).toBe('{"q":1}\n')
    expect(await Bun.file(path.join(workspace, ".spinosa", "workspace")).text()).toContain("framework_version: 1.0.3-beta.5")
    expect(existsSync(path.join(workspace, ".spinosa", "framework-checksums.json"))).toBe(true)
  })

  test("real workspace manifest supports a fresh-workspace dry run", async () => {
    await using tmp = await tmpdir()
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(path.join(workspace, ".spinosa"), { recursive: true })

    const result = await updateWorkspace({ workspacePath: workspace, frameworkRoot: repoRoot, dryRun: true })

    expect(result.success).toBe(true)
    expect(result.added).toBeGreaterThan(20)
    expect(result.changes).toBe(true)
  })
})
