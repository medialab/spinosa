import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { SPINOSA_AGENT_FILES } from "@spinosa/core/constants"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const templateRoot = path.join(repoRoot, "workspace-template")

describe("workspace template integrity", () => {
  test("every manifest path exists in the template", async () => {
    const manifest = await Bun.file(path.join(templateRoot, ".spinosa", "workspace-files.tsv")).text()
    const missing = manifest
      .split(/\r?\n/)
      .slice(1)
      .filter(Boolean)
      .map((line) => line.split("\t")[0]!)
      .filter((relative) => !existsSync(path.join(templateRoot, relative)))
    expect(missing).toEqual([])
  })

  test("all supported agents exist in each adapter", () => {
    const missing: string[] = []
    for (const agent of SPINOSA_AGENT_FILES) {
      const skill = agent.replace(/\.md$/, "")
      for (const relative of [
        path.join(".agents", "skills", skill, "SKILL.md"),
        path.join(".opencode", "skills", skill, "SKILL.md"),
        path.join(".opencode", "agents", agent),
        path.join(".claude", "agents", agent),
        path.join(".claude", "skills", skill, "SKILL.md"),
        path.join(".codex", "agents", `${skill}.toml`),
        path.join(".codex", "skills", skill, "SKILL.md"),
        path.join(".hermes", "skills", skill, "SKILL.md"),
      ]) {
        if (!existsSync(path.join(templateRoot, relative))) missing.push(relative)
      }
    }
    expect(missing).toEqual([])
  })

  test("markdown agent and skill mirrors match their canonical content", () => {
    const drift: string[] = []
    const body = (content: string) => content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim()
    for (const agent of SPINOSA_AGENT_FILES) {
      const skill = agent.replace(/\.md$/, "")
      const canonicalAgent = readFileSync(path.join(templateRoot, ".agents", "agents", agent), "utf-8")
      for (const relative of [path.join(".opencode", "agents", agent), path.join(".claude", "agents", agent)]) {
        if (body(readFileSync(path.join(templateRoot, relative), "utf-8")) !== body(canonicalAgent)) drift.push(relative)
      }
    const canonicalSkill = body(
      readFileSync(path.join(templateRoot, ".agents", "skills", skill, "SKILL.md"), "utf-8"),
    )
    for (const vendor of [".opencode", ".claude", ".codex", ".hermes"]) {
      const relative = path.join(vendor, "skills", skill, "SKILL.md")
      if (body(readFileSync(path.join(templateRoot, relative), "utf-8")) !== canonicalSkill) drift.push(relative)
    }
    }
    expect(drift).toEqual([])
  })

  test("contains no Python caches or maintainer-specific Hermes path", async () => {
    const caches: string[] = []
    for await (const file of new Bun.Glob("**/*.pyc").scan({ cwd: templateRoot, onlyFiles: true, dot: true })) caches.push(file)
    for await (const file of new Bun.Glob("**/*.pyc").scan({ cwd: path.join(repoRoot, ".agents"), onlyFiles: true, dot: true })) caches.push(path.join(".agents", file))
    expect(caches).toEqual([])
    const hermes = await Bun.file(path.join(templateRoot, ".hermes", "workspace.config.yaml")).text()
    expect(hermes).not.toContain("/Users/")
    expect(hermes).toContain("{{SPINOSA_WORKSPACE}}")
  })

  test("package manifests are strict JSON", async () => {
    const text = await Bun.file(path.join(repoRoot, "packages", "tui", "package.json")).text()
    expect(() => JSON.parse(text)).not.toThrow()
  })
})
