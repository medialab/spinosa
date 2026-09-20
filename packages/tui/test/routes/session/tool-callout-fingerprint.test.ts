import { describe, expect, test } from "bun:test"
import { toolPartsFingerprint } from "../../../src/routes/session/tool-callout-fingerprint"

describe("toolPartsFingerprint", () => {
  test("ignores text parts so streaming deltas do not change the key", () => {
    const messages = [{ id: "m1" }, { id: "m2" }]
    const before = {
      m1: [{ type: "text" }, { type: "tool", callID: "c1", tool: "read", state: { status: "completed" } }],
      m2: [{ type: "text" }],
    }
    const after = {
      m1: [{ type: "text" }, { type: "tool", callID: "c1", tool: "read", state: { status: "completed" } }],
      m2: [{ type: "text" }, { type: "text" }],
    }
    expect(toolPartsFingerprint(messages, before)).toBe(toolPartsFingerprint(messages, after))
  })

  test("changes when a tool status changes", () => {
    const messages = [{ id: "m1" }]
    const running = {
      m1: [{ type: "tool", callID: "c1", tool: "bash", state: { status: "running" } }],
    }
    const done = {
      m1: [{ type: "tool", callID: "c1", tool: "bash", state: { status: "completed" } }],
    }
    expect(toolPartsFingerprint(messages, running)).not.toBe(toolPartsFingerprint(messages, done))
  })
})
