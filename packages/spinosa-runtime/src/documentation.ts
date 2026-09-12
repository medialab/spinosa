// WP9 (foundation): serialize the registry into Markdown so
// workspace-template docs cannot drift from TypeScript again.
import type { WorkflowDefinition } from "./workflow"
import { BUILTIN_WORKFLOWS } from "./registry"

export function renderWorkflowTable(definitions: readonly WorkflowDefinition[] = BUILTIN_WORKFLOWS): string {
  const rows = definitions
    .filter((d) => d.id !== "corpus.maintenance")
    .map((d) => `| \`${d.id}\` | v${d.version} |`)
  return [
    "# Workflow Registry (generated — do not hand-edit)",
    "",
    "Source of truth: `packages/spinosa-runtime/src/workflows/`.",
    "",
    "| Workflow | Version |",
    "| -------- | ------- |",
    ...rows,
    "",
  ].join("\n")
}
