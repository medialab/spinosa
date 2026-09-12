// WP5 (early foundation for WP2): machine-readable capability boundaries.
// Markdown files remain canonical for cognitive behavior; this file enforces
// tooling boundaries. Rule: agents emit outcomes, WorkflowEngine interprets.

import type { ArtifactRef } from "./model"
import type { ToolRule } from "./workflow"

export type AgentContract = {
  id: string
  capability: string
  acceptedInputs: readonly string[]
  outputs: readonly ArtifactRef["kind"][]
  defaultToolPolicy: readonly ToolRule[]
}

const READ_ONLY: readonly ToolRule[] = [
  { tool: "*", resource: "*", effect: "deny" },
  { tool: "read", resource: "*", effect: "allow" },
  { tool: "grep", resource: "*", effect: "allow" },
  { tool: "glob", resource: "*", effect: "allow" },
  { tool: "write", resource: "agent_reports/*", effect: "allow" },
]

export const AGENT_CONTRACTS: Record<string, AgentContract> = {
  "spinosa-searcher": {
    id: "spinosa-searcher",
    capability: "evidence.retrieve",
    acceptedInputs: ["goal", "scope", "coverage", "artifact_paths"],
    outputs: ["evidence"],
    defaultToolPolicy: READ_ONLY,
  },
  "spinosa-analyst": {
    id: "spinosa-analyst",
    capability: "evidence.synthesize",
    acceptedInputs: ["goal", "evidence_paths", "objective"],
    outputs: ["analysis"],
    defaultToolPolicy: READ_ONLY,
  },
  "spinosa-serendippo": {
    id: "spinosa-serendippo",
    capability: "discovery.roam",
    acceptedInputs: ["goal", "exploration_scope", "theme", "budget"],
    outputs: ["serendipity"],
    defaultToolPolicy: READ_ONLY,
  },
  "spinosa-writer": {
    id: "spinosa-writer",
    capability: "report.compose",
    acceptedInputs: ["goal", "validated_inputs"],
    outputs: ["report", "visualization"],
    defaultToolPolicy: READ_ONLY,
  },
  "spinosa-verifier": {
    id: "spinosa-verifier",
    capability: "artifact.verify",
    acceptedInputs: ["target_artifact", "source_policy"],
    outputs: ["verification"],
    defaultToolPolicy: READ_ONLY,
  },
  "spinosa-mapper": {
    id: "spinosa-mapper",
    capability: "corpus.map",
    acceptedInputs: ["file_partition", "mapping_operation"],
    outputs: ["extraction", "map"],
    defaultToolPolicy: [
      { tool: "*", resource: "*", effect: "deny" },
      { tool: "read", resource: "*", effect: "allow" },
      { tool: "glob", resource: "*", effect: "allow" },
      { tool: "grep", resource: "*", effect: "allow" },
      { tool: "write", resource: "agent_reports/*", effect: "allow" },
      { tool: "write", resource: "maps/*", effect: "allow" },
      { tool: "write", resource: "system/*", effect: "allow" },
    ],
  },
  "spinosa-janitor": {
    id: "spinosa-janitor",
    capability: "workspace.audit",
    acceptedInputs: ["audit_scope", "approved_proposal"],
    outputs: ["coverage"],
    defaultToolPolicy: READ_ONLY,
  },
  "spinosa-overseer": {
    id: "spinosa-overseer",
    capability: "coverage.audit",
    acceptedInputs: ["coverage_period", "workspace_inventory"],
    outputs: ["coverage"],
    defaultToolPolicy: READ_ONLY,
  },
  "spinosa-evaluator": {
    id: "spinosa-evaluator",
    capability: "process.audit",
    acceptedInputs: ["workflow_trace"],
    outputs: ["evaluation"],
    defaultToolPolicy: READ_ONLY,
  },
  "spinosa-evolver": {
    id: "spinosa-evolver",
    capability: "policy.evolve",
    acceptedInputs: ["approved_recommendation"],
    outputs: ["evaluation"],
    defaultToolPolicy: READ_ONLY,
  },
  "spinosa-router": {
    id: "spinosa-router",
    capability: "request.route",
    acceptedInputs: ["prompt", "workspace_status", "references"],
    outputs: [],
    defaultToolPolicy: [{ tool: "*", resource: "*", effect: "deny" }],
  },
}

export function contractForAgent(agent: string): AgentContract | undefined {
  return AGENT_CONTRACTS[agent]
}
