// WP1: Workflow grammar — data only, serializable, inspectable.
// Prompt construction, system operations, and validators live in registries
// keyed by promptKey / operation / validator (see spinosa-core).

import type { ArtifactRef } from "./model"

export type ToolRule = {
  tool: string
  resource: string
  effect: "allow" | "ask" | "deny"
}

export type RetryPolicy = {
  maxAttempts: number
  retryOn: readonly ("missing_artifact" | "invalid_artifact" | "temporary_error" | "verification_partial")[]
}

export type ArtifactExpectation = {
  kind: ArtifactRef["kind"]
  pathTemplate: string
  required: boolean
  validator: string
}

export type AgentNode = {
  kind: "agent"
  id: string
  agent: string
  dependsOn: readonly string[]
  visibility: "internal" | "user"
  promptKey: string
  toolPolicy: readonly ToolRule[]
  expectedArtifacts: readonly ArtifactExpectation[]
  retry: RetryPolicy
  timeoutMs?: number
}

export type SystemNode = {
  kind: "system"
  id: string
  operation: string
  dependsOn: readonly string[]
}

export type GateNode = {
  kind: "gate"
  id: string
  gate: string
  dependsOn: readonly string[]
}

export type ApprovalNode = {
  kind: "approval"
  id: string
  approval: string
  dependsOn: readonly string[]
}

export type FanoutNode = {
  kind: "fanout"
  id: string
  sourceStep: string
  templateKey: string
  dependsOn: readonly string[]
  maxConcurrency: number
}

export type WorkflowNode = AgentNode | SystemNode | GateNode | ApprovalNode | FanoutNode

export type WorkflowPlan = {
  id: string
  version: number
  nodes: readonly WorkflowNode[]
}

export type WorkflowDefinition = {
  id: string
  version: number
  matches(decision: import("./routing").OrchestratedDecision): boolean
  build(input: { runID: string; decision: import("./routing").OrchestratedDecision }): WorkflowPlan
}

/** Render an expected artifact path from a template (supports {runID}). */
export function renderPathTemplate(template: string, runID: string): string {
  return template.replaceAll("{runID}", runID)
}
