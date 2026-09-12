// WP2: WorkflowRegistry — resolves intent dimensions to a known workflow.
// The router returns intent (operation/strategy); never arbitrary workflow
// IDs or agent names. Unknown combinations throw (caller falls back).
import type { OrchestratedDecision } from "./routing"
import type { WorkflowDefinition } from "./workflow"
import { researchTargeted } from "./workflows/research-targeted"
import { researchContextual } from "./workflows/research-contextual"
import { researchCensus } from "./workflows/research-census"
import { researchComparative } from "./workflows/research-comparative"
import { researchHypothesis } from "./workflows/research-hypothesis"
import { researchExploratory } from "./workflows/research-exploratory"
import { corpusStartup } from "./workflows/corpus-startup"
import { corpusAdd } from "./workflows/corpus-add"
import { corpusMaintenance } from "./workflows/corpus-maintenance"
import { maintenanceApply, maintenanceProposal } from "./workflows/maintenance"
import { metaCoverage, metaEvolution } from "./workflows/meta"

export const BUILTIN_WORKFLOWS: readonly WorkflowDefinition[] = [
  researchTargeted,
  researchContextual,
  researchCensus,
  researchComparative,
  researchHypothesis,
  researchExploratory,
  corpusStartup,
  corpusAdd,
  corpusMaintenance,
  maintenanceProposal,
  maintenanceApply,
  metaCoverage,
  metaEvolution,
]

export class WorkflowRegistry {
  constructor(private readonly definitions: readonly WorkflowDefinition[] = BUILTIN_WORKFLOWS) {}

  resolve(decision: OrchestratedDecision): WorkflowDefinition {
    const definition = this.definitions.find((item) => {
      try {
        return item.matches(decision)
      } catch {
        return false
      }
    })
    if (!definition) {
      throw new Error(`No workflow supports ${decision.operation}.${decision.strategy}`)
    }
    return definition
  }

  list(): readonly WorkflowDefinition[] {
    return this.definitions
  }
}

export const defaultRegistry = new WorkflowRegistry()
