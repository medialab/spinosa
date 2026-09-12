import { describe, expect, test } from "bun:test"
import {
  routeBadgeFromParts,
  routeProgress,
  setRouteProgress,
  shortStepLabel,
  SPINOSA_ROUTE_METADATA,
  trackedRunCount,
} from "../../src/spinosa/route-badge"

describe("routeBadgeFromParts", () => {
  test("extracts fast-path identity", () => {
    const info = routeBadgeFromParts([
      { type: "text", text: "Hi", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "direct", action: "answer", reason: "greeting" } } },
    ])
    expect(info).toMatchObject({ kind: "direct", action: "answer" })
  })

  test("extracts routing provenance", () => {
    const info = routeBadgeFromParts([
      {
        type: "text", text: "x",
        metadata: {
          [SPINOSA_ROUTE_METADATA]: {
            kind: "workflow", workflowID: "research.targeted_evidence",
            operation: "research", strategy: "targeted_evidence",
            runID: "r1", routedBy: "model", confidence: 0.9,
          },
        },
      },
    ])
    expect(info).toMatchObject({ routedBy: "model", confidence: 0.9 })
    const rules = routeBadgeFromParts([
      { type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "direct", action: "answer", routedBy: "rules" } } },
    ])
    expect(rules).toMatchObject({ routedBy: "rules" })
  })

  test("extracts workflow identity", () => {
    const info = routeBadgeFromParts([
      { type: "text", text: "x", ignored: true },
      {
        type: "text",
        text: "find evidence",
        ignored: true,
        metadata: {
          [SPINOSA_ROUTE_METADATA]: {
            kind: "workflow",
            workflowID: "research.targeted_evidence",
            operation: "research",
            strategy: "targeted_evidence",
            runID: "r1",
          },
        },
      },
    ])
    expect(info).toMatchObject({ kind: "workflow", workflowID: "research.targeted_evidence", runID: "r1" })
  })

  test("ignores parts without route metadata or with malformed shapes", () => {
    expect(routeBadgeFromParts(undefined)).toBeUndefined()
    expect(routeBadgeFromParts([{ type: "text", text: "x" }])).toBeUndefined()
    expect(routeBadgeFromParts([{ type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "workflow" } } }])).toBeUndefined()
    expect(routeBadgeFromParts([{ type: "text", text: "x", metadata: "nope" }])).toBeUndefined()
  })
})

describe("shortStepLabel", () => {
  test("names agents and parallel fanouts plainly", () => {
    expect(shortStepLabel("search")).toBe("search")
    expect(shortStepLabel("extract-fanout")).toBe("extract × parallel")
    expect(shortStepLabel("search-fanout:batch-001")).toBe("search × parallel")
  })
})

describe("route progress store", () => {
  test("records and reads per-run step progress", () => {
    expect(routeProgress("run-x")).toBeUndefined()
    setRouteProgress("run-x", { done: 2, total: 6, stepID: "search", status: "processing" })
    expect(routeProgress("run-x")).toMatchObject({ done: 2, total: 6, stepID: "search" })
    setRouteProgress("run-x", { done: 6, total: 6, stepID: "evaluate", status: "done" })
    expect(routeProgress("run-x")?.status).toBe("done")
  })

  test("evicts oldest entries past the cap", () => {
    for (let i = 0; i < 120; i++) {
      setRouteProgress(`evict-${i}`, { done: 1, total: 1, stepID: "goal", status: "done" })
    }
    expect(trackedRunCount()).toBeLessThanOrEqual(100)
    expect(routeProgress("evict-119")).toBeDefined()
  })
})
