import { describe, expect, test } from "bun:test"
import {
  CHAT_PATH_LABEL,
  resolveRouteBadge,
  routeBadgeChatTone,
  routeBadgeFromParts,
  routeBadgeLabel,
  SPINOSA_ROUTE_METADATA,
  spinosaRoutePathFromParts,
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

  test("a Pick a path title becomes Chat or a plan name", () => {
    expect(routeBadgeLabel({ kind: "path", label: CHAT_PATH_LABEL })).toBe("Chat")
    expect(routeBadgeLabel({ kind: "path", label: "Find evidence" })).toBe("◈ Find evidence")
    expect(routeBadgeChatTone({ kind: "path", label: CHAT_PATH_LABEL })).toBe(true)
    expect(routeBadgeChatTone({ kind: "path", label: "Find evidence" })).toBe(false)
    expect(routeBadgeChatTone({ kind: "general" })).toBe(true)
  })
})

const generalUser = [{ type: "text", text: "Hi", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "general" } } }]
const workflowUser = [
  {
    type: "text",
    text: "find evidence",
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
]

describe("resolveRouteBadge", () => {
  test("keeps General prompt until Pick a path has a title", () => {
    expect(resolveRouteBadge(generalUser)).toMatchObject({ kind: "general" })
    expect(
      resolveRouteBadge(generalUser, [
        { type: "tool", tool: "spinosa_route", state: { status: "pending" } },
      ]),
    ).toMatchObject({ kind: "general" })
    expect(
      resolveRouteBadge(generalUser, [
        { type: "tool", tool: "spinosa_route", state: { status: "running" } },
      ]),
    ).toMatchObject({ kind: "general" })
    expect(
      resolveRouteBadge(generalUser, [
        { type: "tool", tool: "spinosa_route", state: { status: "error", title: "Failed" } },
      ]),
    ).toMatchObject({ kind: "general" })
  })

  test("replaces General prompt with Chat or a plan name", () => {
    expect(
      resolveRouteBadge(generalUser, [
        { type: "tool", tool: "spinosa_route", state: { status: "completed", title: "Chat" } },
      ]),
    ).toEqual({ kind: "path", label: "Chat" })
    expect(
      resolveRouteBadge(generalUser, [
        {
          type: "tool",
          tool: "spinosa_route",
          state: { status: "completed", title: "Index the workspace" },
        },
      ]),
    ).toEqual({ kind: "path", label: "Index the workspace" })
    expect(
      resolveRouteBadge([{ type: "text", text: "unstamped" }], [
        { type: "tool", tool: "spinosa_route", state: { status: "completed", title: "Chat" } },
      ]),
    ).toEqual({ kind: "path", label: "Chat" })
  })

  test("does not overwrite a submit-stamped workflow badge", () => {
    expect(
      resolveRouteBadge(workflowUser, [
        { type: "tool", tool: "spinosa_route", state: { status: "completed", title: "Chat" } },
      ]),
    ).toMatchObject({ kind: "workflow", workflowID: "research.targeted_evidence" })
  })

  test("uses the last successful Pick a path title", () => {
    expect(
      spinosaRoutePathFromParts([
        { type: "tool", tool: "spinosa_route", state: { status: "completed", title: "Chat" } },
        { type: "tool", tool: "read", state: { status: "completed", title: "ignore" } },
        {
          type: "tool",
          tool: "spinosa_route",
          state: { status: "completed", title: "Find evidence" },
        },
      ]),
    ).toBe("Find evidence")
  })
})
