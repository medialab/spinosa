// WP1/WP2/WP5: engine scheduling, registry resolution, deterministic routing,
// legacy migration, crash recovery. Replaces fixed-Q assertions with graph
// semantics (runtime.test.ts keeps legacy Q coverage until WP10).
import { describe, expect, test } from "bun:test"
import {
  blockWorkflowRun,
  cancelWorkflowRun,
  completeRun,
  completeStep,
  createWorkflowRun,
  decodeWorkflowRun,
  defaultRegistry,
  deterministicRoute,
  heuristicAmbiguousRoute,
  legacyRouteDecision,
  retryStep,
  runnableSteps,
  startStep,
  type OrchestratedDecision,
  type WorkflowPlan,
} from "../src"

function decision(overrides: Partial<OrchestratedDecision> = {}): OrchestratedDecision {
  return {
    mode: "orchestrated", operation: "research", strategy: "targeted_evidence",
    scope: "subset", coverage: "sufficient", outputs: ["report"],
    mutation: "none", verification: "normal", evaluation: "always",
    reason: "test", confidence: 0.9, ...overrides,
  }
}

const tinyPlan: WorkflowPlan = {
  id: "test.tiny", version: 1,
  nodes: [
    { kind: "system", id: "goal", operation: "artifacts.write_goal", dependsOn: [] },
    {
      kind: "agent", id: "search", agent: "spinosa-searcher", dependsOn: ["goal"],
      visibility: "internal", promptKey: "search.targeted", toolPolicy: [],
      expectedArtifacts: [], retry: { maxAttempts: 2, retryOn: ["missing_artifact"] },
    },
    {
      kind: "agent", id: "write", agent: "spinosa-writer", dependsOn: ["search"],
      visibility: "user", promptKey: "writer.report", toolPolicy: [],
      expectedArtifacts: [], retry: { maxAttempts: 1, retryOn: [] },
    },
  ],
}

const fanPlan: WorkflowPlan = {
  id: "test.fan", version: 1,
  nodes: [
    { kind: "system", id: "goal", operation: "artifacts.write_goal", dependsOn: [] },
    { kind: "fanout", id: "fan", sourceStep: "goal", templateKey: "search.partition", dependsOn: ["goal"], maxConcurrency: 3 },
    {
      kind: "agent", id: "write", agent: "spinosa-writer", dependsOn: ["fan"],
      visibility: "user", promptKey: "writer.report", toolPolicy: [],
      expectedArtifacts: [], retry: { maxAttempts: 1, retryOn: [] },
    },
  ],
}

describe("engine", () => {
  test("schedules linearly through dependencies", () => {
    let run = createWorkflowRun({
      id: "r1", workspacePath: "/tmp", parentSessionID: "p",
      prompt: "x", decision: decision(), plan: tinyPlan,
    })
    expect(runnableSteps(run, tinyPlan).map((n) => n.id)).toEqual(["goal"])
    run = startStep(run, "goal", {})
    run = completeStep(run, "goal", { status: "succeeded", artifacts: [] })
    expect(runnableSteps(run, tinyPlan).map((n) => n.id)).toEqual(["search"])
  })

  test("fanout unblocks its dependents after success", () => {
    let run = createWorkflowRun({
      id: "r1", workspacePath: "/tmp", parentSessionID: "p",
      prompt: "x", decision: decision(), plan: fanPlan,
    })
    run = startStep(run, "goal", {})
    run = completeStep(run, "goal", { status: "succeeded", artifacts: [] })
    expect(runnableSteps(run, fanPlan).map((n) => n.id)).toEqual(["fan"])
    run = startStep(run, "fan", {})
    run = completeStep(run, "fan", { status: "succeeded", artifacts: [] })
    expect(runnableSteps(run, fanPlan).map((n) => n.id)).toEqual(["write"])
  })

  test("retry returns running steps to retrying; terminal states are immutable", () => {
    let run = createWorkflowRun({
      id: "r1", workspacePath: "/tmp", parentSessionID: "p",
      prompt: "x", decision: decision(), plan: tinyPlan,
    })
    run = startStep(run, "goal", {})
    run = completeStep(run, "goal", { status: "succeeded", artifacts: [] })
    run = startStep(run, "search", {})
    run = completeStep(run, "search", { status: "failed", error: "boom", retryable: true })
    expect(run.steps.search?.status).toBe("failed")
    run = retryStep(run, "search", "retry")
    expect(run.steps.search?.status).toBe("retrying")
    expect(runnableSteps(run, tinyPlan).map((n) => n.id)).toEqual(["search"])
    run = blockWorkflowRun(run, "stop")
    const blocked = run
    run = completeRun(run)
    expect(run.status).toBe("blocked")
    run = cancelWorkflowRun(blocked)
    expect(run.status).toBe("blocked")
  })

  test("no runnable steps without completed dependencies", () => {
    const run = createWorkflowRun({
      id: "r1", workspacePath: "/tmp", parentSessionID: "p",
      prompt: "x", decision: decision(), plan: tinyPlan,
    })
    expect(runnableSteps(run, tinyPlan).map((n) => n.id)).toEqual(["goal"])
  })
})

