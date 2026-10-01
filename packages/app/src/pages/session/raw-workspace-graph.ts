import type { ServerSDK } from "@/context/server-sdk"

export type RawGraphClient = Pick<ServerSDK["client"], "file">

export type RawGraphNode = {
  path: string
  fileName: string
  title?: string
}

export type RawGraphEdge = {
  source: string
  target: string
  kinds: Array<"header" | "wikilink" | "markdown">
  directions?: string[]
}

export type RawWorkspaceGraph = {
  nodes: RawGraphNode[]
  edges: RawGraphEdge[]
  unreadable: number
}

type RawGraphFile = {
  path: string
  content?: string
  unreadable?: boolean
}

type RawGraphDocument = {
  node: RawGraphNode
  headerLinks: string[]
  headerGroups: string[]
  body: string
  unreadable: boolean
}

const HEADER_LINK_FIELDS = new Set(["connects_to", "related_sources", "source_document", "part_of"])
const HEADER_GROUP_FIELDS = ["source_document", "topics", "people", "places", "organizations"]
const GRAPH_READ_CONCURRENCY = 8

export function buildRawWorkspaceGraph(files: readonly RawGraphFile[]): RawWorkspaceGraph {
  return buildGraph(files.map(parseRawDocument))
}

export async function loadRawWorkspaceGraph(client: RawGraphClient, workspacePath: string): Promise<RawWorkspaceGraph> {
  const directories = ["raw"]
  const visited = new Set(directories)
  const paths = new Set<string>()

  while (directories.length > 0) {
    const directory = directories.shift()!
    const result = normalizeSDKResponse<Array<{ path?: unknown; type?: unknown }>>(
      await client.file.list({ path: directory, directory: workspacePath }),
    )
    if (result.error) throw result.error
    if (!Array.isArray(result.data)) throw new Error(`File listing returned no entries for ${directory}`)

    for (const entry of result.data) {
      if (!entry || typeof entry.path !== "string") continue
      const normalized = normalizeWorkspacePath(entry.path)
      if (!normalized || parentDirectory(normalized) !== directory) continue

      if (entry.type === "directory") {
        if (!visited.has(normalized)) {
          visited.add(normalized)
          directories.push(normalized)
        }
      } else if (entry.type === "file" && normalized.startsWith("raw/")) {
        paths.add(normalized)
      }
    }
  }

  const files = [...paths].sort((a, b) => a.localeCompare(b))
  const markdown = files.filter((path) => /\.(?:md|markdown)$/i.test(path))
  const markdownSet = new Set(markdown)
  const unreadableFiles = new Set<string>()
  const documents = await mapWithConcurrency(markdown, GRAPH_READ_CONCURRENCY, async (path) => {
    try {
      const result = normalizeSDKResponse<{ type?: unknown; content?: unknown }>(
        await client.file.read({ path, directory: workspacePath }),
      )
      if (result.error || !result.data || result.data.type !== "text" || typeof result.data.content !== "string") {
        unreadableFiles.add(path)
        return parseRawDocument({ path, unreadable: true })
      }
      return parseRawDocument({ path, content: result.data.content })
    } catch {
      // Keep unreadable sources as nodes and surface the partial scan in the graph view.
      unreadableFiles.add(path)
      return parseRawDocument({ path, unreadable: true })
    }
  })

  const otherFiles = files.filter((path) => !markdownSet.has(path)).map((path) => parseRawDocument({ path }))
  const graph = buildGraph([...otherFiles, ...documents])
  return { ...graph, unreadable: unreadableFiles.size }
}

function normalizeSDKResponse<T>(response: unknown): { data: T | undefined; error: unknown } {
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const result = response as Record<string, unknown>
    if ("data" in result || "error" in result) {
      return { data: result.data as T | undefined, error: result.error }
    }
  }
  return { data: response as T, error: undefined }
}

export function normalizeWorkspacePath(input: string): string | undefined {
  const raw = input.trim().replaceAll("\\", "/")
  if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) return

  const parts: string[] = []
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (parts.length === 0) return
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("/") || undefined
}

function parseRawDocument(file: RawGraphFile): RawGraphDocument {
  const path = normalizeWorkspacePath(file.path)
  if (!path?.startsWith("raw/")) {
    throw new Error(`Raw workspace graph rejected a path outside raw/: ${file.path}`)
  }

  const content = file.content ?? ""
  const lines = content.split(/\r?\n/)
  const hasFrontmatter = lines[0]?.trim() === "---"
  const end = hasFrontmatter ? lines.findIndex((line, index) => index > 0 && line.trim() === "---") : -1
  const header = end > 0 ? lines.slice(1, end) : []
  const body = end > 0 ? lines.slice(end + 1).join("\n") : content
  const fields = parseHeader(header)
  const fileName = path.split("/").at(-1) ?? path
  const title = first(fields.get("title")) ?? body.match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim()
  const headerLinks = [...HEADER_LINK_FIELDS].flatMap((field) => fields.get(field) ?? [])
  const headerGroups = HEADER_GROUP_FIELDS.flatMap((field) =>
    (fields.get(field) ?? [])
      .map((value) => `${field}:${value.trim().toLowerCase()}`)
      .filter((value) => value.length > field.length + 1),
  )

  return {
    node: { path, fileName, title },
    headerLinks,
    headerGroups,
    body,
    unreadable: file.unreadable === true,
  }
}

