import { describe, expect, test } from "bun:test"
import { normalizeWorkflow, SYNCED_WORKFLOWS, workflowDrift } from "./workflow-sync.ts"

const FILE = ".github/workflows/release-beta.yml"

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