describe("registry", () => {
  test("resolves every research strategy to a known workflow", () => {
    for (const strategy of ["targeted_evidence", "contextual_synthesis", "corpus_census", "comparative_synthesis", "hypothesis_test", "exploratory_discovery"] as const) {
      const def = defaultRegistry.resolve(decision({ strategy }))
      expect(def.id.startsWith("research.")).toBe(true)
      const plan = def.build({ runID: "r", decision: decision({ strategy }) })
      expect(plan.nodes.length).toBeGreaterThan(0)
    }
  })

  test("startup/add/maintenance/meta resolve distinctly", () => {
    expect(defaultRegistry.resolve(decision({ operation: "corpus", strategy: "startup_index" })).id).toBe("corpus.startup_index")
    expect(defaultRegistry.resolve(decision({ operation: "corpus", strategy: "add_sources" })).id).toBe("corpus.add_sources")
    expect(defaultRegistry.resolve(decision({ operation: "maintenance", strategy: "cleanup_proposal" })).id).toBe("maintenance.cleanup_proposal")
    expect(defaultRegistry.resolve(decision({ operation: "meta", strategy: "coverage_audit" })).id).toBe("meta.coverage_audit")
  })

  test("unknown combinations throw", () => {
    expect(() => defaultRegistry.resolve(decision({ operation: "research", strategy: "startup_index" as never }))).toThrow()
  })
})

describe("deterministic router", () => {
  const base = {
    workspace: { isSpinosa: true, setupStatus: "workspace_started" as const },
    references: { fileCount: 0, hasSelectedRange: false, fileNames: [], mimeTypes: [] },
  }
  test("explicit agent and non-Spinosa bypass", () => {
    expect(deterministicRoute({ text: "find evidence", explicitAgent: "build", ...base })?.mode).toBe("fast")
    expect(deterministicRoute({
      text: "find evidence in corpus",
      workspace: { isSpinosa: false, setupStatus: "unknown" },
      references: base.references,
    })?.mode).toBe("fast")
  })

  test("startup command and startup prompt text bypass the model", () => {
    expect(deterministicRoute({ text: "anything", command: "startup", ...base })).toMatchObject({
      operation: "corpus", strategy: "startup_index",
    })
    expect(
      deterministicRoute({ text: "Run Spinosa startup indexing for this workspace.", ...base }),
    ).toMatchObject({ operation: "corpus", strategy: "startup_index" })
  })

  test("no code interprets request semantics — everything else goes to the model", () => {
    const starting = {
      ...base,
      workspace: { isSpinosa: true, setupStatus: "cli_started" as const },
    }
    // Greetings, coverage language, comparisons, hypotheses, hidden-pattern
    // asks, cleanup asks: none match a structural bypass, in ANY workspace
    // state. The router model classifies them.
    for (const text of [
      "Hi",
      "Hi there, roam a bit the workspace",
      "Who mentions X in the corpus? Full census",
      "Compare cohort A vs cohort B across groups",
      "Hypothesis: X causes Y; test with supporting and contradicting evidence",
      "Find hidden unexpected connections across sources",
      "Clean up stale research notes",
      "New source files were added, integrate them",
    ]) {
      expect(deterministicRoute({ text, ...base })).toBeUndefined()
      expect(deterministicRoute({ text, ...starting })).toBeUndefined()
    }
  })

  test("ambiguous bounded text stays fast; research text goes targeted", () => {
    expect(heuristicAmbiguousRoute("Explain this term").mode).toBe("fast")
    expect(heuristicAmbiguousRoute("Find source-grounded evidence for interviews")).toMatchObject({ strategy: "targeted_evidence" })
  })
})

describe("migration", () => {
  test("legacy Q routes map to workflows; Q5 gains verifier", () => {
    expect(legacyRouteDecision("Q1")).toMatchObject({ strategy: "targeted_evidence" })
    expect(legacyRouteDecision("Q5")).toMatchObject({ strategy: "coverage_audit" })
    const migrated = decodeWorkflowRun({
      id: "l", workspacePath: "/tmp", prompt: "x", route: "Q5",
      status: "classified", phaseIndex: 1,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    })
    expect(migrated.workflowID).toBe("meta.coverage_audit")
    expect(migrated.steps.overseer?.status).toBe("succeeded")
    expect(migrated.steps.verifier?.status).toBe("pending")
  })

  test("invalid payloads throw", () => {
    expect(() => decodeWorkflowRun({ nope: true })).toThrow()
  })
})
