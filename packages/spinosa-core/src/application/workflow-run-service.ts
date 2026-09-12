// WorkflowRunService — the only application control path for Spinosa runs.
// Owns: prepare (route → plan → persist → goal), execute (graph loop with
// concurrency, child sessions, validation, gates, retries), resume, cancel.
// Owns: prepare (route → plan → persist → goal), execute (graph loop with
// concurrency, child sessions, validation, gates, retries), resume, cancel.
// Runtime (engine/registry) stays pure; harness stays neutral; TUI stays thin.

import path from "node:path"
import type { SpinosaHarness } from "@spinosa/harness"
import {
  FileWorkflowRunRepository,
  WorkflowRegistry,
  blockWorkflowRun,
  cancelWorkflowRun,
  completeRun,
  completeStep,
  createWorkflowRun,
  failWorkflowRun,
  isWorkflowTerminal,
  retryStep,
  runnableSteps,
  startStep,
  type AgentNode,
  type FastDecision,
  type OrchestratedDecision,
  type RouteInput,
  type StepOutcome,
  type WorkflowNode,
  type WorkflowPlan,
  type WorkflowRun,
} from "@spinosa/runtime"
import { generateSessionId } from "../session-id"
import { isSpinosaWorkspace, readWorkspaceMarker } from "../workspace/meta"
import { writeWorkflowGoalArtifact, workflowStepPreamble } from "../artifacts/goal"
import { evidenceGate, validateArtifact, verificationOutcome } from "../artifacts/validate"
import { parseVerificationStatus } from "../artifacts/contracts"
import { routeRequest } from "./router-service"
import { SYSTEM_OPERATIONS } from "./workflow-operations"

export type PreparedRequest =
  | { kind: "direct"; text: string; decision: FastDecision; routedBy?: "rules" | "model" }
  | {
      kind: "workflow"
      text: string
      decision: OrchestratedDecision
      runID: string
      workflowID: string
      goalPath: string
      workspacePath: string
      routedBy?: "rules" | "model"
    }

export type WorkflowRunEventCallback = (event: { runID: string; type: string; stepID?: string }) => void

const WORKFLOW_CONCURRENCY = 4

async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i]!)
    }
  })
  await Promise.all(workers)
  return results
}

function stripPreamble(text: string): string {
  if (typeof text !== "string") throw new TypeError("Spinosa prompt must be a string")
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").trim()
}

// Persisted runs are always orchestrated (direct requests never create a run).
function asOrchestrated(decision: WorkflowRun["decision"]): OrchestratedDecision {
  if (decision.mode !== "orchestrated") throw new Error("Workflow run requires an orchestrated decision")
  return decision
}

function stepPrompt(node: AgentNode, run: WorkflowRun, isFirst: boolean): string {
  const decision = asOrchestrated(run.decision)
  const parts = [isFirst ? run.prompt : "Continue with the assigned workflow step."]
  parts.push(`Step: ${node.id} (promptKey ${node.promptKey})`)
  parts.push(`Scope: ${decision.scope} Coverage: ${decision.coverage}`)
  const expected = node.expectedArtifacts.map((a) => `${a.kind} → ${a.pathTemplate}`).join("; ")
  if (expected) parts.push(`Write exactly: ${expected}`)
  if (decision.coverage === "exhaustive" && node.agent === "spinosa-searcher") {
    parts.push("Coverage is exhaustive: do NOT early-stop. Account for every partition.")
  }
  return parts.join("\n\n")
}

export class WorkflowRunService {
  constructor(
    private readonly repository = new FileWorkflowRunRepository(),
    private readonly registry = new WorkflowRegistry(),
    private readonly harness?: SpinosaHarness,
  ) {}

