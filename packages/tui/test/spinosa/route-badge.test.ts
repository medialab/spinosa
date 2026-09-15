import { describe, expect, test } from "bun:test"
import {
  routeBadgeFromParts,
  routeBadgeLabel,
  routeProgress,
  setRouteProgress,
  shortStepLabel,
  SPINOSA_ROUTE_METADATA,
  trackedRunCount,
} from "../../src/spinosa/route-badge"

describe("routeBadgeFromParts", () => {
  test("extracts general-answer identity", () => {
    const info = routeBadgeFromParts([
      { type: "text", text: "Hi", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "general" } } },
    ])
    expect(info).toMatchObject({ kind: "general" })
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
      { type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "general", routedBy: "rules" } } },
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

  test("ignores parts with malformed route metadata shapes", () => {
    expect(routeBadgeFromParts(undefined)).toBeUndefined()
    expect(routeBadgeFromParts([{ type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "workflow" } } }])).toBeUndefined()
  })

  test("unstamped user text falls back to general (never an empty tag)", () => {
    // Bare sends, failed preparations, and legacy rows admitted with no
    // routing verdict manifest General prompt — the agent decides.
    expect(routeBadgeFromParts([{ type: "text", text: "x" }])).toMatchObject({ kind: "general" })
    expect(routeBadgeFromParts([{ type: "text", text: "x", metadata: "nope" }])).toMatchObject({ kind: "general" })
    expect(routeBadgeFromParts([{ type: "text", text: "x", ignored: true, metadata: {} }])).toMatchObject({
      kind: "general",
    })
    // Scaffolding without a genuine user text payload stays badge-less.
    expect(routeBadgeFromParts([])).toBeUndefined()
    expect(routeBadgeFromParts([{ type: "file", filename: "a.png" }])).toBeUndefined()
    expect(routeBadgeFromParts([{ type: "text", text: "ctx", synthetic: true }])).toBeUndefined()
  })

  test("transient outbound states never parse from server parts", () => {
    // Outbound lifecycle states are TUI-local and rendered from the
    // outbound queue — they must never arrive via persisted part metadata.
    expect(
      routeBadgeFromParts([{ type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "evaluating" } } }]),
    ).toBeUndefined()
    expect(
      routeBadgeFromParts([{ type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "queued" } } }]),
    ).toBeUndefined()
    expect(
      routeBadgeFromParts([{ type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "interrupted" } } }]),
    ).toBeUndefined()
  })
})

describe("shortStepLabel", () => {
  test("names agents and parallel fanouts plainly", () => {
    expect(shortStepLabel("search")).toBe("search")
    expect(shortStepLabel("extract-fanout")).toBe("extract × parallel")
    expect(shortStepLabel("search-fanout:batch-001")).toBe("search × parallel")
  })
})

describe("routeBadgeLabel", () => {
  test("makes every outbound fence explicit", () => {
    expect(routeBadgeLabel({ kind: "queued" })).toBe("○ queued")
    expect(routeBadgeLabel({ kind: "steered" })).toBe("→ steered")
    expect(routeBadgeLabel({ kind: "evaluating" })).toBe("Evaluating")
    expect(routeBadgeLabel({ kind: "interrupted" })).toBe("⛔ Interrupted")
  })

  test("routed general verdicts manifest a General prompt badge (never empty)", () => {
    expect(routeBadgeLabel({ kind: "general" })).toBe("General prompt")
    const info = routeBadgeFromParts([
      { type: "text", text: "hi", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "general", routedBy: "rules" } } },
    ])
    expect(info).toMatchObject({ kind: "general", routedBy: "rules" })
    expect(routeBadgeLabel(info!)).toBe("General prompt")
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
