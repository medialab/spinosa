import { describe, expect, test } from "bun:test"
import {
  checkCiTagGate,
  ciPublishStages,
  parseOptions,
  planCiAssemble,
} from "./index.ts"

describe("ci-assemble routing (publish must stay unreachable)", () => {
  test("dry-run plans local gates only, never publish stages", () => {
    const plan = planCiAssemble({ dryRun: true, finalizeOnly: false })
    expect(plan.mode).toBe("dry-run")
    if (plan.mode !== "dry-run") throw new Error("unreachable")
    expect(plan.from).toBe("verifyLocal")
    expect([...plan.only]).toEqual(["verifyLocal", "smoke"])
    expect(plan.only).not.toContain("publishVersion")
    expect(plan.only).not.toContain("channel")
    expect(plan.only).not.toContain("verifyRemote")
  })

  test("dry-run wins over finalize-only", () => {
    const plan = planCiAssemble({ dryRun: true, finalizeOnly: true })
    expect(plan.mode).toBe("dry-run")
  })

  test("finalize-only plans local gates only, never publish stages", () => {
    const plan = planCiAssemble({ dryRun: false, finalizeOnly: true })
    expect(plan.mode).toBe("finalize-only")
    if (plan.mode !== "finalize-only") throw new Error("unreachable")
    expect(plan.from).toBe("verifyLocal")
    expect([...plan.only]).toEqual(["verifyLocal", "smoke"])
    expect(plan.only).not.toContain("publishVersion")
    expect(plan.only).not.toContain("channel")
    expect(plan.only).not.toContain("verifyRemote")
  })

  test("full mode carries no stage filter (legacy local path)", () => {
    const plan = planCiAssemble({ dryRun: false, finalizeOnly: false })
    expect(plan.mode).toBe("full")
    if (plan.mode !== "full") throw new Error("unreachable")
    expect(plan.from).toBe("verifyLocal")
    expect(plan.only).toBeUndefined()
  })

  test("undefined finalizeOnly behaves like false", () => {
    expect(planCiAssemble({ dryRun: false }).mode).toBe("full")
    expect(planCiAssemble({ dryRun: true }).mode).toBe("dry-run")
  })
})

describe("ci-publish stages (exactly the publish set)", () => {
  test("runs publishVersion, channel, verifyRemote — and nothing else", () => {
    const plan = ciPublishStages()
    expect(plan.from).toBe("publishVersion")
    expect([...plan.only]).toEqual(["publishVersion", "channel", "verifyRemote"])
  })
})

describe("ci tag/version gate", () => {
  const base = {
    version: "1.1.0-beta.21",
    head: "abc123def456",
    tagSha: "abc123def456",
    packageVersion: "1.1.0-beta.21",
  }

  test("matching tag and version passes", () => {
    expect(checkCiTagGate(base)).toBeUndefined()
  })

  test("missing tag fails closed", () => {
    expect(checkCiTagGate({ ...base, tagSha: undefined })).toMatch(/not found/)
  })

  test("tag pointing elsewhere fails closed", () => {
    expect(checkCiTagGate({ ...base, tagSha: "deadbeef0000" })).toMatch(/points at deadbee/)
  })

  test("package.json mismatch fails closed", () => {
    expect(checkCiTagGate({ ...base, packageVersion: "1.1.0-beta.20" })).toMatch(/package\.json says/)
  })
})

describe("parseOptions release flags", () => {
  test("parses --finalize-only", () => {
    const { positionals, options } = parseOptions(["ci-assemble", "v1.1.0-beta.21", "--finalize-only"])
    expect(positionals).toEqual(["ci-assemble", "v1.1.0-beta.21"])
    expect(options.finalizeOnly).toBe(true)
    expect(options.dryRun).toBe(false)
  })

  test("parses --dry-run", () => {
    const { options } = parseOptions(["ci-assemble", "v1.1.0-beta.21", "--dry-run"])
    expect(options.dryRun).toBe(true)
    expect(options.finalizeOnly).toBeUndefined()
  })
})
