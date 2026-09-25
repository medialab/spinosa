// WP9: classification documentation is generated from code — the template
// file must embed the exact registry table so TS and Markdown cannot drift.
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { renderWorkflowTable, BUILTIN_WORKFLOWS } from "../src"

const WORKFLOW_CLASSIFICATION_PATHS = [
  ".agents/references/classification.md",
  "workspace-template/.agents/references/classification.md",
] as const

const classificationPaths = WORKFLOW_CLASSIFICATION_PATHS.map((relativePath) => path.resolve(import.meta.dir, "..", "..", "..", relativePath))

const ROLE_IDS = [
  "spinosa-analyst",
  "spinosa-evaluator",
  "spinosa-evolver",
  "spinosa-janitor",
  "spinosa-mapper",
  "spinosa-overseer",
  "spinosa-searcher",
  "spinosa-serendippo",
  "spinosa-verifier",
  "spinosa-writer",
] as const

const PORTABLE_CONTENT_ROOTS = [".agents", "workspace-template/.agents"] as const
const AGENT_DEFINITION_ROOTS = [
  ".agents/agents",
  "workspace-template/.agents/agents",
  "workspace-template/.spinosa/agents",
] as const

const OWNERSHIP_GUIDANCE_PATHS = [
  "workspace-template/AGENTS.md",
  "workspace-template/docs/reference/agents.md",
  ...PORTABLE_CONTENT_ROOTS.map((root) => `${root}/references/tool-conventions.md`),
].map((relativePath) => path.resolve(import.meta.dir, "..", "..", "..", relativePath))

const instructionPaths = [
  ...PORTABLE_CONTENT_ROOTS.flatMap((root) => ROLE_IDS.map((role) => `${root}/skills/${role}/SKILL.md`)),
  ...AGENT_DEFINITION_ROOTS.flatMap((root) => ROLE_IDS.map((role) => `${root}/${role}.md`)),
].map((relativePath) => path.resolve(import.meta.dir, "..", "..", "..", relativePath))

const startupPromptPath = path.resolve(import.meta.dir, "..", "..", "..", "workspace-template/startup-prompt.md")
const chartReferencePaths = PORTABLE_CONTENT_ROOTS.map((root) =>
  path.resolve(import.meta.dir, "..", "..", "..", `${root}/references/chart-rendering.md`),
)
const SHARED_REFERENCE_NAMES = [
  "analysis-template.md",
  "artifact-naming.md",
  "audit-template.md",
  "chart-rendering.md",
  "goal-artifact-template.md",
  "provenance-footer-template.md",
  "report-template.md",
  "tool-conventions.md",
  "verbatim-format.md",
] as const

describe("generated classification docs", () => {
  test("every mirror embeds the exact registry table", async () => {
    const expected = renderWorkflowTable()
    for (const classificationPath of classificationPaths) {
      const file = Bun.file(classificationPath)
      expect(await file.exists()).toBe(true)
      const text = await file.text()
      expect(text).toBe(expected)
    }
  })

  test("the generated table covers every registered workflow", async () => {
    const text = await Bun.file(classificationPaths[0]!).text()
    for (const def of BUILTIN_WORKFLOWS) {
      if (def.id === "corpus.maintenance") continue // reserved grammar, undocumented
      expect(text).toContain(`\`${def.id}\``)
      expect(text).toContain(`v${def.version}`)
    }
  })
})

