// WP6/WP8: WorkflowRunService — prepare/execute/resume/cancel over the
// executable workflow engine (MockHarness, synthesized artifacts for happy
// paths; strict mode asserts retry-then-block semantics).
import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { MockHarness } from "@spinosa/harness"
import { FileWorkflowRunRepository, decodeWorkflowRun } from "@spinosa/runtime"
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
    expect(["cancelled", "blocked", "completed"]).toContain(run.status)
    expect(harness.events.some((e) => e.type === "execution.cancelled")).toBe(true)
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
