// Curated third-party MCP gallery for researchers.
//
// Entries marked `verified` had their transport confirmed against vendor docs
// (Sept 2026) and are one-shot installable via `spinosa mcp add <id>`.
// Entries marked `reference` rely on the vendor/community docs link supplied
// in the gallery and install as `guided`: the CLI prints exact setup steps
// instead of writing a config that might be wrong.
//
// Shape mirrors ConfigMCPV1 (packages/core/src/v1/config/mcp.ts) without
// importing Effect schemas into this pure-data module:
//   remote → { type: "remote", url, headers?, oauth?, enabled }
//   local  → { type: "local", command, args?, env?, enabled }

import type { ConfigMCPV1 } from "@spinosa/kernel-core/v1/config/mcp"

export type PartnerStatus = "official" | "official-preview" | "community"

export type PartnerCategory =
  | "research"
  | "notes"
  | "storage"
  | "comms"
  | "tasks"
  | "dev"
  | "planning"

/** Which corpus phase the partner serves. */
export type PartnerPhase = "acquire" | "extract" | "verify" | "publish" | "coordinate"

export type PartnerAuth =
  | { kind: "oauth"; note?: string }
  | { kind: "apiKey"; env: string; note?: string }
  | { kind: "none"; note?: string }
  | { kind: "botToken"; env: string; note?: string }

export type PartnerTransport =
  | { kind: "remote"; url: string }
  | { kind: "local"; command: string[]; env?: Record<string, string>; cwd?: string }
  | { kind: "guided"; summary: string }

export type PartnerEntry = {
  id: string
  label: string
  status: PartnerStatus
  /** "verified" = transport confirmed against vendor docs; "reference" = per linked docs. */
  source: "verified" | "reference"
  category: PartnerCategory
  phase: PartnerPhase
  description: string
  transport: PartnerTransport
  auth: PartnerAuth
  docsUrl: string
  caveats?: readonly string[]
}

export type McpConfigValue = ConfigMCPV1.Info

const remote = (
  id: string,
  label: string,
  status: PartnerStatus,
  category: PartnerCategory,
  phase: PartnerPhase,
  description: string,
  url: string,
  auth: PartnerAuth,
  docsUrl: string,
  extra?: { caveats?: readonly string[] },
): PartnerEntry => ({
  id, label, status, source: "verified", category, phase, description,
  transport: { kind: "remote", url }, auth, docsUrl, ...extra,
})

const guided = (
  id: string,
  label: string,
  status: PartnerStatus,
  category: PartnerCategory,
  phase: PartnerPhase,
  description: string,
  summary: string,
  auth: PartnerAuth,
  docsUrl: string,
  extra?: { caveats?: readonly string[] },
): PartnerEntry => ({
  id, label, status, source: "reference", category, phase, description,
  transport: { kind: "guided", summary }, auth, docsUrl, ...extra,
})

