import type { GoalArtifactSummary, RoutePhase, RoutePhaseStatus } from "../types"

const AGENT_ORDER = [
  "spinosa-searcher",
  "spinosa-mapper",
  "spinosa-analyst",
  "spinosa-serendippo",
  "spinosa-writer",
  "spinosa-verifier",
  "spinosa-evaluator",
  "spinosa-evolver",
  "spinosa-overseer",
  "spinosa-janitor",
]

export function sessionIdFromGoalFilename(filename: string): string | undefined {
  const match = filename.match(/^g_(.+)\.md$/)
  return match?.[1]
}

export function parseYamlFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const fields: Record<string, string> = {}
  for (const line of match[1]!.split("\n")) {
    const row = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/)
    if (row) fields[row[1]!] = row[2]!.trim()
  }
  return fields
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sectionBody(text: string, heading: string) {
  const pattern = new RegExp(`## ${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`)
  return text.match(pattern)?.[1]?.trim()
}

function parseArtifactTable(text: string) {
  const block = sectionBody(text, "Artifact Paths (session-scoped)") ?? sectionBody(text, "Artifact Paths")
  if (!block) return []
  const rows: { role: string; path: string }[] = []
  for (const line of block.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("|")) continue
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length < 2) continue
    const [role, rawPath] = cells
    if (!role || role === "Role" || role.startsWith("---") || !rawPath || rawPath.startsWith("---")) continue
    rows.push({ role, path: rawPath.replace(/^`|`$/g, "") })
  }
  return rows
}

function parseRouteDecisions(text: string) {
  const block = sectionBody(text, "Route Decisions")
  if (!block) return []
  return block
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean)
}

function parseSubagentBlocks(text: string) {
  const blocks: { agent: string; role: string; task?: string }[] = []
  const pattern = /```spinosa-subagent\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const body = match[1]!
    const agent = body.match(/^agent:\s*(.+)$/m)?.[1]?.trim()
    const role = body.match(/^role:\s*(.+)$/m)?.[1]?.trim()
    const task = body.match(/^task:\s*(.+)$/m)?.[1]?.trim()
    if (agent) blocks.push({ agent, role: role ?? agent, task })
  }
  return blocks
}

function decisionStatus(note: string): RoutePhaseStatus {
  const lower = note.toLowerCase()
  if (lower.includes("blocked") || lower.includes("abort") || lower.includes("timeout")) return "blocked"
  if (lower.includes("pass") || lower.includes("ok") || lower.includes("deliver") || lower.includes("no_edit"))
    return "ok"
  return "active"
}

function agentFromDecision(note: string) {
  for (const agent of AGENT_ORDER) {
    const short = agent.replace("spinosa-", "")
    if (note.toLowerCase().includes(short)) return agent
  }
  const dispatch = note.match(/dispatch(?:ing)?\s+([\w-]+)/i)?.[1]
  if (dispatch) return dispatch.startsWith("spinosa-") ? dispatch : `spinosa-${dispatch}`
  return "unknown"
}

export function inferPhasesFromGoal(
  subagents: GoalArtifactSummary["subagents"],
  decisions: string[],
): RoutePhase[] {
  const phases: RoutePhase[] = []
  const seen = new Set<string>()

  for (const block of subagents) {
    if (seen.has(block.agent)) continue
    seen.add(block.agent)
    phases.push({ agent: block.agent, status: "pending", note: block.task })
  }

  for (const decision of decisions) {
    const agent = agentFromDecision(decision)
    const status = decisionStatus(decision)
    const existing = phases.find((phase) => phase.agent === agent)
    if (existing) {
      existing.status = status
      existing.note = decision
      continue
    }
    phases.push({ agent, status, note: decision })
  }

  const lastActive = [...phases].reverse().find((phase) => phase.status === "active")
  if (!lastActive) {
    const firstPending = phases.find((phase) => phase.status === "pending")
    if (firstPending) firstPending.status = "active"
  }

  return phases
}

export function parseGoalArtifact(text: string, goalPath: string): GoalArtifactSummary {
  const filename = goalPath.split("/").pop() ?? goalPath
  const yaml = parseYamlFrontmatter(text)
  // V2 workflow goals carry run_id/workflow_id; legacy carries session_id/route.
  const sessionId = yaml.run_id ?? yaml.session_id ?? sessionIdFromGoalFilename(filename) ?? "unknown"
  const routeDecisions = parseRouteDecisions(text)
  const subagents = parseSubagentBlocks(text)
  // V2: derive a phases-compatible view from the Workflow Plan table so TUI
  // route views keep working; sectionBody("Step Decisions") feeds decisions.
  const stepDecisions = sectionBody(text, "Step Decisions")
  const decisions = stepDecisions ? [...routeDecisions, ...stepDecisions.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean)] : routeDecisions

  return {
    sessionId,
    goalPath,
    filename,
    status: yaml.status,
    route: yaml.route ?? (yaml.workflow_id ? `workflow:${yaml.workflow_id}` : undefined),
    workflowID: yaml.workflow_id,
    workflowVersion: yaml.workflow_version ? Number(yaml.workflow_version) : undefined,
    operation: yaml.operation,
    strategy: yaml.strategy,
    scope: yaml.scope,
    coverage: yaml.coverage,
    verification: yaml.verification,
    cleanedPrompt: sectionBody(text, "Cleaned Prompt"),
    goalStatement: sectionBody(text, "Goal Statement") ?? sectionBody(text, "Research Objective"),
    plannedChain: sectionBody(text, "Planned Chain") ?? sectionBody(text, "Workflow Plan"),
    firstAgent: sectionBody(text, "First Agent")?.replace(/`/g, ""),
    routeDecisions,
    subagents,
    artifactPaths: parseArtifactTable(text),
    phases: inferPhasesFromGoal(subagents, decisions),
  }
}

export function parseReportFrontmatter(text: string): { title?: string; status?: string; sessionId?: string } {
  const yaml = parseYamlFrontmatter(text)
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return {
    title,
    status: yaml.status ?? yaml.verification_status,
    sessionId: yaml.session_id,
  }
}

export function parseOrchestratorCounter(notes: string): number | undefined {
  const match =
    notes.match(/routes_since_overseer:\s*(\d+)/i) ??
    notes.match(/routes since last overseer[:\s]+(\d+)/i) ??
    notes.match(/overseer.*counter[:\s]+(\d+)/i)
  return match ? Number(match[1]) : undefined
}

export function parseOrchestratorAdvisories(notes: string): string[] {
  const block = notes.match(/## Orchestrator Advisories([\s\S]*?)(?=\n## |\n# |$)/)?.[1]
  if (!block) return []
  return block
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((line) => line.length > 0)
}
