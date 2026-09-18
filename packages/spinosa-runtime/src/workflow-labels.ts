// Plain-language names for built-in plans. Agents and the TUI use these
// instead of dotted workflow ids.

export type WorkflowCopy = {
  /** Short badge / tool title. */
  label: string
  /** "If they want…" column in classification.md */
  want: string
}

export const WORKFLOW_COPY: Record<string, WorkflowCopy> = {
  "research.targeted_evidence": {
    label: "Find evidence",
    want: "Quotes and sources for one question",
  },
  "research.contextual_synthesis": {
    label: "Put it in context",
    want: "A synthesis or cohort reading",
  },
  "research.corpus_census": {
    label: "Count across the corpus",
    want: "A complete count or census",
  },
  "research.comparative_synthesis": {
    label: "Compare sources",
    want: "A comparison across sources",
  },
  "research.hypothesis_test": {
    label: "Test a hypothesis",
    want: "To test a claim against the corpus",
  },
  "research.exploratory_discovery": {
    label: "Look for hidden connections",
    want: "Patterns nobody asked for by name",
  },
  "corpus.startup_index": {
    label: "Index the workspace",
    want: "First-time indexing",
  },
  "corpus.add_sources": {
    label: "Add sources",
    want: "To bring in new files",
  },
  "corpus.maintenance": {
    label: "Maintain the corpus",
    want: "Corpus upkeep",
  },
  "maintenance.cleanup_proposal": {
    label: "Propose cleanup",
    want: "A cleanup proposal",
  },
  "maintenance.cleanup_apply": {
    label: "Apply cleanup",
    want: "To apply an approved cleanup",
  },
  "meta.coverage_audit": {
    label: "Check coverage",
    want: "A coverage check",
  },
  "meta.framework_evolution": {
    label: "Update the framework",
    want: "A tightly scoped framework edit",
  },
}

export function workflowLabel(id: string): string {
  return WORKFLOW_COPY[id]?.label ?? id.replace(/[._]/g, " ")
}

export function workflowWant(id: string): string {
  return WORKFLOW_COPY[id]?.want ?? workflowLabel(id)
}

export function strategyFromWorkflowId(id: string): string {
  const dot = id.indexOf(".")
  return dot === -1 ? id : id.slice(dot + 1)
}

export function strategiesForOperation(operation: string, ids: readonly string[]): string[] {
  const prefix = `${operation}.`
  return ids.filter((id) => id.startsWith(prefix)).map(strategyFromWorkflowId)
}

export function formatUnknownWorkflow(input: { operation: string; strategy: string; knownIds: readonly string[] }): string {
  const options = strategiesForOperation(input.operation, input.knownIds)
  if (options.length === 0) {
    return `No plan matches ${input.operation} + ${input.strategy}. Copy strategy from spinosa_route.`
  }
  return `That is not a ${input.operation} plan. Use one of: ${options.join(", ")}.`
}