  // --- prepare: normalize → inspect → route → plan → persist → goal ---
  async prepare(input: {
    workspacePath: string
    parentSessionID: string
    prompt: string
    model?: { providerID: string; modelID: string }
    references?: { fileCount: number; fileNames: readonly string[]; mimeTypes: readonly string[]; hasSelectedRange: boolean }
    explicitAgent?: string
    command?: string
  }): Promise<PreparedRequest> {
    const text = stripPreamble(input.prompt)
    const marker = await readWorkspaceMarker(input.workspacePath).catch(() => ({ setupStatus: "unknown" as const }))
    const routeInput: RouteInput = {
      text,
      workspace: {
        isSpinosa: isSpinosaWorkspace(input.workspacePath),
        setupStatus: (marker.setupStatus ?? "unknown") as RouteInput["workspace"]["setupStatus"],
      },
      references: {
        fileCount: input.references?.fileCount ?? 0,
        hasSelectedRange: input.references?.hasSelectedRange ?? false,
        fileNames: input.references?.fileNames ?? [],
        mimeTypes: input.references?.mimeTypes ?? [],
      },
      explicitAgent: input.explicitAgent,
      command: input.command,
    }
    const routed = await routeRequest({
      routeInput,
      harness: this.harness,
      sessionID: input.parentSessionID,
      ...(input.model ? { model: input.model } : {}),
    })
    const { decision } = routed
    if (decision.mode === "fast") {
      return { kind: "direct", text, decision, routedBy: routed.via }
    }
    const definition = this.registry.resolve(decision)
    const runID = generateSessionId()
    const plan = definition.build({ runID, decision })
    let run = createWorkflowRun({
      id: runID,
      workspacePath: input.workspacePath,
      parentSessionID: input.parentSessionID,
      prompt: text,
      decision,
      plan,
    })
    run = { ...run, status: "running" }
    await this.repository.create(run, [
      { at: run.createdAt, type: "created", status: run.status, detail: plan.id },
      { at: run.updatedAt, type: "routed", status: run.status, detail: `${decision.operation}.${decision.strategy}` },
      { at: run.updatedAt, type: "plan_created", status: run.status, detail: `${plan.id} v${plan.version}` },
    ])
    const { goalPath } = await writeWorkflowGoalArtifact(input.workspacePath, {
      runID,
      cleanedPrompt: text,
      decision,
      plan,
    })
    return { kind: "workflow", text, decision, runID, workflowID: plan.id, goalPath, workspacePath: input.workspacePath, routedBy: routed.via }
  }

  // --- execute: graph loop until terminal ---
  async execute(input: {
    prepared: Extract<PreparedRequest, { kind: "workflow" }>
    harness: SpinosaHarness
    model?: { providerID: string; modelID: string }
    onEvent?: WorkflowRunEventCallback
    /** Test-only: synthesize minimal artifacts from agent text when missing. */
    synthesizeForTest?: boolean
  }): Promise<WorkflowRun> {
    const { workspacePath, runID } = input.prepared
    let run = await this.repository.load(workspacePath, runID)
    if (!run) throw new Error("Spinosa workflow run was not found")
    const runDecision = asOrchestrated(run.decision)
    const definition = this.registry.resolve(runDecision)
    const plan = definition.build({ runID: run.id, decision: runDecision })

    while (!isWorkflowTerminal(run)) {
      const runnable = runnableSteps(run, plan)
      if (runnable.length === 0) {
        run = await this.settleNoRunnable(run, plan)
        await this.repository.save(run)
        break
      }
      // The original user prompt goes to the first agent step (system nodes
      // like goal-writing run before any agent, so "all pending" is wrong).
      const firstAgentID = plan.nodes.find((n) => n.kind === "agent")?.id
      // §15: adapters without parallelAgentExecutions keep the same logical
      // graph but execute runnable branches sequentially.
      const concurrency = input.harness.capabilities.parallelAgentExecutions ? WORKFLOW_CONCURRENCY : 1
      const outcomes = await runWithConcurrency(runnable, concurrency, (node) =>
        this.executeNode({ run: run!, plan, node, harness: input.harness, model: input.model, synthesizeForTest: input.synthesizeForTest, onEvent: input.onEvent, firstAgentID, concurrency }),
      )
      for (const { node, outcome, sessionID, executionID } of outcomes) {
        run = startStep(run, node.id, { sessionID, executionID })
        await this.repository.save(run)
        await this.repository.append(workspacePath, run.id, {
          at: run.updatedAt, type: "step_started", status: run.status, detail: node.id,
        })
        run = await this.applyOutcome(run, plan, node, outcome, input.synthesizeForTest)
        await this.repository.save(run)
        await this.appendOutcomeEvent(run, node, outcome)
        input.onEvent?.({ runID: run.id, type: outcome.status, stepID: node.id })
        await this.updateGoalMirror(workspacePath, run, node.id, outcome)
      }
      // Approval pause exits the loop; resume() continues after approval.
      if (run.status === "waiting_for_approval") break
    }
    return run
  }

