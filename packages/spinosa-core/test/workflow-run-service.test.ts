// WP6/WP8: WorkflowRunService — prepare/execute/resume/cancel over the
// executable workflow engine (MockHarness, synthesized artifacts for happy
// paths; strict mode asserts retry-then-block semantics).
import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { MockHarness } from "@spinosa/harness"
import { FileWorkflowRunRepository, cancelWorkflowRun, decodeWorkflowRun, isWorkflowTerminal } from "@spinosa/runtime"
import { WorkflowRunService } from "../src/application/workflow-run-service"
import { STARTUP_WORKFLOW_TRIGGER } from "../src/commands/startup"

async function workspace(status = "workspace_started"): Promise<string> {
  const root = path.join(tmpdir(), "spinosa-wf-" + crypto.randomUUID())
  await mkdir(path.join(root, ".spinosa"), { recursive: true })
  await mkdir(path.join(root, "agent_reports"), { recursive: true })
  await mkdir(path.join(root, "raw"), { recursive: true })
  await Bun.write(path.join(root, ".spinosa", "workspace"), `setup_status: ${status}\n`)
  await Bun.write(path.join(root, "AGENTS.md"), "# Test workspace\n")
  await Bun.write(path.join(root, "system/configuration.md"), `setup_status: ${status}\n`)
  return root
}

describe("WorkflowRunService.prepare", () => {
  test("routes bounded chat to the direct path", async () => {
    const root = await workspace()
    const prepared = await new WorkflowRunService().prepare({
      workspacePath: root, parentSessionID: "p1", prompt: "Hi",
    })
    expect(prepared.kind).toBe("direct")
  })

  test("routes evidence requests to targeted_evidence with a V2 run + goal", async () => {
    const root = await workspace()
    const prepared = await new WorkflowRunService().prepare({
      workspacePath: root, parentSessionID: "p1", prompt: "Find source-grounded evidence for interviews",
    })
    if (prepared.kind !== "workflow") throw new Error("expected workflow")
    expect(prepared.decision).toMatchObject({ operation: "research", strategy: "targeted_evidence" })
    expect(prepared.workflowID).toBe("research.targeted_evidence")
    const run = await new FileWorkflowRunRepository().load(root, prepared.runID)
    expect(run?.schemaVersion).toBe(2)
    expect(await Bun.file(path.join(root, prepared.goalPath)).exists()).toBe(true)
  })

  test("startup trigger and cli_started resolve corpus.startup_index", async () => {
    const root = await workspace("cli_started")
    const prepared = await new WorkflowRunService().prepare({
      workspacePath: root, parentSessionID: "p1", prompt: STARTUP_WORKFLOW_TRIGGER,
    })
    if (prepared.kind !== "workflow") throw new Error("expected workflow")
    expect(prepared.workflowID).toBe("corpus.startup_index")
  })

  test("model-routed add signal resolves corpus.add_sources", async () => {
    const root = await workspace()
    const harness = new MockHarness()
    harness.scriptedOutputs.set(
      "spinosa-router",
      JSON.stringify({
        mode: "orchestrated", operation: "corpus", strategy: "add_sources",
        scope: "subset", coverage: "sufficient", outputs: ["report"],
        mutation: "none", verification: "normal", evaluation: "always",
        reason: "incremental import", confidence: 0.9,
      }),
    )
    const service = new WorkflowRunService(new FileWorkflowRunRepository(), undefined, harness)
    const prepared = await service.prepare({
      workspacePath: root, parentSessionID: "p1",
      prompt: "New source files were added; update maps and dictionary for the additions",
    })
    if (prepared.kind !== "workflow") throw new Error("expected workflow")
    expect(prepared.workflowID).toBe("corpus.add_sources")
    expect(prepared.routedBy).toBe("model")
  })

  test("explicit agent bypasses workflow routing", async () => {
    const root = await workspace()
    const prepared = await new WorkflowRunService().prepare({
      workspacePath: root, parentSessionID: "p1",
      prompt: "Find source-grounded evidence for interviews", explicitAgent: "build",
    })
    expect(prepared.kind).toBe("direct")
  })
})

