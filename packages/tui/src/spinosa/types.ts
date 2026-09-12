export type SpinosaSetupStatus = "not_started" | "importing" | "cli_started" | "workspace_started" | "unknown"

export type SpinosaWorkspaceMeta = {
  path: string
  projectName: string
  setupStatus: SpinosaSetupStatus
  frameworkVersion: string
  sourceLocation?: string
  created?: string
  preferredLlmCli?: string
}

export type SpinosaRegisteredWorkspace = {
  path: string
  workspaceID?: import("@spinosa/core/workspace/identity").SpinosaWorkspaceID
  projectName: string
  presence: import("@spinosa/core/types").SpinosaWorkspacePresence
  setupStatus: SpinosaSetupStatus
  registeredAt: string
  tags: string[]
}

export type ExtractionProgress = {
  total?: number
  read?: number
  remaining?: string
  status?: string
  lastBatch?: string
}

export type MapLevelRow = {
  level: string
  description: string
  status: string
}

export type CorpusIndexSummary = {
  hasWorkspaceIndex: boolean
  extractionProgress: ExtractionProgress
  coverageStatus: {
    setupStatus?: string
    rawCopies?: string
    maps?: string
    dictionary?: string
    knownGaps?: string
  }
  mapLevels: MapLevelRow[]
  dictionaryStatus?: string
  healthMatrixLines: string[]
  hubPath?: string
}

export type MapTreeEntry = {
  path: string
  name: string
  depth: number
}

export type CorpusSummary = {
  hasWorkspaceIndex: boolean
  mapCount: number
  rawCount: number
  dictionaryTermCount: number
  index: CorpusIndexSummary
  mapTree: MapTreeEntry[]
  hubExists: boolean
}

export type RoutePhaseStatus = "pending" | "active" | "ok" | "blocked"

export type RoutePhase = {
  agent: string
  status: RoutePhaseStatus
  note?: string
}

export type GoalArtifactSummary = {
  sessionId: string
  goalPath: string
  filename: string
  status?: string
  route?: string
  // WP3: V2 workflow mirrors (optional; legacy goals omit them).
  workflowID?: string
  workflowVersion?: number
  operation?: string
  strategy?: string
  scope?: string
  coverage?: string
  verification?: string
  cleanedPrompt?: string
  goalStatement?: string
  plannedChain?: string
  firstAgent?: string
  routeDecisions: string[]
  subagents: { agent: string; role: string; task?: string }[]
  artifactPaths: { role: string; path: string }[]
  phases: RoutePhase[]
}

export type ReportSummary = {
  filename: string
  path: string
  title?: string
  status?: string
  sessionId?: string
}

export type CoverageSummary = {
  filename: string
  path: string
  sessionId: string
}

export type RoutesSnapshot = {
  goals: GoalArtifactSummary[]
  reports: ReportSummary[]
  coverage: CoverageSummary[]
  overseerCounter?: number
  overseerAdvisories?: string[]
  activeGoal?: GoalArtifactSummary
}

export type CliRunResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  signal?: string
}