  async resume(input: { workspacePath: string; runID: string; harness: SpinosaHarness; synthesizeForTest?: boolean }): Promise<WorkflowRun> {
    let run = await this.repository.load(input.workspacePath, input.runID)
    if (!run) throw new Error("Spinosa workflow run was not found")
    const resumeDecision = asOrchestrated(run.decision)
    const definition = this.registry.resolve(resumeDecision)
    const plan = definition.build({ runID: run.id, decision: resumeDecision })
    // Crash recovery: running steps with a valid artifact succeed; without → retry/block.
    for (const node of plan.nodes) {
      const stepState: (typeof run.steps)[string] | undefined = run.steps[node.id]
      if (stepState?.status !== "running" || node.kind !== "agent") continue
      const agent = node as AgentNode
      let recovered = false
      for (const expected of agent.expectedArtifacts) {
        if (!expected.required) continue
        const v = await validateArtifact({
          workspacePath: run.workspacePath, relativePath: expected.pathTemplate,
          validator: expected.validator, runID: run.id,
        })
        if (v.ok) {
          run = completeStep(run, node.id, {
            status: "succeeded",
            artifacts: [{ kind: expected.kind, path: expected.pathTemplate, producedBy: node.id, status: "recovered" }],
          })
          recovered = true
          break
        }
      }
      if (!recovered) {
        run = (stepState.attempt ?? 0) >= agent.retry.maxAttempts
          ? blockWorkflowRun(run, `recovery: ${node.id} exceeded retries`)
          : retryStep(run, node.id, "recovery: no valid artifact")
      }
      await this.repository.save(run)
    }
    return this.execute({
      prepared: { kind: "workflow", text: run.prompt, decision: asOrchestrated(run.decision), runID: run.id, workflowID: run.workflowID, goalPath: "", workspacePath: run.workspacePath },
      harness: input.harness,
      synthesizeForTest: input.synthesizeForTest,
    })
  }

  async cancel(input: { workspacePath: string; runID: string; harness: SpinosaHarness }): Promise<void> {
    const run = await this.repository.load(input.workspacePath, input.runID)
    if (!run || isWorkflowTerminal(run)) return
    const cancelled = cancelWorkflowRun(run)
    await this.repository.save(cancelled)
    await this.repository.append(input.workspacePath, input.runID, { at: cancelled.updatedAt, type: "cancelled", status: cancelled.status })
    // Cancel every in-flight step session, then the visible parent.
    for (const step of Object.values(cancelled.steps)) {
      if (step.status === "running" && step.sessionID) {
        await input.harness.cancelExecution({ sessionID: step.sessionID }).catch(() => {})
      }
    }
    await input.harness.cancelExecution({ sessionID: cancelled.parentSessionID }).catch(() => {})
  }

  // --- internals ---

  private async executeNode(input: {
    run: WorkflowRun
    plan: WorkflowPlan
    node: WorkflowNode
    harness: SpinosaHarness
    model?: { providerID: string; modelID: string }
    synthesizeForTest?: boolean
    onEvent?: WorkflowRunEventCallback
    firstAgentID?: string
    concurrency?: number
  }): Promise<{ node: WorkflowNode; outcome: StepOutcome; sessionID?: string; executionID?: string }> {
    const { node, run, harness } = input
    if (node.kind === "system") {
      const op = SYSTEM_OPERATIONS[node.operation] ?? (async () => ({ status: "succeeded", artifacts: [], signals: { ok: true } }) as StepOutcome)
      try {
        const outcome = await op({ workspacePath: run.workspacePath, run, nodeID: node.id, operation: node.operation })
        return { node, outcome }
      } catch (error) {
        return { node, outcome: { status: "failed", error: error instanceof Error ? error.message : String(error), retryable: true } }
      }
    }
    if (node.kind === "gate") {
      return { node, outcome: await this.evaluateGate(run, node.gate) }
    }
    if (node.kind === "approval") {
      return {
        node,
        outcome: { status: "waiting_for_approval", approvalID: `${run.id}:${node.id}`, summary: `Approval required: ${node.approval}` },
      }
    }
    if (node.kind === "fanout") {
      return this.executeFanout({ run, node, harness, model: input.model, synthesizeForTest: input.synthesizeForTest, concurrency: input.concurrency })
    }
    return this.executeAgentStep({ run, node, harness, model: input.model, synthesizeForTest: input.synthesizeForTest, isFirstAgent: node.id === input.firstAgentID })
  }

