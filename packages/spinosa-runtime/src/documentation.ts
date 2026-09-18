// Serialize the registry into Markdown so workspace-template docs cannot
// drift from TypeScript again.
import type { WorkflowDefinition } from "./workflow"
import { BUILTIN_WORKFLOWS } from "./registry"
import { strategyFromWorkflowId, workflowLabel, workflowWant } from "./workflow-labels"

export function renderWorkflowTable(definitions: readonly WorkflowDefinition[] = BUILTIN_WORKFLOWS): string {
  const rows = definitions
    .filter((d) => d.id !== "corpus.maintenance")
    .map((d) => `| ${workflowWant(d.id)} | \`${strategyFromWorkflowId(d.id)}\` | ${workflowLabel(d.id)} (\`${d.id}\` v${d.version}) |`)
  return [
    "# How to pick a plan (generated — do not hand-edit)",
    "",
    "Source of truth: `packages/spinosa-runtime/src/workflows/`.",
    "",
    "Pass `strategy` as one short name. Copy it from `spinosa_route`.",
    "Do not write a sentence. Do not write a chain like `search -> write`.",
    "",
    "| If they want | strategy | Plan |",
    "| ------------- | -------- | ---- |",
    ...rows,
    "",
  ].join("\n")
}
