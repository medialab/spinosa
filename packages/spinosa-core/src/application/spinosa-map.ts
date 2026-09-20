// Deterministic mapping aid for spinosa-mapper sub-agents.
// Formats extraction packets and navigation maps, checks idempotency,
// and verifies wikilink coverage. The model still reads sources and
// supplies summaries, quotes, and prose.

import { mkdir, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { isSpinosaWorkspace } from "../workspace/meta"
import { parseYamlFrontmatter } from "../artifacts/parser"
import { validateArtifact } from "../artifacts/validate"

export type MapAction = "begin" | "write_extraction" | "write_map" | "check" | "cover"

export type ExtractionPassage = {
  quote: string
  path?: string
  lines?: string
}

export type ExtractionPacket = {
  filename: string
  path: string
  sourceType?: string
  language?: string
  summary?: string
  passages?: readonly ExtractionPassage[]
  concepts?: readonly string[]
  tags?: readonly string[]
  connections?: readonly string[]
  status?: "extracted" | "unreadable"
}

export type SpinosaMapInput = {
  action: MapAction
  workspacePath: string
  batchId?: string
  files?: readonly string[]
  packets?: readonly ExtractionPacket[]
  mapPath?: string
  mapKind?: "hub" | "group" | "theme"
  title?: string
  tags?: readonly string[]
  body?: string
  links?: readonly string[]
  mode?: "create" | "replace" | "enrich"
  relativePath?: string
}

export type SpinosaMapResult =
  | { ok: true; title: string; output: string }
  | { ok: false; reason: string }

const BARE_BATCH = /^(batch_?\d+|temp)$/i
const BATCH_SLUG = /^[a-z0-9][a-z0-9_-]{2,80}$/i

function contained(workspacePath: string, relative: string): boolean {
  const resolved = path.resolve(workspacePath, relative)
  const root = path.resolve(workspacePath)
  return resolved === root || resolved.startsWith(root + path.sep)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeRawPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.?\//, "")
}

function wikilinkTarget(rawPath: string): string {
  const rel = normalizeRawPath(rawPath).replace(/\.md$/i, "")
  return `[[${rel}]]`
}

function asTag(raw: string): string {
  const t = raw.trim()
  if (t.startsWith("#")) return t.toLowerCase()
  return `#${t.toLowerCase().replace(/^#+/, "")}`
}

export function extractionPathFor(batchId: string): string {
  return `agent_reports/extraction_${batchId}.md`
}

export function isUsableBatchId(batchId: string): boolean {
  return BATCH_SLUG.test(batchId) && !BARE_BATCH.test(batchId)
}

function formatPacket(packet: ExtractionPacket): string {
  const status = packet.status ?? "extracted"
  if (status === "unreadable") {
    return `### ${packet.filename}\n- **Path:** ${wikilinkTarget(packet.path)}\n- **Status:** unreadable\n`
  }
  const passages = packet.passages ?? []
  const passageLines = passages.length
    ? passages
        .map((p, i) => {
          const target = wikilinkTarget(p.path ?? packet.path)
          const lines = p.lines ? ` ${p.lines}` : ""
          return `  ${i + 1}. "${p.quote}" -> ${target}${lines}`
        })
        .join("\n")
    : "  none"
  const concepts = packet.concepts?.length ? packet.concepts.join(", ") : "none"
  const tags = packet.tags?.length ? packet.tags.map(asTag).join(" ") : "none"
  const connections =
    !packet.connections?.length || packet.connections.every((c) => c.toLowerCase() === "none")
      ? "none"
      : packet.connections.map((c) => (c.includes("[[") ? c : wikilinkTarget(c))).join(", ")
  return [
    `### ${packet.filename}`,
    `- **Path:** ${wikilinkTarget(packet.path)}`,
    `- **Source type:** ${packet.sourceType ?? "unknown"}`,
    `- **Language:** ${packet.language ?? "en"}`,
    `- **Summary:** ${packet.summary ?? ""}`,
    `- **Key passages:**`,
    passageLines,
    `- **Concept signals:** ${concepts}`,
    `- **Tags:** ${tags}`,
    `- **Connections:** ${connections}`,
    "",
  ].join("\n")
}

export function formatExtractionMarkdown(input: {
  batchId: string
  packets: readonly ExtractionPacket[]
  files?: readonly string[]
}): string {
  const rows = new Map<string, string>()
  for (const file of input.files ?? []) {
    rows.set(normalizeRawPath(file), "pending")
  }
  for (const packet of input.packets) {
    rows.set(normalizeRawPath(packet.path), packet.status ?? "extracted")
  }
  const processed = [...rows.entries()]
  const extracted = input.packets.filter((p) => (p.status ?? "extracted") === "extracted").length
  const table = [
    "| File Path | Status |",
    "|---|---|",
    ...processed.map(([file, status]) => `| ${file} | ${status} |`),
  ].join("\n")
  return [
    "---",
    "type: extraction_batch",
    `batch_id: ${input.batchId}`,
    `files_processed: ${extracted}`,
    `created: ${today()}`,
    "---",
    "",
    `# Extraction Batch: ${input.batchId}`,
    "",
    "## Processed Files",
    "",
    table,
    "",
    "## Extraction Packets",
    "",
    ...input.packets.map(formatPacket),
  ].join("\n")
}

export function formatMapMarkdown(input: {
  kind: "hub" | "group" | "theme"
  title: string
  tags: readonly string[]
  body: string
  links?: readonly string[]
}): string {
  const tags = input.tags.map(asTag)
  const linkBlock = (input.links ?? [])
    .map((l) => (l.includes("[[") ? l : wikilinkTarget(l)))
    .filter((l) => !input.body.includes(l))
  const body = [input.body.trim(), ...linkBlock].filter(Boolean).join("\n\n")
  return [
    "---",
    `type: map`,
    `kind: ${input.kind}`,
    `created: ${today()}`,
    "---",
    "",
    `# ${input.title}`,
    "",
    ...tags,
    "",
    body,
    "",
  ].join("\n")
}

function filesProcessedCount(text: string): number {
  const yaml = parseYamlFrontmatter(text)
  const n = Number(yaml.files_processed ?? yaml.filesprocessed ?? "")
  if (Number.isFinite(n) && n > 0) return n
  const m = text.match(/files?_processed:\s*(\d+)/i)
  return m ? Number(m[1]) : 0
}

function extractLinkedTargets(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!.replace(/\|.*$/, "").trim())
}