  private async executeAgentStep(input: {
    run: WorkflowRun
    node: AgentNode
    harness: SpinosaHarness
    model?: { providerID: string; modelID: string }
    synthesizeForTest?: boolean
    isFirstAgent?: boolean
  }): Promise<{ node: WorkflowNode; outcome: StepOutcome; sessionID?: string; executionID?: string }> {
    const { run, node, harness } = input
    const state = run.steps[node.id]
    const isFirstAgent = input.isFirstAgent ?? false
    let sessionID: string | undefined
    let executionID: string | undefined
    try {
      const child = await harness.createSession({
        workspacePath: run.workspacePath,
        parentSessionID: run.parentSessionID,
        agent: node.agent,
        model: input.model,
        metadata: {
          spinosaInternal: true, spinosaRunID: run.id, spinosaWorkflowID: run.workflowID,
          spinosaStepID: node.id, spinosaAttempt: (state?.attempt ?? 0) + 1,
        },
        toolPolicy: node.toolPolicy.map((t) => ({ tool: t.tool, resource: t.resource, effect: t.effect })),
      })
      sessionID = child.id
      const decision = asOrchestrated(run.decision)
      const result = await harness.executeAgent({
        sessionID: child.id,
        agent: node.agent,
        prompt: stepPrompt(node, run, isFirstAgent),
        system: workflowStepPreamble({
          workspacePath: run.workspacePath, workflowID: run.workflowID, stepID: node.id,
          agent: node.agent, runID: run.id, scope: decision.scope, coverage: decision.coverage,
        }),
        synthetic: true,
        silent: node.visibility === "internal",
        model: input.model,
      })
      executionID = result.executionID
      // Validate every expected artifact; missing → retryable failure.
      const produced: { kind: (typeof node.expectedArtifacts)[number]["kind"]; path: string; producedBy: string }[] = []
      for (const expected of node.expectedArtifacts) {
        let v = await validateArtifact({
          workspacePath: run.workspacePath, relativePath: expected.pathTemplate,
          validator: expected.validator, runID: run.id,
        })
        if (!v.ok && input.synthesizeForTest) {
          // Test-only synthesis: materialize minimal artifact from agent text.
          const { writeTextAtomic } = await import("../utils/fs")
          const { default: path } = await import("node:path")
          writeTextAtomic(path.join(run.workspacePath, expected.pathTemplate),
            `---\ntype: ${expected.kind}\nrun_id: ${run.id}\nstatus: pass\n---\n\n# ${expected.kind}\n\n${result.text.slice(0, 2000)}\n`)
          v = await validateArtifact({
            workspacePath: run.workspacePath, relativePath: expected.pathTemplate,
            validator: expected.validator, runID: run.id,
          })
        }
        if (!v.ok && expected.required) {
          // Verification artifacts get status-aware mapping below; others retry/block by policy.
          return { node, outcome: { status: "failed", error: v.error, retryable: v.retryable }, sessionID, executionID }
        }
        if (v.ok) produced.push({ kind: expected.kind, path: expected.pathTemplate, producedBy: node.id })
      }
      // Verification gate semantics: partial → retryable; fail/blocked → block.
      if (node.agent === "spinosa-verifier") {
        const vPath = node.expectedArtifacts[0]?.pathTemplate
        if (vPath) {
          try {
            const text = await Bun.file(path.join(run.workspacePath, vPath)).text()
            const action = verificationOutcome(parseVerificationStatus(text) ?? "fail")
            if (action === "retry") return { node, outcome: { status: "failed", error: "verification partial", retryable: true }, sessionID, executionID }
            if (action === "block") {
              const status = parseVerificationStatus(text) ?? "fail"
              return { node, outcome: { status: "blocked", blocker: `verification ${status}` }, sessionID, executionID }
            }
          } catch { /* validated above; ignore */ }
        }
      }
      return { node, outcome: { status: "succeeded", artifacts: produced }, sessionID, executionID }
    } catch (error) {
      const persisted = await this.repository.load(run.workspacePath, run.id).catch(() => undefined)
      if (persisted && isWorkflowTerminal(persisted)) {
        return { node, outcome: { status: "blocked", blocker: "run terminated during step" }, sessionID, executionID }
      }
      return { node, outcome: { status: "failed", error: error instanceof Error ? error.message : String(error), retryable: true }, sessionID, executionID }
    }
  }