export const PARTNER_MCPS: readonly PartnerEntry[] = [
  // --- Research acquisition & verification (remote, verified) ---
  remote("readwise", "Readwise / Reader", "official", "research", "acquire",
    "Reader highlights and documents with hybrid full-text search; the highest-density input for evidence work.",
    "https://mcp2.readwise.io/mcp", { kind: "oauth" },
    "https://docs.readwise.io/tools/mcp"),
  remote("notion", "Notion", "official", "notes", "acquire",
    "Search, read, create and update workspace content the user can access.",
    "https://mcp.notion.com/mcp", { kind: "oauth" },
    "https://developers.notion.com/guides/mcp/overview"),
  remote("gdrive", "Google Drive", "official-preview", "storage", "acquire",
    "Browse, search, read and download Drive files. Requires a Google Cloud OAuth client (setup-heavy).",
    "https://drivemcp.googleapis.com/mcp/v1",
    { kind: "oauth", note: "Needs user-created GCP OAuth client ID/secret; enable drivemcp.googleapis.com." },
    "https://developers.google.com/workspace/drive/api/guides/configure-mcp-server",
    { caveats: ["Developer preview", "Manual GCP OAuth client required"] }),
  remote("dropbox", "Dropbox", "official", "storage", "acquire",
    "Browse, search, read, share; text extraction and media transcription included. Beta.",
    "https://mcp.dropbox.com/mcp", { kind: "oauth", note: "Dynamic client registration on major clients." },
    "https://help.dropbox.com/integrations/connect-dropbox-mcp-server",
    { caveats: ["Beta"] }),
  remote("gmail", "Gmail", "official-preview", "comms", "acquire",
    "Search and read mail; compose with gmail.compose scope. Requires a Google Cloud OAuth client.",
    "https://gmailmcp.googleapis.com/mcp/v1",
    { kind: "oauth", note: "Needs user-created GCP OAuth client ID/secret; enable gmailmcp.googleapis.com." },
    "https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server",
    { caveats: ["Developer preview", "Manual GCP OAuth client required"] }),
  remote("gcal", "Google Calendar", "official-preview", "tasks", "coordinate",
    "Read calendars, events, free/busy. Requires a Google Cloud OAuth client.",
    "https://calendarmcp.googleapis.com/mcp/v1",
    { kind: "oauth", note: "Needs user-created GCP OAuth client ID/secret; enable calendarmcp.googleapis.com." },
    "https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server",
    { caveats: ["Developer preview", "Manual GCP OAuth client required"] }),
  remote("slack", "Slack", "official", "comms", "coordinate",
    "Search messages/files, read channels and threads, canvases. Workspace admin must approve MCP.",
    "https://mcp.slack.com/mcp",
    { kind: "oauth", note: "Workspace admin approval required; app must be Marketplace/internal." },
    "https://docs.slack.dev/ai/slack-mcp-server/connect-to-harnesses"),
  remote("linear", "Linear", "official", "planning", "coordinate",
    "Issues, projects, comments. Read-only variant at /mcp/readonly.",
    "https://mcp.linear.app/mcp", { kind: "oauth" },
    "https://linear.app/docs/mcp"),
  remote("github", "GitHub", "official", "dev", "coordinate",
    "Repos, issues, PRs, Actions, code scanning. Toolsets narrow the surface; PAT alternative.",
    "https://api.githubcopilot.com/mcp/", { kind: "oauth", note: "Or PAT via Authorization header." },
    "https://github.com/github/github-mcp-server"),
  remote("figma", "Figma", "official", "dev", "extract",
    "Design context, variables, components; write-to-canvas on remote. Link-scoped prompts.",
    "https://mcp.figma.com/mcp", { kind: "oauth" },
    "https://developers.figma.com/docs/figma-mcp-server/",
    { caveats: ["Figma allowlists MCP clients; unlisted clients are refused"] }),
  remote("todoist", "Todoist", "official", "tasks", "coordinate",
    "Read, add and reorganize tasks and projects.",
    "https://ai.todoist.net/mcp", { kind: "oauth" },
    "https://github.com/Doist/todoist-mcp"),
  remote("raindrop", "Raindrop.io", "official", "research", "acquire",
    "Bookmark collections with OAuth 2.1; read-only tools permission recommended.",
    "https://api.raindrop.io/rest/v2/ai/mcp", { kind: "oauth" },
    "https://developer.raindrop.io/mcp/mcp"),
  remote("arena", "Are.na", "official", "research", "acquire",
    "40+ channel/block tools. Hosted OAuth with dynamic registration, or personal token.",
    "https://mcp.are.na/mcp", { kind: "oauth", note: "Or ARENA_TOKEN personal token via header." },
    "https://www.are.na/developers/resources/mcp"),
  remote("airtable", "Airtable", "official", "research", "extract",
    "Structured bases as queryable evidence tables. OAuth or PAT.",
    "https://mcp.airtable.com/mcp",
    { kind: "oauth", note: "Or AIRTABLE_PAT via Authorization header." },
    "https://support.airtable.com/articles/9897799762-using-the-airtable-mcp-server"),
  remote("miro", "Miro", "official", "planning", "publish",
    "Boards as visual synthesis surface. Enterprise needs admin enablement.",
    "https://mcp.miro.com/", { kind: "oauth" },
    "https://developers.miro.com/docs/miro-mcp",
    { caveats: ["Enterprise workspaces need admin enablement"] }),

  // --- Local bridges (verified install recipes) ---
  {
    id: "zotero", label: "Zotero (local)", status: "community", source: "verified",
    category: "research", phase: "acquire",
    description: "Same Zotero library via a local Python bridge. Read-only; needs API key + library ID.",
    transport: {
      kind: "local",
      command: ["python", "-m", "zotero_mcp"],
      env: { ZOTERO_API_KEY: "", ZOTERO_LIBRARY_ID: "", ZOTERO_LIBRARY_TYPE: "user" },
    },
    auth: { kind: "apiKey", env: "ZOTERO_API_KEY", note: "Read-only key from zotero.org/settings/keys." },
    docsUrl: "https://github.com/nadavWeisler/zotero-mcp",
    caveats: ["Clone the repo first; Python 3.12+ required"],
  },
  {
    id: "obsidian", label: "Obsidian (local)", status: "community", source: "verified",
    category: "notes", phase: "extract",
    description: "Vault-scoped read/search with explicit allowlist; work directly on Markdown, no app needed.",
    transport: {
      kind: "local",
      command: ["npx", "-y", "obsidian-mcp@2", "serve", "--vault", "notes=<ABSOLUTE_VAULT_PATH>"],
    },
    auth: { kind: "none", note: "Authorization is the explicit --vault path." },
    docsUrl: "https://github.com/StevenStavrakis/obsidian-mcp",
    caveats: ["Node.js 22+ required", "Replace <ABSOLUTE_VAULT_PATH> before connecting"],
  },
  {
    id: "openalex", label: "OpenAlex", status: "community", source: "verified",
    category: "research", phase: "verify",
    description: "Same open catalog via local bridge; no key. Optional mailto raises limits.",
    transport: { kind: "local", command: ["npx", "openalex-mcp"] },
    auth: { kind: "none" },
    docsUrl: "https://github.com/reetp14/openalex-mcp",
  },

  // --- Guided (per vendor/community docs; no verified one-shot recipe) ---
  guided("mendeley", "Mendeley", "community", "research", "acquire",
    "Academic library search and retrieval via community bridge.",
    "Install per repo README (Python bridge, API credentials), then add as a local server.",
    { kind: "apiKey", env: "MENDELEY_CREDENTIALS", note: "See repo README for credential setup." },
    "https://github.com/pallaprolus/mendeley-mcp"),
  guided("overleaf", "Overleaf", "community", "research", "publish",
    "LaTeX project read/write for paper drafting from verified findings.",
    "Install per repo README, then add as a local server.",
    { kind: "apiKey", env: "OVERLEAF_CREDENTIALS", note: "See repo README for credential setup." },
    "https://github.com/yangzichao/mcp-server-overleaf",
    { caveats: ["Reference link unverified; confirm repo before installing"] }),
  guided("orcid", "ORCID", "community", "research", "verify",
    "Researcher profiles, works, affiliations, funding. STDIO or Streamable HTTP.",
    "Install per repo README (cyanheads/orcid-mcp-server), then add as a local or remote server.",
    { kind: "none" },
    "https://github.com/cyanheads/orcid-mcp-server"),
  guided("crossref", "Crossref", "community", "research", "verify",
    "DOI metadata truth-checks for citations.",
    "Install per repo README (botanicastudios/crossref-mcp), then add as a local server.",
    { kind: "none" },
    "https://github.com/botanicastudios/crossref-mcp"),
  guided("semantic-scholar", "Semantic Scholar", "community", "research", "verify",
    "Paper search, citation graphs, author profiles, recommendations (14 tools).",
    "Install per repo README (smaniches/semantic-scholar-mcp, PyPI/Docker), then add as a local server.",
    { kind: "none" },
    "https://github.com/smaniches/semantic-scholar-mcp"),
  guided("discord", "Discord", "community", "comms", "coordinate",
    "Bot-channel history via community bridge (192 tools, bot token).",
    "Install per repo README (cappyeo/discord-mcp), then add as a local server.",
    { kind: "botToken", env: "DISCORD_BOT_TOKEN", note: "Bot must be invited to the servers." },
    "https://github.com/cappyeo/discord-mcp"),
  guided("gitlab", "GitLab", "official", "dev", "coordinate",
    "Official GitLab MCP server per product docs.",
    "Follow the official GitLab MCP docs, then add the resulting server here.",
    { kind: "oauth" },
    "https://docs.gitlab.com/user/model_context_protocol/mcp_server/"),
  guided("teams", "Microsoft Teams", "official-preview", "comms", "coordinate",
    "Teams AI library MCP surface (preview/WIP).",
    "Follow Microsoft Teams AI library docs, then add the resulting server here.",
    { kind: "oauth" },
    "https://learn.microsoft.com/en-us/microsoftteams/platform/teams-ai-library/in-depth-guides/ai/mcp/mcp-server",
    { caveats: ["Preview / work in progress"] }),
  guided("onedrive", "OneDrive", "official-preview", "storage", "acquire",
    "OneDrive files via Microsoft preview surface.",
    "Follow Microsoft Copilot Studio MCP docs, then add the resulting server here.",
    { kind: "oauth" },
    "https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-onedrive-tools",
    { caveats: ["Preview"] }),
  guided("outlook", "Outlook Mail", "official-preview", "comms", "acquire",
    "Mail via Microsoft preview surface.",
    "Follow Microsoft mail MCP reference, then add the resulting server here.",
    { kind: "oauth" },
    "https://learn.microsoft.com/en-us/microsoft-agent-365/mcp-server-reference/mail",
    { caveats: ["Preview"] }),
  guided("things", "Things 3", "community", "tasks", "coordinate",
    "Apple-reminders-style task lists via community bridge.",
    "Install per repo README (hildersantos/things-mcp), then add as a local server.",
    { kind: "none" },
    "https://github.com/hildersantos/things-mcp"),
  guided("ticktick", "TickTick", "community", "tasks", "coordinate",
    "Task lists via community bridge (v2 API).",
    "Install per repo README (partymola/ticktick-mcp), then add as a local server.",
    { kind: "none" },
    "https://github.com/partymola/ticktick-mcp"),
]

