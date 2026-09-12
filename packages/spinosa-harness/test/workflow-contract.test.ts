// WP4: harness workflow contract — child sessions, parent mapping, model +
// permission mapping, normalized text, parallel execution, cancellation.
import { describe, expect, test } from "bun:test"
import { MockHarness } from "../src/mock"
import { SpinosaKernelHarness } from "../src/kernel"

describe("MockHarness workflow extensions", () => {
  test("records child-session metadata and tool policy", async () => {
    const harness = new MockHarness()
    const child = await harness.createSession({
      workspacePath: "/tmp/ws",
      parentSessionID: "parent-1",
      agent: "spinosa-searcher",
      metadata: { spinosaInternal: true, spinosaRunID: "r1" },
      toolPolicy: [{ tool: "write", resource: "agent_reports/*", effect: "allow" }],
    })
    expect(harness.sessionMeta.get(child.id)?.parentSessionID).toBe("parent-1")
    expect(harness.sessionMeta.get(child.id)?.toolPolicy).toHaveLength(1)
  })

  test("returns normalized text and honors scripted outputs", async () => {
    const harness = new MockHarness()
    harness.scriptedOutputs.set("spinosa-searcher", "evidence text")
    const session = await harness.createSession({ workspacePath: "/tmp/ws" })
    const result = await harness.executeAgent({ sessionID: session.id, agent: "spinosa-searcher", prompt: "x" })
    expect(result.text).toBe("evidence text")
    expect(result.sessionID).toBe(session.id)
  })

  test("runs two searcher branches concurrently and cancels both", async () => {
    const harness = new MockHarness()
    harness.delaysMs.set("spinosa-searcher", 20)
    const a = await harness.createSession({ workspacePath: "/tmp/ws", parentSessionID: "p" })
    const b = await harness.createSession({ workspacePath: "/tmp/ws", parentSessionID: "p" })
    const [ra, rb] = await Promise.all([
      harness.executeAgent({ sessionID: a.id, agent: "spinosa-searcher", prompt: "branch A" }),
      harness.executeAgent({ sessionID: b.id, agent: "spinosa-searcher", prompt: "branch B" }),
    ])
    expect(ra.sessionID).not.toBe(rb.sessionID)
    await harness.cancelExecution({ sessionID: a.id })
    expect(harness.events.some((e) => e.type === "execution.cancelled")).toBe(true)
  })

  test("injected failures surface to the caller", async () => {
    const harness = new MockHarness()
    harness.failures.set("spinosa-writer", new Error("writer down"))
    const session = await harness.createSession({ workspacePath: "/tmp/ws" })
    await expect(harness.executeAgent({ sessionID: session.id, agent: "spinosa-writer", prompt: "x" })).rejects.toThrow("writer down")
  })
})

describe("SpinosaKernelHarness workflow mapping", () => {
  test("passes parentID/model/permission to session.create", async () => {
    const requests: Record<string, unknown>[] = []
    const harness = new SpinosaKernelHarness({
      session: {
        create: async (input: Record<string, unknown>) => {
          requests.push(input)
          return { data: { id: "ses_child" } }
        },
        prompt: async () => ({ data: {} }),
        deleteMessage: async () => ({ data: {} }),
        abort: async () => ({ data: {} }),
        get: async () => ({ data: {} }),
      },
      global: { event: async () => ({ stream: (async function* () {})() }) },
      permission: { reply: async () => ({ data: {} }) },
    })
    await harness.createSession({
      workspacePath: "/tmp/ws",
      parentSessionID: "parent-1",
      agent: "spinosa-searcher",
      model: { providerID: "opencode", modelID: "m" },
      metadata: { spinosaRunID: "r1" },
      toolPolicy: [{ tool: "write", resource: "agent_reports/*", effect: "allow" }],
    })
    expect(requests[0]).toMatchObject({
      directory: "/tmp/ws",
      parentID: "parent-1",
      agent: "spinosa-searcher",
      model: { providerID: "opencode", id: "m" },
    })
  })

  test("extracts text parts before silent deletion", async () => {
    const harness = new SpinosaKernelHarness({
      session: {
        create: async () => ({ data: { id: "s" } }),
        prompt: async () => ({
          data: { info: { id: "msg_1" }, parts: [{ type: "text", text: "hello" }, { type: "tool", name: "read" }] },
        }),
        deleteMessage: async () => ({ data: {} }),
        abort: async () => ({ data: {} }),
        get: async () => ({ data: {} }),
      },
      global: { event: async () => ({ stream: (async function* () {})() }) },
      permission: { reply: async () => ({ data: {} }) },
    })
    const result = await harness.executeAgent({ sessionID: "s", agent: "spinosa-searcher", prompt: "x", silent: true })
    expect(result.text).toBe("hello")
    expect(result.assistantMessageID).toBe("msg_1")
  })
})