function parseHeader(lines: string[]) {
  const fields = new Map<string, string[]>()
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index]?.match(/^([\w-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]!.toLowerCase()
    const value = match[2]!.trim()
    const values = value ? parseYamlValues(value) : []

    if (!value) {
      while (index + 1 < lines.length) {
        const next = lines[index + 1]!
        const item = next.match(/^\s+-\s+(.+?)\s*$/)
        if (!item) break
        values.push(...parseYamlValues(item[1]!))
        index++
      }
    }
    if (values.length) fields.set(key, [...(fields.get(key) ?? []), ...values])
  }
  return fields
}

function parseYamlValues(input: string): string[] {
  const source = input.trim()
  const value = source.startsWith("[") && source.endsWith("]") ? source.slice(1, -1) : source
  const matches = value.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^,]+/g) ?? []
  return matches
    .map((item) => item.trim().replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean)
}

function buildGraph(documents: readonly RawGraphDocument[]): RawWorkspaceGraph {
  const unique = new Map<string, RawGraphDocument>()
  for (const document of documents) unique.set(document.node.path, document)
  const nodes = [...unique.values()].map((document) => document.node).sort((a, b) => a.path.localeCompare(b.path))
  const byAlias = new Map<string, Set<string>>()
  for (const node of nodes) {
    for (const alias of nodeAliases(node)) {
      const values = byAlias.get(alias) ?? new Set<string>()
      values.add(node.path)
      byAlias.set(alias, values)
    }
  }

  const edges = new Map<string, { source: string; target: string; kinds: Set<RawGraphEdge["kinds"][number]>; directions: Set<string> }>()
  const sharedHeaders = new Map<string, Set<string>>()
  const add = (source: string, target: string | undefined, kind: RawGraphEdge["kinds"][number], directed = true) => {
    if (!target || source === target) return
    const [left, right] = source.localeCompare(target) < 0 ? [source, target] : [target, source]
    const key = `${left}\0${right}`
    const edge = edges.get(key) ?? { source: left, target: right, kinds: new Set(), directions: new Set<string>() }
    edge.kinds.add(kind)
    if (directed) edge.directions.add(source)
    edges.set(key, edge)
  }

  for (const document of unique.values()) {
    for (const group of document.headerGroups) {
      const paths = sharedHeaders.get(group) ?? new Set<string>()
      paths.add(document.node.path)
      sharedHeaders.set(group, paths)
    }
    for (const reference of document.headerLinks) {
      add(document.node.path, resolveRawTarget(reference, document.node.path, byAlias), "header")
    }
    for (const match of document.body.matchAll(/\[\[([^\]]+)\]\]/g)) {
      add(document.node.path, resolveRawTarget(match[1]!, document.node.path, byAlias), "wikilink")
    }
    for (const match of document.body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      add(document.node.path, resolveRawTarget(match[1]!, document.node.path, byAlias), "markdown")
    }
  }

  for (const paths of sharedHeaders.values()) {
    const ordered = [...paths].sort((a, b) => a.localeCompare(b))
    // A chain keeps a shared header group connected without creating a dense clique.
    for (let index = 1; index < ordered.length; index++) add(ordered[index - 1]!, ordered[index], "header", false)
  }

  return {
    nodes,
    edges: [...edges.values()]
      .map((edge) => ({ ...edge, kinds: [...edge.kinds].sort(), directions: [...edge.directions].sort() }))
      .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)),
    unreadable: [...unique.values()].filter((document) => document.unreadable).length,
  }
}

function nodeAliases(node: RawGraphNode): string[] {
  const aliases = new Set<string>()
  const add = (value: string) => {
    const normalized = normalizeWorkspacePath(value)?.toLowerCase()
    if (!normalized) return
    aliases.add(normalized)
    aliases.add(stripExtension(normalized))
  }
  add(node.path)
  add(node.fileName)
  if (node.title) add(node.title)
  return [...aliases]
}

function resolveRawTarget(input: string, source: string, aliases: Map<string, Set<string>>): string | undefined {
  let target = input.trim()
  if (!target || target.includes("://") || target.startsWith("#")) return
  if (target.startsWith("[[") && target.endsWith("]]")) target = target.slice(2, -2)
  target = target.split("|")[0]!.split("#")[0]!.trim()
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1)
  try {
    target = decodeURIComponent(target)
  } catch {
    // Keep the original link text when it contains an invalid escape sequence.
  }

  const candidates = new Set<string>()
  const add = (value: string) => {
    const normalized = normalizeWorkspacePath(value)?.toLowerCase()
    if (!normalized || (!normalized.startsWith("raw/") && normalized !== "raw")) return
    candidates.add(normalized)
    candidates.add(stripExtension(normalized))
  }

  if (target.startsWith("/")) return
  if (target.startsWith("raw/")) add(target)
  else {
    add(`${parentDirectory(source)}/${target}`)
    add(`raw/${target}`)
  }

  for (const candidate of candidates) {
    const exact = aliases.get(candidate)
    if (exact?.size === 1) return exact.values().next().value
  }

  const basename = candidates.values().next().value?.split("/").at(-1)
  const matches = basename ? aliases.get(basename) : undefined
  return matches?.size === 1 ? matches.values().next().value : undefined
}

function stripExtension(value: string): string {
  return value.replace(/\.(?:md|markdown|txt)$/i, "")
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/")
  return index < 0 ? "." : path.slice(0, index)
}

function first(values: string[] | undefined): string | undefined {
  return values?.find(Boolean)
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