export function partnerById(id: string): PartnerEntry | undefined {
  return PARTNER_MCPS.find((entry) => entry.id === id)
}

/** Config fragment for `mcp.<id>` in spinosa.json/opencode.json. Always disabled until toggled. */
export function partnerToMcpConfig(entry: PartnerEntry): McpConfigValue | undefined {
  if (entry.transport.kind === "remote") {
    return { type: "remote", url: entry.transport.url, enabled: false }
  }
  if (entry.transport.kind === "local") {
    // Field name must be `environment`: that is what ConfigMCPV1.Local decodes
    // and what the runtime spreads into the spawned process (`env` would be
    // silently dropped as an excess key, losing credentials/placeholders).
    // Empty-string placeholders are kept so `mcp add` output shows what to
    // fill; the runtime ignores empty values so host-exported credentials
    // pass through (see connectLocal).
    return {
      type: "local",
      command: [...entry.transport.command],
      ...(entry.transport.env ? { environment: { ...entry.transport.env } } : {}),
      enabled: false,
    }
  }
  return undefined
}

/**
 * Built-in gallery servers: every one-shot entry (remote + local, never
 * guided) as a disabled-by-default config fragment. The MCP service merges
 * these UNDER the user config, so curated partners — Zotero, Obsidian,
 * OpenAlex, Readwise, … — always show in the MCP dialog (○ Disabled) and
 * toggle on without a prior `spinosa mcp add`. Empty-string env placeholders
 * stay in the fragment (self-documenting); the runtime ignores empty values
 * so host-exported credentials pass through (see connectLocal).
 */