function extractPacketPaths(text: string): string[] {
  const fromTable = [...text.matchAll(/^\|\s*(raw\/[^|]+?)\s*\|/gm)].map((m) => normalizeRawPath(m[1]!.trim()))
  const fromPath = [...text.matchAll(/\*\*Path:\*\*\s*\[\[([^\]]+)\]\]/g)].map((m) => normalizeRawPath(m[1]!))
  return [...new Set([...fromTable, ...fromPath])]
}

async function listMaps(workspacePath: string): Promise<string[]> {
  const root = path.join(workspacePath, "maps")
  const out: string[] = []
  async function walk(dir: string, prefix: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(abs, rel)
      else if (entry.name.endsWith(".md") && entry.name !== "AGENTS.md") out.push(`maps/${rel}`)
    }
  }
  await walk(root, "")
  return out
}

async function readWorkspaceFile(workspacePath: string, relative: string): Promise<string | undefined> {
  if (!contained(workspacePath, relative)) return undefined
  const file = Bun.file(path.join(workspacePath, relative))
  if (!(await file.exists())) return undefined
  return file.text()
}

async function writeWorkspaceFile(workspacePath: string, relative: string, content: string): Promise<void> {
  const abs = path.join(workspacePath, relative)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content)
}

function fail(reason: string): SpinosaMapResult {
  return { ok: false, reason }
}

function ok(title: string, lines: string[]): SpinosaMapResult {
  return { ok: true, title, output: lines.join("\n") }
}

export async function spinosaMap(input: SpinosaMapInput): Promise<SpinosaMapResult> {
  if (!isSpinosaWorkspace(input.workspacePath)) {
    return fail("not a Spinosa workspace")
  }

  switch (input.action) {
    case "begin":
      return beginBatch(input)
    case "write_extraction":
      return writeExtraction(input)
    case "write_map":
      return writeMap(input)
    case "check":
      return checkArtifact(input)
    case "cover":
      return coverMaps(input)
  }
}

