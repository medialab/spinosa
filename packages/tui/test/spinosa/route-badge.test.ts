import { describe, expect, test } from "bun:test"
import {
  routeBadgeFromParts,
  routeBadgeLabel,
  SPINOSA_ROUTE_METADATA,
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
      routeBadgeFromParts([{ type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "queued" } } }]),
    ).toBeUndefined()
    expect(
      routeBadgeFromParts([{ type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "interrupted" } } }]),
    ).toBeUndefined()
    expect(
      routeBadgeFromParts([{ type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "sent" } } }]),
    ).toBeUndefined()
    expect(
      routeBadgeFromParts([{ type: "text", text: "x", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "failed" } } }]),
    ).toBeUndefined()
  })
})

describe("routeBadgeLabel", () => {
  test("makes every outbound fence explicit", () => {
    expect(routeBadgeLabel({ kind: "queued" })).toBe("○ queued")
    expect(routeBadgeLabel({ kind: "steered" })).toBe("→ steered")
    expect(routeBadgeLabel({ kind: "sent" })).toBe("✓ Sent")
    expect(routeBadgeLabel({ kind: "sent", stale: true })).toBe("✓ Sent")
    expect(routeBadgeLabel({ kind: "interrupted" })).toBe("⛔ Interrupted")
    expect(routeBadgeLabel({ kind: "failed" })).toBe("Failed")
  })

  test("workflow badges use a plain plan name", () => {
    expect(
      routeBadgeLabel({
        kind: "workflow",
        workflowID: "research.targeted_evidence",
        operation: "research",
        strategy: "targeted_evidence",
        runID: "r1",
      }),
    ).toBe("◈ Find evidence")
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