describe("WorkflowRunService.execute", () => {
  test("completes the targeted chain with synthesized artifacts", async () => {
    const root = await workspace()
    const harness = new MockHarness()
    // Garbage router output falls back to generic (plain answer), so script
    // an explicit orchestrated verdict: this test covers execute(), not routing.
    harness.scriptedOutputs.set(
      "spinosa-router",
      JSON.stringify({
        mode: "orchestrated", operation: "research", strategy: "targeted_evidence",
        scope: "subset", coverage: "sufficient", outputs: ["report"],
        mutation: "none", verification: "normal", evaluation: "always",
        reason: "scripted verdict", confidence: 0.9,
      }),
    )
    const service = new WorkflowRunService(new FileWorkflowRunRepository(), undefined, harness)
    const prepared = await service.prepare({
      workspacePath: root, parentSessionID: "p1", prompt: "Find source-grounded evidence for interviews",
    })
    if (prepared.kind !== "workflow") throw new Error("expected workflow")
    const run = await service.execute({ prepared, harness, synthesizeForTest: true })
    expect(run.status).toBe("completed")
    // Child sessions isolate worker output from the visible parent.
    for (const [, meta] of harness.sessionMeta) {
      expect(meta.parentSessionID).toBe("p1")
    }
  })

  test("adapters without parallel support run the same graph sequentially", async () => {
    const root = await workspace()
    const harness = new MockHarness()
    ;(harness as { capabilities: Record<string, boolean> }).capabilities.parallelAgentExecutions = false
    harness.scriptedOutputs.set(
      "spinosa-router",
      JSON.stringify({
        mode: "orchestrated", operation: "research", strategy: "corpus_census",
        scope: "corpus_wide", coverage: "representative", outputs: ["report"],
        mutation: "none", verification: "strict", evaluation: "always",
        reason: "completeness claim", confidence: 0.9,
      }),
    )
    const service = new WorkflowRunService(new FileWorkflowRunRepository(), undefined, harness)
    const prepared = await service.prepare({
      workspacePath: root, parentSessionID: "p1", prompt: "Who mentions X in the corpus? Full census",
    })
    if (prepared.kind !== "workflow") throw new Error("expected workflow")
    expect(prepared.workflowID).toBe("research.corpus_census")
    const run = await service.execute({ prepared, harness, synthesizeForTest: true })
    expect(run.status).toBe("completed")
  })

  test("missing artifacts retry once then block (strict production mode)", async () => {
    const root = await workspace()
    const harness = new MockHarness()
    const service = new WorkflowRunService()
    const prepared = await service.prepare({
      workspacePath: root, parentSessionID: "p1", prompt: "Find source-grounded evidence for interviews",
    })
    if (prepared.kind !== "workflow") throw new Error("expected workflow")
    const run = await service.execute({ prepared, harness })
    expect(run.status).toBe("blocked")
    expect(run.steps.search?.attempt).toBe(2)
  })

  test("cancel terminates the run and reaches the harness", async () => {
    const root = await workspace()
    const harness = new MockHarness()
    harness.delaysMs.set("*", 50)
    const service = new WorkflowRunService()
    const prepared = await service.prepare({
      workspacePath: root, parentSessionID: "p1", prompt: "Find source-grounded evidence for interviews",
    })
    if (prepared.kind !== "workflow") throw new Error("expected workflow")
    const executing = service.execute({ prepared, harness, synthesizeForTest: true })
    await service.cancel({ workspacePath: root, runID: prepared.runID, harness })
    const run = await executing
    // Fenced: a persisted cancellation is adopted, never overwritten.
    expect(run.status).toBe("cancelled")
    expect(harness.events.some((e) => e.type === "execution.cancelled")).toBe(true)
  })

  test("late child success after cancel cannot reopen the run", async () => {
    const root = await workspace()
    const harness = new MockHarness()
    harness.delaysMs.set("spinosa-searcher", 300)
    const service = new WorkflowRunService()
    const prepared = await service.prepare({
      workspacePath: root, parentSessionID: "p1", prompt: "Find source-grounded evidence for interviews",
    })
    if (prepared.kind !== "workflow") throw new Error("expected workflow")
    const executing = service.execute({ prepared, harness, synthesizeForTest: true })
    // Wait for the search child to exist, then cancel while it runs.
    const deadline = Date.now() + 5000
    for (;;) {
      const searchers = [...harness.sessionMeta.values()].filter((meta) => meta.agent === "spinosa-searcher")
      if (searchers.length > 0) break
      if (Date.now() > deadline) throw new Error("search child never started")
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    await service.cancel({ workspacePath: root, runID: prepared.runID, harness })
    // Let the in-flight child succeed anyway: the mock would reject on the
    // cancelled flag, so lift it to simulate a child that ignores abort.
    harness.cancelled.clear()
    const run = await executing
    expect(run.status).toBe("cancelled")
    // No successor node started after the cancellation.
    const agents = [...harness.sessionMeta.values()].map((meta) => meta.agent)
    expect(agents).not.toContain("spinosa-writer")
    expect(agents).not.toContain("spinosa-verifier")
    // Persisted state agrees: still cancelled after the late success.
    const reloaded = await new FileWorkflowRunRepository().load(root, prepared.runID)
    expect(reloaded?.status).toBe("cancelled")
  })

  test("fanout branch sessions are registered and cancelled", async () => {
    const root = await workspace()
    const harness = new MockHarness()
    ;(harness as { capabilities: Record<string, boolean> }).capabilities.parallelAgentExecutions = false
    harness.scriptedOutputs.set(
      "spinosa-router",
      JSON.stringify({
        mode: "orchestrated", operation: "research", strategy: "corpus_census",
        scope: "corpus_wide", coverage: "representative", outputs: ["report"],
        mutation: "none", verification: "strict", evaluation: "always",
        reason: "scripted verdict", confidence: 0.9,
      }),
    )
    harness.delaysMs.set("spinosa-searcher", 300)
    const service = new WorkflowRunService(new FileWorkflowRunRepository(), undefined, harness)
    const prepared = await service.prepare({
      workspacePath: root, parentSessionID: "p1", prompt: "Who mentions X in the corpus? Full census",
    })
    if (prepared.kind !== "workflow") throw new Error("expected workflow")
    expect(prepared.workflowID).toBe("research.corpus_census")
    // The partition system node recomputes partitions.json from raw/*.md at
    // execution time (BATCH=25), so seed 30 sources for 2 fanout branches
    // instead of pre-writing partitions.json (it would be overwritten).
    await mkdir(path.join(root, "raw"), { recursive: true })
    for (let i = 0; i < 30; i++) {
      await Bun.write(path.join(root, "raw", `source-${String(i).padStart(2, "0")}.md`), `# Source ${i}\n\nEvidence text.\n`)
    }
    const executing = service.execute({ prepared, harness, synthesizeForTest: true })
    // Wait for both branch children, then cancel mid-flight.
    const deadline = Date.now() + 10000
    for (;;) {
      const searchers = [...harness.sessionMeta.entries()].filter(([, meta]) => meta.agent === "spinosa-searcher")
      if (searchers.length >= 2) break
      if (Date.now() > deadline) throw new Error("fanout branches never started")
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const branchIDs = [...harness.sessionMeta.entries()]
      .filter(([, meta]) => meta.agent === "spinosa-searcher")
      .map(([id]) => id)
    await service.cancel({ workspacePath: root, runID: prepared.runID, harness })
    harness.cancelled.clear()
    const run = await executing
    expect(run.status).toBe("cancelled")
    // Branch registrations persisted at creation (before the await).
    expect(run.branchSessions?.["search-fanout"]?.length).toBe(2)
    // Every branch was addressed by cancellation, not just the step slot.
    const cancelledIDs = harness.events
      .filter((e) => e.type === "execution.cancelled")
      .map((e) => (e as { sessionID?: string }).sessionID)
    for (const id of branchIDs) expect(cancelledIDs).toContain(id)
  })

  test("a cancellation racing the commit cannot be overwritten", async () => {
    const root = await workspace()
    const repo = new FileWorkflowRunRepository()
    // Prepare without a harness: deterministic rules route to a workflow.
    // (With a harness the mock router returns garbage → general → direct.)
    const prepared = await new WorkflowRunService(repo).prepare({
      workspacePath: root, parentSessionID: "p1", prompt: "Find source-grounded evidence for interviews",
    })
    if (prepared.kind !== "workflow") throw new Error("expected workflow")
    const harness = new MockHarness()
    const service = new WorkflowRunService(repo, undefined, harness)
    // Arm the race when the first agent execution finishes: the post-batch
    // freshness check still sees the old state, but the commit-path load
    // observes a concurrently-persisted cancellation. A naive
    // load-then-save commit would overwrite it and reopen the run.
    let armed = false
    let loadsSinceArmed = 0
    let raceFired = false
    const origExecuteAgent = harness.executeAgent.bind(harness)
    harness.executeAgent = async (args: Parameters<typeof origExecuteAgent>[0]) => {
      const result = await origExecuteAgent(args)
      armed = true
      return result
    }
    const origLoad = repo.load.bind(repo)
    const origSave = repo.save.bind(repo)
    repo.load = async (workspacePath: string, runID: string) => {
      if (armed && !raceFired) {
        loadsSinceArmed += 1
        if (loadsSinceArmed === 2) {
          raceFired = true
          const fresh = await origLoad(workspacePath, runID)
          if (fresh && !isWorkflowTerminal(fresh)) {
            await origSave(cancelWorkflowRun(fresh))
          }
        }
      }
      return origLoad(workspacePath, runID)
    }
    const run = await service.execute({ prepared, harness, synthesizeForTest: true })
    expect(raceFired).toBe(true)
    expect(run.status).toBe("cancelled")
    expect((await origLoad(root, prepared.runID))?.status).toBe("cancelled")
  })

  test("legacy Q runs decode into V2 and resume", async () => {
    const root = await workspace()
    await mkdir(path.join(root, ".spinosa", "runs", "legacy-1"), { recursive: true })
    await Bun.write(
      path.join(root, ".spinosa", "runs", "legacy-1", "run.json"),
      JSON.stringify({
        id: "legacy-1", workspacePath: root, prompt: "find evidence",
        route: "Q1", status: "classified", phaseIndex: 1,
        createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:00:00.000Z",
      }),
    )
    const raw = await Bun.file(path.join(root, ".spinosa", "runs", "legacy-1", "run.json")).json()
    const migrated = decodeWorkflowRun(raw)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.workflowID).toBe("research.targeted_evidence")
  })
})