async function beginBatch(input: SpinosaMapInput): Promise<SpinosaMapResult> {
  const batchId = input.batchId?.trim() ?? ""
  if (!isUsableBatchId(batchId)) {
    return fail("batchId must be a descriptive kebab slug (not bare batch_001 or temp)")
  }
  const files = (input.files ?? []).map(normalizeRawPath)
  if (files.length === 0) return fail("begin needs at least one raw/ file path")
  const bad = files.find((f) => !f.startsWith("raw/") || !contained(input.workspacePath, f))
  if (bad) return fail(`file path must stay under raw/: ${bad}`)

  const relativePath = extractionPathFor(batchId)
  const existing = await readWorkspaceFile(input.workspacePath, relativePath)
  if (existing && filesProcessedCount(existing) > 0) {
    return ok("Extraction already present", [
      `<map action="begin" skip="true" path="${relativePath}">`,
      `Existing extraction has files_processed=${filesProcessedCount(existing)}. Do not rewrite it.`,
      "</map>",
    ])
  }

  const scaffold = formatExtractionMarkdown({
    batchId,
    files,
    packets: files.map((file) => ({
      filename: path.basename(file),
      path: file,
      status: "extracted",
      summary: "[3-5 sentence content-grounded summary]",
      passages: [{ quote: "[quote]", path: file, lines: "L1-L4" }],
      concepts: ["[concept]"],
      tags: ["#concept/concept", "#type/source", "#group/group"],
      connections: ["none"],
    })),
  })

  return ok("Extraction scaffold", [
    `<map action="begin" skip="false" path="${relativePath}">`,
    `Write packets with write_extraction. Files: ${files.length}.`,
    "Scaffold (replace placeholders after you read each file):",
    scaffold,
    "</map>",
  ])
}

async function writeExtraction(input: SpinosaMapInput): Promise<SpinosaMapResult> {
  const batchId = input.batchId?.trim() ?? ""
  if (!isUsableBatchId(batchId)) {
    return fail("batchId must be a descriptive kebab slug (not bare batch_001 or temp)")
  }
  const packets = input.packets ?? []
  if (packets.length === 0) return fail("write_extraction needs packets")
  for (const packet of packets) {
    const rel = normalizeRawPath(packet.path)
    if (!rel.startsWith("raw/") || !contained(input.workspacePath, rel)) {
      return fail(`packet path must stay under raw/: ${packet.path}`)
    }
    if ((packet.status ?? "extracted") === "extracted") {
      if (!packet.summary?.trim()) return fail(`packet ${packet.filename} needs a summary`)
      if (!packet.passages?.length) return fail(`packet ${packet.filename} needs key passages`)
    }
  }
  const relativePath = extractionPathFor(batchId)
  const markdown = formatExtractionMarkdown({
    batchId,
    files: input.files,
    packets: packets.map((p) => ({ ...p, path: normalizeRawPath(p.path) })),
  })
  await writeWorkspaceFile(input.workspacePath, relativePath, markdown)
  const checked = await validateArtifact({
    workspacePath: input.workspacePath,
    relativePath,
    validator: "extraction",
  })
  if (!checked.ok) return fail(`wrote ${relativePath} but validation failed: ${checked.error}`)
  const extracted = packets.filter((p) => (p.status ?? "extracted") === "extracted").length
  const unreadable = packets.length - extracted
  return ok(`Wrote extraction (${extracted} files)`, [
    `<map action="write_extraction" path="${relativePath}">`,
    `Files processed: ${extracted}`,
    `Files unreadable: ${unreadable}`,
    "Return this path to the orchestrator. Do not paste packets in chat.",
    "</map>",
  ])
}

function defaultMapTags(kind: "hub" | "group" | "theme", tags: readonly string[]): string[] {
  const have = tags.map(asTag)
  if (kind === "hub" && !have.some((t) => t === "#hub")) have.unshift("#hub")
  if (kind === "group" && !have.some((t) => t.startsWith("#group/"))) have.unshift("#group/unspecified")
  if (kind === "theme" && !have.some((t) => t.startsWith("#theme/"))) have.unshift("#theme/unspecified")
  return have
}

