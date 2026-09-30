import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const workflow = Bun.YAML.parse(readFileSync(path.resolve(import.meta.dir, "../../.github/workflows/release-beta.yml"), "utf8")) as {
  env: Record<string, string>
  jobs: Record<string, { env?: Record<string, string>; steps: Array<{
    uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string>
    "continue-on-error"?: boolean
  }> }>
}

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