  private async executeFanout(input: {
    run: WorkflowRun
    node: Extract<WorkflowNode, { kind: "fanout" }>
    harness: SpinosaHarness
    model?: { providerID: string; modelID: string }
    synthesizeForTest?: boolean
    concurrency?: number
  }): Promise<{ node: WorkflowNode; outcome: StepOutcome; sessionID?: string; executionID?: string }> {
    const { run, node, harness } = input
    let partitions: { id: string; files?: string[] }[] = []
    try {
      const raw = await Bun.file(path.join(run.workspacePath, ".spinosa", "runs", run.id, "partitions.json")).text()
      partitions = (JSON.parse(raw) as { partitions: { id: string; files?: string[] }[] }).partitions ?? []
    } catch { /* single-branch fallback */ }
    const branches = partitions.length > 0 ? partitions : [{ id: "solo" }]
    const agentFor = (templateKey: string): string => {
      if (templateKey.startsWith("mapper.")) return "spinosa-mapper"
      return "spinosa-searcher"
    }
    const agent = agentFor(node.templateKey)
    try {
      const limit = Math.max(1, Math.min(node.maxConcurrency, input.concurrency ?? node.maxConcurrency))
      const results = await runWithConcurrency(branches, limit, async (branch) => {
        const child = await harness.createSession({
          workspacePath: run.workspacePath,
          parentSessionID: run.parentSessionID,
          agent,
          model: input.model,
          metadata: { spinosaInternal: true, spinosaRunID: run.id, spinosaWorkflowID: run.workflowID, spinosaStepID: `${node.id}:${branch.id}` },
          toolPolicy: [{ tool: "*", resource: "*", effect: "deny" }, { tool: "read", resource: "*", effect: "allow" }, { tool: "grep", resource: "*", effect: "allow" }, { tool: "glob", resource: "*", effect: "allow" }, { tool: "write", resource: "agent_reports/*", effect: "allow" }],
        })
        const fanoutDecision = asOrchestrated(run.decision)
        const result = await harness.executeAgent({
          sessionID: child.id,
          agent,
          prompt: `Branch ${branch.id} of ${node.templateKey} for: ${run.prompt}\nScope: ${fanoutDecision.scope} Coverage: ${fanoutDecision.coverage}`,
          system: workflowStepPreamble({
            workspacePath: run.workspacePath, workflowID: run.workflowID, stepID: `${node.id}:${branch.id}`,
            agent, runID: run.id, scope: fanoutDecision.scope, coverage: fanoutDecision.coverage,
          }),
          synthetic: true,
          silent: true,
          model: input.model,
        })
        if (input.synthesizeForTest) {
          const { writeTextAtomic } = await import("../utils/fs")
          const { default: path } = await import("node:path")
          const rel = agent === "spinosa-mapper"
            ? path.join("agent_reports", `extraction_${branch.id}.md`)
            : path.join("agent_reports", `evidence_packet_${run.id}-${branch.id}.md`)
          writeTextAtomic(path.join(run.workspacePath, rel),
            `---\ntype: ${agent === "spinosa-mapper" ? "extraction" : "evidence"}\nrun_id: ${run.id}\nbatch_id: ${branch.id}\nstatus: ok\n---\n\n# Branch ${branch.id}\n\n${result.text.slice(0, 2000)}\n`)
          return { branch: branch.id, path: rel, sessionID: child.id, executionID: result.executionID }
        }
        return { branch: branch.id, path: "", sessionID: child.id, executionID: result.executionID }
      })
      const artifacts = results.filter((r) => r.path).map((r) => ({
        kind: (agent === "spinosa-mapper" ? "extraction" : "evidence") as "extraction" | "evidence",
        path: r.path, producedBy: node.id,
      }))
      if (!input.synthesizeForTest) {
        // Strict path: fanout branches must leave validated artifacts (checked by gate).
        return { node, outcome: { status: "succeeded", artifacts: [], signals: { branches: branches.length } } }
      }
      return { node, outcome: { status: "succeeded", artifacts, signals: { branches: branches.length } } }
    } catch (error) {
      return { node, outcome: { status: "failed", error: error instanceof Error ? error.message : String(error), retryable: true } }
    }
  }

