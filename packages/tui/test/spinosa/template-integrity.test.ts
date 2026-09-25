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

  test("all supported agents exist in canonical and Spinosa runtime layouts", () => {
    const missing: string[] = []
    for (const agent of SPINOSA_AGENT_FILES) {
      const skill = agent.replace(/\.md$/, "")
      for (const relative of [
        path.join(".agents", "skills", skill, "SKILL.md"),
        path.join(".spinosa", "agents", agent),
      ]) {
        if (!existsSync(path.join(templateRoot, relative))) missing.push(relative)
      }
    }
    expect(missing).toEqual([])
  })

  test("Spinosa runtime agent bodies match canonical guidance", () => {
    const drift: string[] = []
    const body = (content: string) => content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim()
    for (const agent of SPINOSA_AGENT_FILES) {
      const canonicalAgent = readFileSync(path.join(templateRoot, ".agents", "agents", agent), "utf-8")
      const relative = path.join(".spinosa", "agents", agent)
      const runtimeAgent = readFileSync(path.join(templateRoot, relative), "utf-8")
      if (body(runtimeAgent) !== body(canonicalAgent)) drift.push(relative)
      if (!/^mode:\s*subagent$/m.test(runtimeAgent)) drift.push(`${relative} (not a subagent)`)
    }
    expect(drift).toEqual([])
  })

  test("contains no Python caches or removed vendor trees", async () => {
    const caches: string[] = []
    for await (const file of new Bun.Glob("**/*.pyc").scan({ cwd: templateRoot, onlyFiles: true, dot: true })) caches.push(file)
    for await (const file of new Bun.Glob("**/*.pyc").scan({ cwd: path.join(repoRoot, ".agents"), onlyFiles: true, dot: true })) caches.push(path.join(".agents", file))
    expect(caches).toEqual([])
    for (const vendor of [".claude", ".codex", ".hermes"]) {
      expect(existsSync(path.join(templateRoot, vendor))).toBe(false)
    }
    expect(existsSync(path.join(templateRoot, ".opencode"))).toBe(false)
    expect(existsSync(path.join(templateRoot, "CLAUDE.md"))).toBe(false)
  })

  test("package manifests are strict JSON", async () => {
    const text = await Bun.file(path.join(repoRoot, "packages", "tui", "package.json")).text()
    expect(() => JSON.parse(text)).not.toThrow()
  })
})
