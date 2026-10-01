import { describe, expect, test } from "bun:test"
import { resolveSpinosaRouteBadge, SPINOSA_ROUTE_METADATA } from "./spinosa-route-badge"

const general = [{ type: "text", text: "hi", metadata: { [SPINOSA_ROUTE_METADATA]: { kind: "general" } } }]

describe("Spinosa route badge", () => {
  test("shows General prompt for a submitted or legacy text message", () => {
    expect(resolveSpinosaRouteBadge(general)).toEqual({ kind: "general" })
    expect(resolveSpinosaRouteBadge([{ type: "text", text: "older message" }])).toEqual({ kind: "general" })
    expect(resolveSpinosaRouteBadge([{ type: "text", text: "context", synthetic: true }])).toBeUndefined()
  })

  test("updates only after Pick a path has a successful title", () => {
    expect(resolveSpinosaRouteBadge(general, [
      { type: "tool", tool: "spinosa_route", state: { status: "pending" } },
    ])).toEqual({ kind: "general" })
    expect(resolveSpinosaRouteBadge(general, [
      { type: "tool", tool: "spinosa_route", state: { status: "error", title: "Failed" } },
    ])).toEqual({ kind: "general" })
    expect(resolveSpinosaRouteBadge(general, [
      { type: "tool", tool: "spinosa_route", state: { status: "completed", title: "Chat" } },
    ])).toEqual({ kind: "path", label: "Chat" })
    expect(resolveSpinosaRouteBadge(general, [
      { type: "tool", tool: "spinosa_route", state: { status: "completed", title: "Chat" } },
      { type: "tool", tool: "spinosa_route", state: { status: "completed", title: "Find evidence" } },
    ])).toEqual({ kind: "path", label: "Find evidence" })
  })

  test("keeps a workflow tag already stamped on the user message", () => {
    const workflow = [{ type: "text", text: "find evidence", metadata: {
      [SPINOSA_ROUTE_METADATA]: {
        kind: "workflow", workflowID: "research.targeted_evidence", operation: "research",
        strategy: "targeted_evidence", runID: "r1",
      },
    } }]
    expect(resolveSpinosaRouteBadge(workflow, [
      { type: "tool", tool: "spinosa_route", state: { status: "completed", title: "Chat" } },
    ])).toEqual({ kind: "workflow", workflowID: "research.targeted_evidence" })
  })
})