describe("instruction contracts", () => {
  test("shared reference mirrors match the shipped source", async () => {
    for (const name of SHARED_REFERENCE_NAMES) {
      const sourcePath = path.resolve(import.meta.dir, "..", "..", "..", `workspace-template/.agents/references/${name}`)
      const source = await Bun.file(sourcePath).text()
      for (const root of PORTABLE_CONTENT_ROOTS) {
        const mirrorPath = path.resolve(import.meta.dir, "..", "..", "..", `${root}/references/${name}`)
        expect(await Bun.file(mirrorPath).text()).toBe(source)
      }
    }
  })

  test("workflow ownership guidance is consistent in shipped host mirrors", async () => {
    for (const guidancePath of OWNERSHIP_GUIDANCE_PATHS) {
      const file = Bun.file(guidancePath)
      expect(await file.exists()).toBe(true)
      const text = await file.text()
      expect(text).toContain("For routed Spinosa work, the WorkflowEngine and `run.json` are authoritative.")
      expect(text).toContain("A host may provide its own worker-dispatch mechanism")
      expect(text).toContain("coordinator/runtime")
      expect(text.toLowerCase()).not.toContain("workflow engine is paused")
      expect(text).not.toContain("pass_with_minor_discrepancy")
    }
  })

  test("all shipped role mirrors use the bounded worker contract", async () => {
    for (const instructionPath of instructionPaths) {
      const file = Bun.file(instructionPath)
      expect(await file.exists()).toBe(true)
      const text = await file.text()
      expect(text).toContain("Inputs: supplied node scope, coverage contract, input artifact paths, and exact")
      expect(text).toContain("The coordinator/runtime owns routing")
      expect(text).not.toContain("## Tool contract (general-harness operation)")
      expect(text).not.toContain("Route multi-step work with")
      expect(text).not.toContain("Do not choose the next workflow phase")
      expect(text.toLowerCase()).not.toContain("workflow engine is paused")
      expect(text).not.toContain("pass_with_minor_discrepancy")
      expect(text).not.toContain("--max-count=30")
      expect(text).not.toContain("~50 lines")
      expect(text).not.toContain("grep_context")
      expect(text).not.toMatch(/append search provenance|number the report sequentially|every five routes|routes_since_overseer/i)
      expect(text).not.toContain("Return operational counts to orchestrator")
    }
  })

  test("search and verification contracts match runtime capabilities in every mirror", async () => {
    const searcherPaths = [
      ...PORTABLE_CONTENT_ROOTS.map((root) => `${root}/skills/spinosa-searcher/SKILL.md`),
      ...AGENT_DEFINITION_ROOTS.map((root) => `${root}/spinosa-searcher.md`),
    ]
    const verifierPaths = [
      ...PORTABLE_CONTENT_ROOTS.map((root) => `${root}/skills/spinosa-verifier/SKILL.md`),
      ...AGENT_DEFINITION_ROOTS.map((root) => `${root}/spinosa-verifier.md`),
    ]
    for (const relativePath of searcherPaths) {
      const text = await Bun.file(path.resolve(import.meta.dir, "..", "..", "..", relativePath)).text()
      expect(text).toContain("opportunistic")
      expect(text).toContain("representative")
      expect(text).toContain("exhaustive")
      expect(text).toContain("searched scope")
      expect(text).toContain("unsearched scope")
      expect(text).toContain("truncation")
      expect(text).toContain("For structured grep, provide")
      expect(text).not.toContain("--max-count=30")
      expect(text).not.toContain("~50 lines")
      expect(text).not.toContain("search_rounds:")
    }
    for (const relativePath of verifierPaths) {
      const text = await Bun.file(path.resolve(import.meta.dir, "..", "..", "..", relativePath)).text()
      expect(text).toContain("pass_with_corrections")
      expect(text).not.toContain("pass_with_minor_discrepancy")
    }
  })

  test("workspace template does not ship an OpenCode adapter tree", () => {
    expect(existsSync(path.resolve(import.meta.dir, "..", "..", "..", "workspace-template/.opencode"))).toBe(false)
  })

  test("role-specific evidence, absence, metric, and quote contracts stay explicit", async () => {
    const read = async (relative: string) =>
      Bun.file(path.resolve(import.meta.dir, "..", "..", "..", relative)).text()
    const analyst = await read(".agents/agents/spinosa-analyst.md")
    for (const heading of ["### Supported findings", "### Context-derived hypotheses", "### Questions requiring retrieval"]) {
      expect(analyst).toContain(heading)
    }
    const overseer = await read(".agents/agents/spinosa-overseer.md")
    expect(overseer).toContain("Not observed in the inspected records")
    expect(overseer).toContain("files not observed")
    expect(overseer).toContain("concepts not observed")
    expect(overseer).toContain("freshness/staleness evidence")
    const serendippo = await read(".agents/agents/spinosa-serendippo.md")
    expect(serendippo).toContain("evidence from both sides")
    expect(serendippo).toContain("plausible alternative explanation")
    expect(serendippo).toContain("No supported cross-source connection found.")
    expect(serendippo).not.toContain("max - min")
    const janitor = await read(".agents/agents/spinosa-janitor.md")
    for (const count of ["total_files", "stale_files", "corrupt_copies", "broken_links", "stale_entries", "orphaned_files"]) {
      expect(janitor).toContain(count)
    }
    const verifier = await read(".agents/agents/spinosa-verifier.md")
    expect(verifier).toContain("shortest passage that supports a claim")
    for (const status of ["pass", "pass_with_corrections", "partial", "fail", "blocked"]) {
      expect(verifier).toContain(`\`${status}\``)
    }
  })

  test("startup documentation matches the executable phase order", async () => {
    const text = await Bun.file(startupPromptPath).text()
    const startupDocs = await Bun.file(path.resolve(import.meta.dir, "..", "..", "..", "workspace-template/docs/reference/corpus.md")).text()
    const architecture = await Bun.file(path.resolve(import.meta.dir, "..", "..", "..", "workspace-template/system/system_architecture_map.md")).text()
    const phases = [
      "Validate",
      "Survey",
      "Partition",
      "Extract fan-out",
      "Merge",
      "Dictionary",
      "Enrich",
      "Map write",
      "Connection analysis",
      "Verification",
      "Evaluation",
      "Commit",
    ]
    let previous = -1
    for (const phase of phases) {
      const current = text.indexOf(`**${phase}`)
      expect(current).toBeGreaterThan(previous)
      previous = current
    }
    expect(text).toContain("spinosa-overseer")
    expect(text).toContain("agent-interception")
    expect(text).toContain("An existing filename alone is never evidence")
    expect(text).toMatch(/complete assigned\s+`files` list/)
    const sequence = "validate → survey → partition → extraction fan-out → merge → dictionary → header enrichment → map write → connection analysis → verification → evaluation → commit workspace_started"
    expect(startupDocs.replace(/\s+/g, " ")).toContain(sequence)
    expect(architecture.replace(/\s+/g, " ")).toContain(sequence)
    expect(startupDocs).toContain("an existing filename alone")
  })

  test("chart documentation exposes only supported figure kinds", async () => {
    for (const chartReferencePath of chartReferencePaths) {
      const text = await Bun.file(chartReferencePath).text()
      for (const kind of ["bar", "sparkline", "stacked_bar", "status_matrix"]) {
        expect(text).toContain(`| \`${kind}\``)
      }
      expect(text).toContain("are not available through `spinosa_figure`")
      expect(text).not.toMatch(/\|\s*`(?:scatter|density|histogram|ridge|heatmap)`\s*\|/i)
    }
  })
})
