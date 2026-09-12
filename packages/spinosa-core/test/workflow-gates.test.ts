// §25 core gaps: validators, gate semantics, partitioning, startup gate.
import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { evidenceGate, validateArtifact, verificationOutcome } from "../src/artifacts/validate"
import { parseVerificationStatus } from "../src/artifacts/contracts"
import { SYSTEM_OPERATIONS } from "../src/application/workflow-operations"
import { buildWorkflowGoalBody } from "../src/artifacts/goal"
import { parseGoalArtifact } from "../src/artifacts/parser"
import type { WorkflowRun } from "@spinosa/runtime"

async function workspace(): Promise<string> {
  const root = path.join(tmpdir(), "spinosa-gates-" + crypto.randomUUID())
  await mkdir(path.join(root, ".spinosa", "runs", "r1"), { recursive: true })
  await mkdir(path.join(root, "agent_reports"), { recursive: true })
  await mkdir(path.join(root, "raw"), { recursive: true })
  await Bun.write(path.join(root, "AGENTS.md"), "# ws\n")
  await Bun.write(path.join(root, "system/configuration.md"), "setup_status: cli_started\n")
  return root
}

function fakeRun(workspacePath: string): WorkflowRun {
  return {
    schemaVersion: 2, id: "r1", workspacePath, parentSessionID: "p", prompt: "x",
    decision: {
      mode: "orchestrated", operation: "research", strategy: "targeted_evidence",
      scope: "subset", coverage: "sufficient", outputs: ["report"],
      mutation: "none", verification: "normal", evaluation: "always",
      reason: "test", confidence: 1,
    },
    workflowID: "research.targeted_evidence", workflowVersion: 1,
    status: "running", steps: {}, artifacts: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
}

describe("artifact validation", () => {
  test("rejects paths escaping the workspace", async () => {
    const root = await workspace()
    const result = await validateArtifact({
      workspacePath: root, relativePath: "../outside.md", validator: "report", runID: "r1",
    })
    expect(result.ok).toBe(false)
  })

  test("missing required artifacts are retryable", async () => {
    const root = await workspace()
    const result = await validateArtifact({
      workspacePath: root, relativePath: "agent_reports/evidence_packet_r1.md",
      validator: "evidence_packet", runID: "r1",
    })
    expect(result).toMatchObject({ ok: false, retryable: true })
  })

  test("verification statuses map to engine actions", () => {
    expect(parseVerificationStatus("verification_status: pass")).toBe("pass")
    expect(parseVerificationStatus("status: pass_with_corrections")).toBe("pass_with_corrections")
    expect(verificationOutcome("pass")).toBe("complete")
    expect(verificationOutcome("pass_with_corrections")).toBe("complete")
    expect(verificationOutcome("partial")).toBe("retry")
    expect(verificationOutcome("fail")).toBe("block")
    expect(verificationOutcome("blocked")).toBe("block")
  })

  test("evidence gates grade by coverage contract", () => {
    expect(evidenceGate({ coverage: "opportunistic", sourceCount: 1, strataCovered: 0, strataTotal: 0, partitionsAccounted: 0, partitionsTotal: 0 }).pass).toBe(true)
    expect(evidenceGate({ coverage: "opportunistic", sourceCount: 0, strataCovered: 0, strataTotal: 0, partitionsAccounted: 0, partitionsTotal: 0 }).pass).toBe(false)
    expect(evidenceGate({ coverage: "representative", sourceCount: 2, strataCovered: 1, strataTotal: 2, partitionsAccounted: 0, partitionsTotal: 0 }).pass).toBe(false)
    expect(evidenceGate({ coverage: "representative", sourceCount: 2, strataCovered: 2, strataTotal: 2, partitionsAccounted: 0, partitionsTotal: 0 }).pass).toBe(true)
    // Sufficient search must never satisfy an exhaustive claim.
    expect(evidenceGate({ coverage: "exhaustive", sourceCount: 5, strataCovered: 0, strataTotal: 0, partitionsAccounted: 2, partitionsTotal: 5 }).pass).toBe(false)
  })
})

describe("goal V2 round-trip", () => {
  test("V2 goals carry workflow identity and parse back with phases intact", async () => {
    const { defaultRegistry } = await import("@spinosa/runtime")
    const decision = fakeRun("/tmp").decision
    if (decision.mode !== "orchestrated") throw new Error("fixture")
    const plan = defaultRegistry.resolve(decision).build({ runID: "r1", decision })
    const body = buildWorkflowGoalBody({
      runID: "r1", cleanedPrompt: "compare cohorts", decision, plan, goalPath: "agent_reports/g_r1.md",
    })
    expect(body).toContain("workflow_id: research.targeted_evidence")
    const summary = parseGoalArtifact(body, "agent_reports/g_r1.md")
    expect(summary.workflowID).toBe("research.targeted_evidence")
    expect(summary.operation).toBe("research")
    expect(Array.isArray(summary.phases)).toBe(true)
  })
})

describe("system operations", () => {
  test("partition batches raw files and records a manifest", async () => {
    const root = await workspace()
    for (let i = 0; i < 30; i++) {
      await Bun.write(path.join(root, "raw", `doc-${i}.md`), "# doc\n")
    }
    const run = fakeRun(root)
    const outcome = await SYSTEM_OPERATIONS["corpus.partition"]!({
      workspacePath: root, run, nodeID: "partition", operation: "corpus.partition",
    })
    expect(outcome.status).toBe("succeeded")
    const manifest = await Bun.file(path.join(root, ".spinosa", "runs", "r1", "partitions.json")).json() as { partitions: unknown[] }
    expect(manifest.partitions.length).toBe(2) // 25 + 5
  })

  test("workspace validation blocks on missing structure", async () => {
    const root = await workspace()
    const run = fakeRun(root)
    const ok = await SYSTEM_OPERATIONS["workspace.validate"]!({
      workspacePath: root, run, nodeID: "validate", operation: "workspace.validate",
    })
    expect(ok.status).toBe("succeeded")
    const bad = await SYSTEM_OPERATIONS["workspace.validate"]!({
      workspacePath: path.join(tmpdir(), "spinosa-gates-missing-" + crypto.randomUUID()),
      run, nodeID: "validate", operation: "workspace.validate",
    })
    expect(bad.status).toBe("blocked")
  })

  test("startup gate commits workspace_started", async () => {
    const root = await workspace()
    const run = fakeRun(root)
    const outcome = await SYSTEM_OPERATIONS["workspace.commit_started"]!({
      workspacePath: root, run, nodeID: "commit-started", operation: "workspace.commit_started",
    })
    expect(outcome.status).toBe("succeeded")
    const config = await Bun.file(path.join(root, "system/configuration.md")).text()
    expect(config).toContain("setup_status: workspace_started")
  })
})
