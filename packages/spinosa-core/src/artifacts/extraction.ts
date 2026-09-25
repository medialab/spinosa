import { parseYamlFrontmatter } from "./parser"

export type ExtractionFileStatus = "pending" | "extracted" | "unreadable"

export type ExtractionManifest = {
  batchId?: string
  filesExpected?: number
  filesAccounted?: number
  filesProcessed?: number
  files: Map<string, ExtractionFileStatus>
  duplicateFiles: string[]
  invalidRows: string[]
}

export type ExtractionCompleteness = {
  complete: boolean
  expected: string[]
  actual: string[]
  missing: string[]
  extra: string[]
  pending: string[]
  reason: string
}

export function normalizeExtractionPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.?\//, "")
}

function numberField(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

export function parseExtractionManifest(text: string): ExtractionManifest {
  const yaml = parseYamlFrontmatter(text)
  const files = new Map<string, ExtractionFileStatus>()
  const duplicateFiles: string[] = []
  const invalidRows: string[] = []

  for (const line of text.split(/\r?\n/)) {
    const row = line.trim()
    if (!/^\|\s*raw\//i.test(row)) continue
    const cells = row.split("|")
    if (cells.length !== 4 || cells[0] !== "" || cells[3] !== "") {
      invalidRows.push(row)
      continue
    }
    const file = normalizeExtractionPath(cells[1]!.trim())
    const status = cells[2]!.trim().toLowerCase()
    if (!file.startsWith("raw/") || !["pending", "extracted", "unreadable"].includes(status)) {
      invalidRows.push(row)
      continue
    }
    if (files.has(file)) duplicateFiles.push(file)
    files.set(file, status as ExtractionFileStatus)
  }

  return {
    batchId: yaml.batch_id,
    filesExpected: numberField(yaml.files_expected),
    filesAccounted: numberField(yaml.files_accounted),
    filesProcessed: numberField(yaml.files_processed),
    files,
    duplicateFiles,
    invalidRows,
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeExtractionPath))].sort()
}

export function extractionCompleteness(text: string, expectedFiles: readonly string[]): ExtractionCompleteness {
  const manifest = parseExtractionManifest(text)
  const expected = sortedUnique(expectedFiles)
  const actual = [...manifest.files.keys()].sort()
  const missing = expected.filter((file) => !manifest.files.has(file))
  const extra = actual.filter((file) => !expected.includes(file))
  const pending = expected.filter((file) => manifest.files.get(file) === "pending")
  const terminalCount = [...manifest.files.values()].filter((status) => status !== "pending").length

  const reasons: string[] = []
  if (expected.length !== expectedFiles.length) reasons.push("requested file list contains duplicates")
  if (manifest.duplicateFiles.length > 0) reasons.push("artifact contains duplicate file rows")
  if (manifest.invalidRows.length > 0) reasons.push("artifact contains malformed file rows")
  if (missing.length > 0) reasons.push(`missing ${missing.join(", ")}`)
  if (extra.length > 0) reasons.push(`unexpected ${extra.join(", ")}`)
  if (pending.length > 0) reasons.push(`pending ${pending.join(", ")}`)
  if (manifest.filesExpected !== undefined && manifest.filesExpected !== expected.length) {
    reasons.push(`files_expected=${manifest.filesExpected} does not match ${expected.length}`)
  }
  if (manifest.filesAccounted !== undefined && manifest.filesAccounted !== terminalCount) {
    reasons.push(`files_accounted=${manifest.filesAccounted} does not match ${terminalCount}`)
  }

  return {
    complete: reasons.length === 0 && actual.length === expected.length && terminalCount === expected.length,
    expected,
    actual,
    missing,
    extra,
    pending,
    reason: reasons.join("; ") || "complete",
  }
}

export function validateExtractionManifest(text: string): { ok: true; manifest: ExtractionManifest } | { ok: false; error: string } {
  const yaml = parseYamlFrontmatter(text)
  if (yaml.type !== "extraction_batch") return { ok: false, error: "extraction type must be extraction_batch" }
  if (!yaml.batch_id?.trim()) return { ok: false, error: "extraction batch_id is missing" }

  const manifest = parseExtractionManifest(text)
  if (manifest.filesExpected === undefined || manifest.filesAccounted === undefined || manifest.filesProcessed === undefined) {
    return { ok: false, error: "extraction requires files_expected, files_accounted, and files_processed metadata" }
  }
  if (manifest.files.size === 0) return { ok: false, error: "extraction has no processed file rows" }
  if (manifest.duplicateFiles.length > 0) return { ok: false, error: "extraction contains duplicate file rows" }
  if (manifest.invalidRows.length > 0) return { ok: false, error: "extraction contains malformed file rows" }
  if ([...manifest.files.values()].some((status) => status === "pending")) {
    return { ok: false, error: "extraction contains pending file rows" }
  }

  const accounted = [...manifest.files.values()].length
  const processed = [...manifest.files.values()].filter((status) => status === "extracted").length
  if (manifest.filesExpected !== undefined && manifest.filesExpected !== accounted) {
    return { ok: false, error: `files_expected=${manifest.filesExpected} does not match ${accounted}` }
  }
  if (manifest.filesAccounted !== undefined && manifest.filesAccounted !== accounted) {
    return { ok: false, error: `files_accounted=${manifest.filesAccounted} does not match ${accounted}` }
  }
  if (manifest.filesProcessed !== undefined && manifest.filesProcessed !== processed) {
    return { ok: false, error: `files_processed=${manifest.filesProcessed} does not match ${processed}` }
  }

  return { ok: true, manifest }
}
