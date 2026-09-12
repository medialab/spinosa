// Intended flow: ambiguous requests reach the constrained router agent as a
// separate internal call reusing the conversation's selected model; TS
// validates the JSON; invalid/low-confidence output falls back. Provenance
// (`via`) declares in the conversation whether a model call ran.
import { describe, expect, test } from "bun:test"
import { MockHarness } from "@spinosa/harness"
import { routeRequest } from "../src/application/router-service"
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

  test("invalid router JSON falls back deterministically (still model-consulted)", async () => {
    const harness = new MockHarness()
    harness.scriptedOutputs.set("spinosa-router", "not json at all")
    const routed = await routeRequest({
      routeInput: AMBIGUOUS, harness, sessionID: "parent-1", model: MODEL,
    })
    expect(routed.decision.mode).toBe("orchestrated")
    expect(routed.via).toBe("model")
  })

  test("low-confidence research intent falls back to targeted evidence", async () => {
    const harness = new MockHarness()
    harness.scriptedOutputs.set(
      "spinosa-router",
      JSON.stringify({ mode: "orchestrated", operation: "research", strategy: "corpus_census", confidence: 0.1 }),
    )
    const routed = await routeRequest({
      routeInput: AMBIGUOUS, harness, sessionID: "parent-1",
    })
    expect(routed.decision).toMatchObject({ strategy: "targeted_evidence", confidence: 0.5 })
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
})
