import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { normalizeWorkflow, SYNCED_WORKFLOWS, workflowDrift } from "./workflow-sync.ts"

const FILE = ".github/workflows/release-beta.yml"

const workflow = Bun.YAML.parse(readFileSync(path.resolve(import.meta.dir, "../../.github/workflows/release-beta.yml"), "utf8")) as {
  env: Record<string, string>
  jobs: Record<string, { env?: Record<string, string>; steps: Array<{
    uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string>
    "continue-on-error"?: boolean
  }> }>
}

describe("workflowDrift", () => {
  test("identical copies are in sync", () => {
    expect(workflowDrift({ file: FILE, local: "name: Release\n", remote: "name: Release\n" })).toBeUndefined()
  })

  test("a changed job name is drift", () => {
    expect(workflowDrift({ file: FILE, local: "name: Beta release\n", remote: "name: Release\n" })).toContain(FILE)
  })

  test("a removed tag trigger is drift", () => {
    const remote = 'on:\n  push:\n    tags:\n      - "v1.2.0-beta.*"\n      - "v1.2.*"\n'
    const local = 'on:\n  push:\n    tags:\n      - "v1.2.0-beta.*"\n'
    expect(workflowDrift({ file: FILE, local, remote })).toBeDefined()
  })

  test("line endings and trailing whitespace are not drift", () => {
    expect(
      workflowDrift({ file: FILE, local: "name: Release  \r\njobs:\r\n", remote: "name: Release\njobs:\n\n" }),
    ).toBeUndefined()
  })

  test("normalize collapses trailing newlines to exactly one", () => {
    expect(normalizeWorkflow("a\n\n\n")).toBe("a\n")
  })

  test("the release workflow is on the synced list", () => {
    expect(SYNCED_WORKFLOWS).toContain(FILE)
  })
})

describe("release workflow credentials", () => {
  test("pins actions and keeps credentials out of install/build steps", () => {
    expect(workflow.env.GH_TOKEN).toBeUndefined()
    for (const job of Object.values(workflow.jobs)) {
      expect(job.env?.GH_TOKEN).toBeUndefined()
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}$/)
        if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false)
        if (step.env?.GH_TOKEN) expect(step.run).toMatch(/release\/(promote\.ts)|release ci-publish/)
      }
    }
    const publish = workflow.jobs.publish!.steps.filter((step) => step.env?.GH_TOKEN)
    expect(publish).toHaveLength(2)
  })

  test("dependency findings remain informational", () => {
    const scan = workflow.jobs.validate!.steps.find((step) => step.run === "bun run audit:deps")
    expect(scan?.["continue-on-error"]).toBe(true)
  })
})
