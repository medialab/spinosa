import { isStartupIndexingPrompt } from "./startup"

// WP10: frozen legacy classifier. New runs use RouteDecision (routing.ts) +
// deterministicRoute (router.ts). Kept because migration.ts decodes old
// run.json files through agentsForRoute(), and the startup guard below
// protects indexing prompts from coverage-audit misrouting.
export type RouteClass = "fast_path" | "Q1" | "Q2" | "Q3" | "Q4" | "Q5"

const FAST_PATH = [
  /^(?:hi|hello|hey|yo|sup|thanks|thank you|ok|okay)[!?.\s]*$/i,
  /^how do i\b/i,
  /^what is the\b/i,
  /^where is\b/i,
  /command palette/i,
  /settings pane/i,
]

const Q5 = [/coverage/i, /\bgaps?\b/i, /overseer/i, /what are we missing/i]
const Q4 = [/cleanup/i, /hygiene/i, /\bstale\b/i, /archive/i, /janitor/i]
const Q3 = [/hidden/i, /subtle/i, /implicit/i, /serendip/i, /cross-cutting/i, /unexpected connections/i]
const Q2 = [/analy[sz]e/i, /compare/i, /cohort/i, /taxonomy/i, /patterns?\b/i, /across\b/i]
const Q1 = [/evidence/i, /corpus say/i, /find source/i, /lookup/i, /quote/i]
const RESEARCH_CONTEXT =
  /\b(?:corpus|dataset|documents?|evidence|notes?|research|source-grounded|sources?\b(?!\s+(?:code|files?)))\b/i
const RESEARCH_ACTION =
  /\b(?:analy[sz]e|audit|clean\s*up|cleanup|compare|find|investigate|look\s*up|lookup|map|research|retrieve|search|show|verify)\b/i
const ARCHIVE_SEARCH = /\b(?:find|investigate|look\s*up|search)\b[\s\S]*\barchive\b/i
const ROUTE_HINTS = [...Q5, ...Q4, ...Q3, ...Q2, ...Q1]

function hasResearchIntent(prompt: string): boolean {
  if (/\b(?:what does|what do)\s+(?:the\s+)?(?:archive|corpus|documents?|evidence|notes?|sources?)\b/i.test(prompt)) return true
  if (ARCHIVE_SEARCH.test(prompt)) return true
  if (/\b(?:find|retrieve|verify)\b[\s\S]*\b(?:evidence|quote|sources?)\b/i.test(prompt)) return true
  if (/\b(?:quote retrieval|random quote)\b/i.test(prompt)) return true
  return RESEARCH_CONTEXT.test(prompt) && (RESEARCH_ACTION.test(prompt) || ROUTE_HINTS.some((pattern) => pattern.test(prompt)))
}

const AGENTS: Record<RouteClass, readonly string[]> = {
  fast_path: [],
  Q1: ["spinosa-searcher", "spinosa-writer", "spinosa-verifier", "spinosa-evaluator"],
  Q2: ["spinosa-searcher", "spinosa-analyst", "spinosa-writer", "spinosa-verifier", "spinosa-evaluator"],
  Q3: ["spinosa-searcher", "spinosa-analyst", "spinosa-serendippo", "spinosa-writer", "spinosa-verifier", "spinosa-evaluator"],
  Q4: ["spinosa-janitor", "spinosa-verifier", "spinosa-evaluator"],
  Q5: ["spinosa-overseer", "spinosa-evaluator"],
}

export function classifyPrompt(prompt: string): RouteClass {
  const trimmed = prompt.trim()
  if (!trimmed) return "fast_path"
  // Startup indexing is orchestrator-only — never route through Q5/overseer heuristics.
  if (isStartupIndexingPrompt(trimmed)) return "fast_path"
  if (FAST_PATH.some((pattern) => pattern.test(trimmed))) return "fast_path"
  if (!hasResearchIntent(trimmed)) return "fast_path"
  if (ARCHIVE_SEARCH.test(trimmed)) return "Q1"
  if (Q5.some((pattern) => pattern.test(trimmed))) return "Q5"
  if (Q4.some((pattern) => pattern.test(trimmed))) return "Q4"
  if (Q3.some((pattern) => pattern.test(trimmed))) return "Q3"
  if (Q2.some((pattern) => pattern.test(trimmed))) return "Q2"
  if (Q1.some((pattern) => pattern.test(trimmed))) return "Q1"
  return "Q1"
}

export function isNonFastPath(route: RouteClass): boolean {
  return route !== "fast_path"
}

export function agentsForRoute(route: RouteClass): readonly string[] {
  return AGENTS[route]
}

export function chainForRoute(route: RouteClass): string {
  return agentsForRoute(route).map((agent) => agent.replace("spinosa-", "")).join(" → ") || "direct"
}