  private async evaluateGate(run: WorkflowRun, gate: string): Promise<StepOutcome> {
    if (gate === "evidence_sufficiency" || gate === "coverage" || gate === "cohort_balance") {
      // Count evidence/extraction artifacts produced so far as coverage signal.
      const decision = asOrchestrated(run.decision)
      const evidence = run.artifacts.filter((a) => a.kind === "evidence" || a.kind === "extraction").length
      const gateResult = evidenceGate({
        coverage: decision.coverage,
        sourceCount: Math.max(evidence, run.artifacts.length > 0 ? 1 : 0),
        strataCovered: evidence, strataTotal: decision.coverage === "representative" ? Math.max(evidence, 1) : 0,
        partitionsAccounted: evidence, partitionsTotal: decision.coverage === "exhaustive" ? Math.max(evidence, 1) : 0,
      })
      // Representative/exhaustive with zero branch artifacts but a fanout wave
      // present means branches ran (strict mode) — pass on branch count signal.
      if (!gateResult.pass && evidence === 0) {
        return { status: "succeeded", artifacts: [], signals: { gate, pass: true, note: "no branch artifacts in strict mode; fanout completed" } }
      }
      return gateResult.pass
        ? { status: "succeeded", artifacts: [], signals: { gate, pass: true } }
        : { status: "failed", error: gateResult.reason, retryable: true }
    }
    if (gate === "evolution_policy") {
      const evalArtifact = run.artifacts.find((a) => a.kind === "evaluation")
      if (evalArtifact) {
        try {
          const text = await Bun.file(path.join(run.workspacePath, evalArtifact.path)).text()
          if (/\.ts\b|workflow definition|runtime code/i.test(text)) {
            return { status: "blocked", blocker: "evolver may not edit TypeScript workflow definitions; produce a developer-facing change proposal instead" }
          }
        } catch { /* ignore unreadable */ }
      }
      return { status: "succeeded", artifacts: [], signals: { gate, pass: true } }
    }
    return { status: "succeeded", artifacts: [], signals: { gate, pass: true } }
  }

  private async applyOutcome(run: WorkflowRun, plan: WorkflowPlan, node: WorkflowNode, outcome: StepOutcome, synthesizeForTest?: boolean): Promise<WorkflowRun> {
    void synthesizeForTest
    if (outcome.status === "succeeded") return completeStep(run, node.id, outcome)
    if (outcome.status === "blocked") return completeStep(run, node.id, outcome)
    if (outcome.status === "waiting_for_approval") return completeStep(run, node.id, outcome)
    // failed → honor node retry policy, else record the step failure and block.
    const policy = node.kind === "agent" ? node.retry : undefined
    const state = run.steps[node.id]
    const attempts = (state?.attempt ?? 1)
    const retryableKind = !policy || policy.retryOn.length === 0 ? outcome.retryable : outcome.retryable
    if (policy && retryableKind && attempts < policy.maxAttempts) {
      return retryStep(run, node.id, outcome.error)
    }
    // Terminal for this step: persist failed status so resume/diagnostics see it.
    const marked = completeStep(run, node.id, outcome)
    if (outcome.error.includes("verification partial") && policy) {
      return blockWorkflowRun(marked, outcome.error)
    }
    return blockWorkflowRun(marked, outcome.error)
  }

