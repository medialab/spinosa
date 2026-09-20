export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
}

export function toolDisplayMetadata(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {}
  if (!("status" in state) || state.status === "pending") return {}
  if (!("structured" in state) || !state.structured || typeof state.structured !== "object") return {}
  if (Array.isArray(state.structured)) return {}
  return state.structured as Record<string, unknown>
}

const PATH_KEYS = ["filePath", "path", "file_path", "filepath"] as const

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Prefer explicit input path keys; fall back to a path captured in pending raw JSON. */
export function toolFilePath(input: Record<string, unknown>, partState?: unknown): string | undefined {
  for (const key of PATH_KEYS) {
    const fromInput = stringField(input[key])
    if (fromInput) return fromInput
  }

  if (!partState || typeof partState !== "object" || Array.isArray(partState)) return undefined
  if (!("status" in partState) || partState.status !== "pending") return undefined
  const raw = "raw" in partState && typeof partState.raw === "string" ? partState.raw : ""
  if (!raw) return undefined

  for (const key of PATH_KEYS) {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`))
    if (!match) continue
    try {
      return JSON.parse(`"${match[1]}"`) as string
    } catch {
      return match[1]
    }
  }
  return undefined
}

/**
 * V2 file tools emit `path`; legacy TUI surfaces expect `filePath`.
 * Keep both so either schema shape renders.
 */
export function normalizeToolInputForDisplay(input: Record<string, unknown>): Record<string, unknown> {
  const filePath = toolFilePath(input)
  if (!filePath) return input
  if (stringField(input.filePath) === filePath) return input
  return { ...input, filePath }
}

/**
 * Map V2 structured tool results into the metadata keys legacy tool UIs read
 * (e.g. edit `diff`, write/edit diagnostics gating).
 */
export function normalizeToolMetadataForDisplay(
  tool: string,
  structured: Record<string, unknown>,
  input: Record<string, unknown> = {},
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...structured }

  if (tool === "edit" && metadata.diff === undefined && Array.isArray(metadata.files)) {
    const first = metadata.files[0]
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const patch = (first as { patch?: unknown }).patch
      if (typeof patch === "string") metadata.diff = patch
    }
  }

  // V1 write/edit always attached diagnostics (often empty). V2 write has no LSP yet;
  // stamp an empty map so Write can leave the pending line and show content.
  if ((tool === "write" || tool === "edit") && metadata.diagnostics === undefined) {
    const filePath = toolFilePath(input) ?? stringField(metadata.target) ?? stringField(metadata.resource)
    if (filePath) metadata.diagnostics = { [filePath]: [] }
  }

  return metadata
}

const SPINOSA_TOOL_LABELS: Record<string, string> = {
  spinosa_route: "Pick a path",
  spinosa_frame: "Start the run",
  spinosa_mint_paths: "Name the files",
  spinosa_gate: "Check coverage",
  spinosa_verify: "Check the file",
  spinosa_map: "Map sources",
  spinosa_figure: "Draw a chart",
}

export function isSpinosaTool(tool: string): boolean {
  return tool.startsWith("spinosa_")
}

/** Short human name for a kernel `spinosa_*` tool. Unknown ids keep the Spinosa prefix. */
export function spinosaToolLabel(tool: string): string {
  const known = SPINOSA_TOOL_LABELS[tool]
  if (known) return known
  if (!isSpinosaTool(tool)) return tool
  const rest = tool.slice("spinosa_".length).replaceAll("_", " ").trim()
  return rest ? `Spinosa ${rest}` : "Spinosa"
}

/** Outcome text from a tool part state. Pending calls have none. */
export function spinosaToolOutcome(state: unknown): string | undefined {
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined
  const status = "status" in state ? state.status : undefined
  const title = "title" in state && typeof state.title === "string" ? state.title.trim() : ""
  if (status === "error") return title || "Failed"
  if (status === "running" || status === "completed") return title || undefined
  return undefined
}

/** Transcript line: `Start the run` while pending, `Start the run: outcome` after. */
export function formatSpinosaToolLine(tool: string, outcome?: string): string {
  const label = spinosaToolLabel(tool)
  const text = outcome?.trim()
  if (!text) return label
  return `${label}: ${text}`
}

/** One visible line for sequential tool rows in the transcript. */
export function ellipsisToolLine(value: string, maxLength = 72): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 1) return "…"
  const ellipsis = "…"
  const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)
  const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)
  return value.slice(0, keepStart) + ellipsis + value.slice(-keepEnd)
}