async function writeMap(input: SpinosaMapInput): Promise<SpinosaMapResult> {
  const mapPath = (input.mapPath ?? "").replace(/\\/g, "/").replace(/^\.?\//, "")
  if (!mapPath.startsWith("maps/") || !mapPath.endsWith(".md")) {
    return fail("mapPath must be maps/.../*.md")
  }
  if (!contained(input.workspacePath, mapPath) || mapPath.includes("..")) {
    return fail(`map path escapes workspace: ${mapPath}`)
  }
  const kind = input.mapKind ?? (mapPath.endsWith("corpus_overview.md") ? "hub" : mapPath.includes("/themes/") ? "theme" : "group")
  const title = input.title?.trim()
  if (!title) return fail("write_map needs a title")
  const body = input.body?.trim() ?? ""
  if (!body && !(input.links && input.links.length > 0)) return fail("write_map needs body prose or links")
  const tags = defaultMapTags(kind, input.tags ?? [])
  const mode = input.mode ?? "replace"
  const existing = await readWorkspaceFile(input.workspacePath, mapPath)

  if (existing && mode === "create") {
    return fail(`${mapPath} already exists; use mode=enrich or mode=replace`)
  }

  let markdown: string
  if (existing && mode === "enrich") {
    const extraTags = tags.filter((t) => !existing.includes(t))
    const extraLinks = (input.links ?? [])
      .map((l) => (l.includes("[[") ? l : wikilinkTarget(l)))
      .filter((l) => !existing.includes(l))
    const addition = [
      extraTags.join("\n"),
      "",
      `## Enrichment ${today()}`,
      "",
      body,
      extraLinks.join("\n"),
    ]
      .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
      .join("\n")
      .trim()
    markdown = `${existing.trimEnd()}\n\n${addition}\n`
  } else {
    markdown = formatMapMarkdown({ kind, title, tags, body, links: input.links })
  }

  if (kind === "group" && !/\[\[corpus_overview\]\]/.test(markdown)) {
    markdown = markdown.replace(/\n$/, "\nSee also [[corpus_overview]]\n")
  }
  if (!/\[\[.+\]\]/.test(markdown)) {
    return fail("map body must include at least one wikilink")
  }

  await writeWorkspaceFile(input.workspacePath, mapPath, markdown)
  const checked = await validateArtifact({
    workspacePath: input.workspacePath,
    relativePath: mapPath,
    validator: "map",
  })
  if (!checked.ok) return fail(`wrote ${mapPath} but validation failed: ${checked.error}`)
  return ok(`Wrote map (${kind})`, [
    `<map action="write_map" path="${mapPath}" kind="${kind}" mode="${existing && mode === "enrich" ? "enrich" : "replace"}">`,
    `Wikilinks: ${extractLinkedTargets(markdown).length}`,
    "</map>",
  ])
}

async function checkArtifact(input: SpinosaMapInput): Promise<SpinosaMapResult> {
  const relativePath = (input.relativePath ?? input.mapPath ?? (input.batchId ? extractionPathFor(input.batchId) : "")).replace(
    /\\/g,
    "/",
  )
  if (!relativePath) return fail("check needs relativePath, mapPath, or batchId")
  const validator = relativePath.startsWith("maps/") ? "map" : "extraction"
  const checked = await validateArtifact({
    workspacePath: input.workspacePath,
    relativePath,
    validator,
  })
  if (!checked.ok) {
    return fail(`${relativePath}: ${checked.error}`)
  }
  return ok("Check passed", [`<map action="check" path="${relativePath}" validator="${validator}">ok</map>`])
}

async function coverMaps(input: SpinosaMapInput): Promise<SpinosaMapResult> {
  const relativePath = input.relativePath ?? (input.batchId ? extractionPathFor(input.batchId) : "")
  if (!relativePath) return fail("cover needs relativePath or batchId of an extraction")
  const extraction = await readWorkspaceFile(input.workspacePath, relativePath)
  if (!extraction) return fail(`missing extraction: ${relativePath}`)
  const needed = extractPacketPaths(extraction).filter((p) => p.startsWith("raw/"))
  const maps = await listMaps(input.workspacePath)
  const mapTexts: string[] = []
  for (const mapPath of maps) {
    const text = await readWorkspaceFile(input.workspacePath, mapPath)
    if (text) mapTexts.push(text)
  }
  const linked = new Set<string>()
  for (const text of mapTexts) {
    for (const match of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const target = match[1]?.trim()
      if (target) linked.add(target)
    }
  }
  const missing = needed.filter((file) => {
    const target = file.replace(/\.md$/i, "")
    const base = path.basename(target)
    return !linked.has(target) && !linked.has(file) && !linked.has(base)
  })
  if (missing.length > 0) {
    return ok("Coverage gaps", [
      `<map action="cover" ok="false" missing="${missing.length}">`,
      "These extraction files are not linked from any map:",
      ...missing.map((f) => `- ${f}`),
      "Add wikilinks in a group or hub map, then re-run cover.",
      "</map>",
    ])
  }
  return ok("Coverage complete", [
    `<map action="cover" ok="true" files="${needed.length}" maps="${maps.length}">Every extracted file appears in a map.</map>`,
  ])
}