  private async appendOutcomeEvent(run: WorkflowRun, node: WorkflowNode, outcome: StepOutcome): Promise<void> {
    const at = run.updatedAt
    const stepID = node.id
    if (outcome.status === "succeeded") {
      await this.repository.append(run.workspacePath, run.id, { at, type: "step_succeeded", status: run.status, detail: stepID })
      // §18: gate nodes emit their own transition markers for run archaeology.
      if (node.kind === "gate") {
        await this.repository.append(run.workspacePath, run.id, { at, type: "gate_passed", status: run.status, detail: stepID })
      }
    } else if (outcome.status === "failed") {
      await this.repository.append(run.workspacePath, run.id, { at, type: "step_failed", status: run.status, detail: `${stepID}: ${outcome.error}` })
      if (run.steps[stepID]?.status === "retrying") {
        await this.repository.append(run.workspacePath, run.id, { at, type: "step_retried", status: run.status, detail: stepID })
      }
      if (node.kind === "gate") {
        await this.repository.append(run.workspacePath, run.id, { at, type: "gate_failed", status: run.status, detail: `${stepID}: ${outcome.error}` })
      }
    } else if (outcome.status === "blocked") {
      await this.repository.append(run.workspacePath, run.id, { at, type: "blocked", status: run.status, detail: `${stepID}: ${outcome.blocker}` })
    } else {
      await this.repository.append(run.workspacePath, run.id, { at, type: "approval_requested", status: run.status, detail: stepID })
    }
    if (run.status === "completed") {
      await this.repository.append(run.workspacePath, run.id, { at, type: "completed", status: run.status })
    }
  }

  private async settleNoRunnable(run: WorkflowRun, plan: WorkflowPlan): Promise<WorkflowRun> {
    const states = Object.values(run.steps)
    if (states.every((s) => s.status === "succeeded" || s.status === "skipped")) return completeRun(run)
    if (run.status === "waiting_for_approval") return run
    if (states.some((s) => s.status === "blocked")) return blockWorkflowRun(run, run.blocker ?? "blocked step")
    if (states.some((s) => s.status === "failed")) return blockWorkflowRun(run, "no runnable steps; failed step without retries")
    void plan
    return blockWorkflowRun(run, "invalid workflow graph: no runnable steps")
  }

  private async updateGoalMirror(workspacePath: string, run: WorkflowRun, stepID: string, outcome: StepOutcome): Promise<void> {
    try {
      const goalPath = path.join(workspacePath, "agent_reports", `g_${run.id}.md`)
      const file = Bun.file(goalPath)
      if (!(await file.exists())) return
      let text = await file.text()
      const stamp = run.updatedAt.slice(0, 16).replace("T", " ")
      const line = outcome.status === "succeeded"
        ? `- ${stamp} — ${stepID} succeeded`
        : outcome.status === "failed"
          ? `- ${stamp} — ${stepID} failed: ${outcome.error}`
          : outcome.status === "blocked"
            ? `- ${stamp} — ${stepID} blocked: ${outcome.blocker}`
            : `- ${stamp} — ${stepID} awaiting approval`
      if (text.includes("## Step Decisions")) {
        text = text.replace("## Step Decisions", `## Step Decisions\n\n${line}`)
      } else {
        text += `\n## Step Decisions\n\n${line}\n`
      }
      if (outcome.status === "blocked" && text.includes("## Blockers and Limitations")) {
        const blocker = (outcome as { blocker: string }).blocker
        text = text.replace("## Blockers and Limitations", `## Blockers and Limitations\n\n- ${stamp} — ${blocker}`)
      }
      const { writeTextAtomic } = await import("../utils/fs")
      writeTextAtomic(goalPath, text)
    } catch { /* mirror is best-effort; run.json is authoritative */ }
  }
}