export function builtinMcpConfigs(): Record<string, McpConfigValue> {
  const out: Record<string, McpConfigValue> = {}
  for (const entry of PARTNER_MCPS) {
    const fragment = partnerToMcpConfig(entry)
    if (fragment) out[entry.id] = fragment
  }
  return out
}

export type GalleryFilter = {
  category?: PartnerCategory
  phase?: PartnerPhase
  status?: PartnerStatus
}

export function filterGallery(filter: GalleryFilter = {}): readonly PartnerEntry[] {
  return PARTNER_MCPS.filter((entry) =>
    (!filter.category || entry.category === filter.category) &&
    (!filter.phase || entry.phase === filter.phase) &&
    (!filter.status || entry.status === filter.status),
  )
}

/**
 * Pure config merge: returns the updated config object and whether anything
 * changed. Never writes; the CLI owns I/O. Refuses jsonc sources upstream —
 * rewriting them would destroy comments.
 */
export function mergePartnerIntoConfig(
  existing: unknown,
  entry: PartnerEntry,
): { config: Record<string, unknown>; changed: boolean; reason: string } {
  const fragment = partnerToMcpConfig(entry)
  if (!fragment) {
    return {
      config: typeof existing === "object" && existing !== null
        ? existing as Record<string, unknown>
        : {},
      changed: false,
      reason: `guided partner '${entry.id}': follow ${entry.docsUrl}, then add manually`,
    }
  }
  const base: Record<string, unknown> =
    typeof existing === "object" && existing !== null
      ? { ...(existing as Record<string, unknown>) }
      : {}
  const mcp = (base.mcp && typeof base.mcp === "object")
    ? { ...(base.mcp as Record<string, unknown>) }
    : {}
  if (entry.id in mcp) {
    return { config: base, changed: false, reason: `already present: mcp.${entry.id}` }
  }
  mcp[entry.id] = fragment
  return { config: { ...base, mcp }, changed: true, reason: `added mcp.${entry.id} (disabled)` }
}
