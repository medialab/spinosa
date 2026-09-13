// Intended flow: ambiguous requests reach the constrained router agent as a
// separate internal call reusing the conversation's selected model; TS
// validates the JSON; invalid/low-confidence output falls back. Provenance
// (`via`) declares in the conversation whether a model call ran.
import { describe, expect, test } from "bun:test"
import { MockHarness } from "@spinosa/harness"
import { extractRouterJson, routeRequest, RouterAbortedError } from "../src/application/router-service"
import type { RouteInput } from "@spinosa/runtime"

const AMBIGUOUS: RouteInput = {
  text: "What does the corpus say about onboarding?",
  workspace: { isSpinosa: true, setupStatus: "workspace_started" },
  references: { fileCount: 0, hasSelectedRange: false, fileNames: [], mimeTypes: [] },
}

const MODEL = { providerID: "opencode", modelID: "conversation-model" }

describe("routeRequest Stage 2", () => {
  test("router call reuses the supplied conversation model", async () => {
    const harness = new MockHarness()
    harness.scriptedOutputs.set(
      "spinosa-router",
      JSON.stringify({
        mode: "orchestrated", operation: "research", strategy: "comparative_synthesis",
        scope: "corpus_wide", coverage: "representative", outputs: ["report"],
        mutation: "none", verification: "strict", evaluation: "always",
        reason: "cohort comparison", confidence: 0.9,
      }),
    )
    const routed = await routeRequest({
      routeInput: AMBIGUOUS, harness, sessionID: "parent-1", model: MODEL,
    })
    expect(routed.via).toBe("model")
    expect(routed.decision).toMatchObject({ mode: "orchestrated", strategy: "comparative_synthesis" })
    expect(harness.executions[0]?.agent).toBe("spinosa-router")
    expect(harness.executions[0]?.model).toEqual(MODEL)
    expect(harness.executions[0]?.silent).toBe(true)
  })

  test("invalid router JSON falls back to generic (still model-consulted)", async () => {
    const harness = new MockHarness()
    harness.scriptedOutputs.set("spinosa-router", "not json at all")
    const routed = await routeRequest({
      routeInput: AMBIGUOUS, harness, sessionID: "parent-1", model: MODEL,
    })
    expect(routed.decision).toEqual({ mode: "generic" })
    expect(routed.via).toBe("model")
  })

  test("low-confidence verdicts degrade to generic, never forced research", async () => {
    const harness = new MockHarness()
    harness.scriptedOutputs.set(
      "spinosa-router",
      JSON.stringify({ mode: "orchestrated", operation: "research", strategy: "corpus_census", confidence: 0.1 }),
    )
    const routed = await routeRequest({
      routeInput: AMBIGUOUS, harness, sessionID: "parent-1",
    })
    expect(routed.decision).toEqual({ mode: "generic" })
    expect(routed.via).toBe("model")
  })

  test("explicit generic verdicts pass through as generic", async () => {
    const harness = new MockHarness()
    harness.scriptedOutputs.set("spinosa-router", JSON.stringify({ mode: "generic" }))
    const routed = await routeRequest({
      routeInput: AMBIGUOUS, harness, sessionID: "parent-1", model: MODEL,
    })
    expect(routed.decision).toEqual({ mode: "generic" })
    expect(routed.via).toBe("model")
  })

  test("without a harness, ambiguous input uses the heuristic (no model call)", async () => {
    const routed = await routeRequest({ routeInput: AMBIGUOUS })
    expect(routed.decision).toMatchObject({ mode: "orchestrated", strategy: "targeted_evidence" })
    expect(routed.via).toBe("rules")
  })

  test("deterministic hits report rules provenance", async () => {
    const routed = await routeRequest({
      routeInput: { ...AMBIGUOUS, text: "Hi" },
    })
    expect(routed.decision.mode).toBe("fast")
    expect(routed.via).toBe("rules")
  })

  test("slow router call times out to generic and cancels the orphan", async () => {
    const harness = new MockHarness()
    harness.delaysMs.set("spinosa-router", 150)
    const routed = await routeRequest({
      routeInput: AMBIGUOUS, harness, sessionID: "parent-1", timeoutMs: 20,
    })
    expect(routed.decision).toEqual({ mode: "generic" })
    expect(routed.via).toBe("rules")
    expect(harness.cancelled.has("parent-1")).toBe(true)
  })

  test("pre-aborted signal rejects without calling the model", async () => {
    const harness = new MockHarness()
    const controller = new AbortController()
    controller.abort()
    await expect(
      routeRequest({ routeInput: AMBIGUOUS, harness, sessionID: "parent-1", signal: controller.signal }),
    ).rejects.toBeInstanceOf(RouterAbortedError)
    expect(harness.executions).toHaveLength(0)
  })

  test("mid-flight abort rejects and cancels the orphan turn", async () => {
    const harness = new MockHarness()
    harness.delaysMs.set("spinosa-router", 100)
    const controller = new AbortController()
    const pending = routeRequest({
      routeInput: AMBIGUOUS, harness, sessionID: "parent-1", signal: controller.signal, timeoutMs: 5000,
    })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(RouterAbortedError)
    expect(harness.cancelled.has("parent-1")).toBe(true)
  })

  test("router preamble + Thought dump still parses (preamble-tolerant)", async () => {
    const harness = new MockHarness()
    const decision = JSON.stringify({
      mode: "fast", action: "answer", reason: "ordinary conversation", confidence: 0.8,
    })
    harness.scriptedOutputs.set("spinosa-router", `Ok go on\n- Thought: 12.5s\n${decision}\n`)
    const routed = await routeRequest({
      routeInput: { ...AMBIGUOUS, text: "go on" }, harness, sessionID: "parent-1", model: MODEL,
    })
    expect(routed.via).toBe("model")
    expect(routed.decision).toMatchObject({ mode: "fast", action: "answer" })
    expect(extractRouterJson("no braces")).toBe("no braces")
  })
})
