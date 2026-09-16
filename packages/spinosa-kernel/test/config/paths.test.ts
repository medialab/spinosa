import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { migrateProjectPaths } from "@/config/paths"

describe("project config migration", () => {
  test("migrates nested workspace config and reports collisions without overwriting", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spinosa-project-migration-"))
    const project = path.join(root, "project")
    const nested = path.join(project, "worktree", "nested")
    try {
      await fs.mkdir(path.join(project, ".opencode", "agents"), { recursive: true })
      await fs.writeFile(path.join(project, ".opencode", "agents", "agent.md"), "preserved")
      await fs.writeFile(path.join(project, "opencode.json"), '{ "theme": "legacy" }')
      await fs.mkdir(nested, { recursive: true })

      const first = await migrateProjectPaths(nested, project)

      expect(first.some((result) => result.result === "migrated")).toBe(true)
      expect(await fs.readFile(path.join(project, ".spinosa", "agents", "agent.md"), "utf8")).toBe("preserved")
      expect(await fs.readFile(path.join(project, "spinosa.json"), "utf8")).toContain("legacy")

      await fs.mkdir(path.join(project, ".opencode"), { recursive: true })
      await fs.writeFile(path.join(project, ".opencode", "new.md"), "legacy")
      const second = await migrateProjectPaths(nested, project)

      expect(second.some((result) => result.result === "conflict")).toBe(true)
      expect(await fs.readFile(path.join(project, ".spinosa", "agents", "agent.md"), "utf8")).toBe("preserved")
      const report = path.join(nested, ".spinosa-migration-report.json")
      const content = await fs.readFile(report, "utf8")
      const parsed = JSON.parse(content)
      expect(parsed).toMatchObject({ version: 1 })
      expect(content).not.toContain(root)
      expect(parsed.conflicts).toContainEqual({
        source: path.relative(nested, path.join(project, ".opencode")),
        target: path.relative(nested, path.join(project, ".spinosa")),
        result: "conflict",
      })
      if (process.platform !== "win32") {
        expect((await fs.stat(report)).mode & 0o777).toBe(0o600)
      }

      await Bun.sleep(5)
      await migrateProjectPaths(nested, project)
      expect(await fs.readFile(report, "utf8")).toBe(content)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("does not throw when the launch directory is not writable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spinosa-project-migration-ro-"))
    const project = path.join(root, "project")
    const nested = path.join(project, "worktree", "nested")
    try {
      await fs.mkdir(path.join(project, ".opencode"), { recursive: true })
      await fs.mkdir(path.join(project, ".spinosa"), { recursive: true })
      await fs.mkdir(nested, { recursive: true })
      await fs.chmod(nested, 0o555)

      const results = await migrateProjectPaths(nested, project)
      expect(results.some((result) => result.result === "conflict")).toBe(true)
      await expect(fs.stat(path.join(nested, ".spinosa-migration-report.json"))).rejects.toMatchObject({
        code: "ENOENT",
      })
    } finally {
      await fs.chmod(nested, 0o755).catch(() => undefined)
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
