import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Subagents run on the orchestrator's model. The shipped control files state the
// rule ("Do not hard-code a model id"), and the kernel honours a declared model
// when one exists (`next.model` in packages/spinosa-kernel/src/tool/task.ts), so
// a single stray `model:` in a shipped definition would silently reintroduce
// per-agent routing. These tests keep the shipped definitions free of one.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const templateRoot = path.join(repoRoot, "workspace-template")

function templateFiles() {
  return readdirSync(templateRoot, { recursive: true, encoding: "utf8" }).map((entry) => String(entry))
}

/** Canonical definitions plus every vendor mirror (.claude, .codex, .opencode, .hermes). */
function agentDefinitions() {
  return templateFiles().filter(
    (file) => /(^|\/)\.[a-z]+\/agents\/[^/]+\.md$/.test(file) || /(^|\/)skills\/[^/]+\/SKILL\.md$/.test(file),
  )
}

function codexProfiles() {
  return templateFiles().filter((file) => /(^|\/)\.codex\/agents\/[^/]+\.toml$/.test(file))
}

/** The leading YAML frontmatter block, or "" when the file has none. */
function frontmatter(body: string) {
  if (!body.startsWith("---\n")) return ""
  const end = body.indexOf("\n---", 3)
  return end === -1 ? "" : body.slice(4, end)
}

function declaresModel(body: string) {
  return frontmatter(body)
    .split("\n")
    .some((line) => /^\s*model\s*:/.test(line))
}

describe("agent model policy", () => {
  test("no shipped agent or skill definition declares a model", () => {
    const files = agentDefinitions()
    // A path or layout change must fail loudly rather than scan nothing.
    expect(files.length).toBeGreaterThan(20)

    const offenders = files.filter((file) => declaresModel(readFileSync(path.join(templateRoot, file), "utf8")))
    expect(offenders).toEqual([])
  })

  test("codex profiles leave the model setting commented out", () => {
    const files = codexProfiles()
    expect(files.length).toBeGreaterThan(5)

    const offenders = files.filter((file) =>
      readFileSync(path.join(templateRoot, file), "utf8")
        .split("\n")
        .some((line) => /^\s*model\s*=/.test(line)),
    )
    expect(offenders).toEqual([])
  })

  test("the scan actually reaches the canonical definitions and every mirror", () => {
    const files = agentDefinitions()
    expect(files).toContain(".agents/agents/spinosa-searcher.md")
    expect(files).toContain(".agents/skills/spinosa-searcher/SKILL.md")
    for (const vendor of [".claude", ".codex", ".opencode", ".hermes"]) {
      expect(files.some((file) => file.startsWith(`${vendor}/`))).toBe(true)
    }
  })
})
