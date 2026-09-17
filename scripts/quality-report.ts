#!/usr/bin/env bun

/**
 * Deterministic repository quality inventory (`bun run quality:report`).
 *
 * The inventory is deliberately based on git-tracked files so generated build
 * output and local dependencies cannot change the result. It reports all
 * buckets, including generated/fixture/asset debt, rather than excluding it.
 * External metric runners are reported as unavailable until they are installed
 * and configured; this command never substitutes a guessed metric value.
 */

import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"

const root = path.resolve(import.meta.dir, "..")
const baselineRelativePath = "docs/review/workpackages_quality_remediation_01092026/quality-baseline.json"
const reportRelativePath = "quality-report.json"
const baselinePath = path.join(root, baselineRelativePath)
const lineThreshold = 500

const buckets = ["production", "test", "generated", "fixture", "asset", "docs", "script", "unknown"] as const
type Bucket = (typeof buckets)[number]

const enforcedBuckets = ["production", "test", "generated", "fixture", "script", "unknown"] as const
type EnforcedBucket = (typeof enforcedBuckets)[number]

const codeExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
])

const textExtensions = new Set([
  ...codeExtensions,
  ".adoc",
  ".bats",
  ".css",
  ".csv",
  ".diff",
  ".editorconfig",
  ".html",
  ".json",
  ".lock",
  ".md",
  ".mdx",
  ".npmrc",
  ".patch",
  ".prettierignore",
  ".prettierrc",
  ".py",
  ".rst",
  ".sh",
  ".sql",
  ".snap",
  ".svelte",
  ".svg",
  ".toml",
  ".txt",
  ".tsv",
  ".webmanifest",
  ".xml",
  ".yaml",
  ".yml",
])

type FileRecord = {
  path: string
  bucket: Bucket
  bytes: number
  loc: number | null
  anyTokens: number
  unknownTokens: number
}

type BucketSummary = {
  files: number
  textFiles: number
  binaryFiles: number
  loc: number
  maxFileLoc: number
  filesAtOrAbove500Loc: number
  anyTokens: number
  unknownTokens: number
}

type Measurement = {
  command: string
  availability: "available" | "unavailable"
  executable: string | null
  value: number | null
  status: "measured" | "not-run" | "unavailable"
  note: string
}

type Guardrail = {
  maxFileLoc: number
  filesAtOrAbove500Loc: number
  anyTokens: number
  unknownTokens: number
  files: number
}

type Report = {
  schemaVersion: 1
  scope: {
    basis: "git-tracked-files"
    root: "."
    excluded: string[]
    includedAdditionalPaths: string[]
    locDefinition: string
    tokenDefinition: string
  }
  buckets: Record<Bucket, BucketSummary>
  totals: {
    files: number
    textFiles: number
    binaryFiles: number
    loc: number
    anyTokens: number
    unknownTokens: number
    filesAtOrAbove500Loc: number
  }
  files: FileRecord[]
  measurements: Record<string, Measurement>
  guardrails: Record<EnforcedBucket, Guardrail>
  regressions: string[]
}

type Baseline = {
  schemaVersion: 1
  scope: Report["scope"]
  guardrails: Record<EnforcedBucket, Guardrail>
}

const excludedPaths = new Set([baselineRelativePath, reportRelativePath])
const includedAdditionalPaths = [".github/workflows/quality.yml", "scripts/quality-report.ts"]

function classify(filePath: string): Bucket {
  const normalized = filePath.toLowerCase()
  const segments = normalized.split("/")
  const fileName = segments.at(-1) ?? normalized
  const extension = path.extname(fileName)

  if (
    segments.includes("generated") ||
    segments.includes("gen") ||
    fileName.includes(".generated.") ||
    fileName.endsWith(".gen.ts") ||
    fileName.endsWith(".gen.tsx")
  ) {
    return "generated"
  }

  if (
    segments.includes("fixture") ||
    segments.includes("fixtures") ||
    segments.includes("__fixtures__") ||
    fileName.includes(".fixture.")
  ) {
    return "fixture"
  }

  if (
    segments.includes("asset") ||
    segments.includes("assets") ||
    [".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".mp3", ".mp4", ".otf", ".png", ".ttf", ".wav", ".webp", ".woff", ".woff2"].includes(extension)
  ) {
    return "asset"
  }

  if (
    segments.includes("docs") ||
    [".adoc", ".md", ".mdx", ".rst"].includes(extension) ||
    /^(readme|changelog|contributing|code_of_conduct|security|support|license)(\.|$)/i.test(fileName)
  ) {
    return "docs"
  }

  if (
    segments.includes("script") ||
    [".bats", ".sh"].includes(extension) ||
    fileName.startsWith("install.")
  ) {
    return "script"
  }

  if (
    segments.includes("test") ||
    segments.includes("tests") ||
    fileName.includes(".test.") ||
    fileName.includes(".spec.") ||
    fileName.endsWith(".snap")
  ) {
    return "test"
  }

  if (
    (segments[0] === "packages" && segments.includes("src")) ||
    (segments[0] === "website" && segments.includes("src"))
  ) {
    return "production"
  }

  return "unknown"
}

function emptySummary(): BucketSummary {
  return {
    files: 0,
    textFiles: 0,
    binaryFiles: 0,
    loc: 0,
    maxFileLoc: 0,
    filesAtOrAbove500Loc: 0,
    anyTokens: 0,
    unknownTokens: 0,
  }
}

function lineCount(text: string): number {
  if (text.length === 0) return 0
  const lines = text.split(/\r\n|\n|\r/)
  return lines.at(-1) === "" ? lines.length - 1 : lines.length
}

function lexicalCount(text: string, token: "any" | "unknown"): number {
  return text.match(new RegExp(`\\b${token}\\b`, "g"))?.length ?? 0
}

function isTextPath(filePath: string): boolean {
  return textExtensions.has(path.extname(filePath).toLowerCase()) || path.extname(filePath) === ""
}

async function readTrackedFiles(): Promise<string[]> {
  const result = await $`git ls-files -z`.cwd(root).quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error("unable to enumerate git-tracked files")
  }

  const trackedFiles = result.stdout
    .toString()
    .split("\0")
    .filter((filePath) => filePath.length > 0 && !excludedPaths.has(filePath))

  for (const filePath of includedAdditionalPaths) {
    if (!excludedPaths.has(filePath) && existsSync(path.join(root, filePath)) && !trackedFiles.includes(filePath)) {
      trackedFiles.push(filePath)
    }
  }

  return trackedFiles.sort()
}

async function inspectFile(filePath: string): Promise<FileRecord> {
  const absolutePath = path.join(root, filePath)
  const bytes = new Uint8Array(await Bun.file(absolutePath).arrayBuffer())
  const extensionSuggestsText = isTextPath(filePath)
  let text: string | null = null

  if (extensionSuggestsText && !bytes.subarray(0, 8192).includes(0)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      text = null
    }
  }

  const isCode = codeExtensions.has(path.extname(filePath).toLowerCase())
  return {
    path: filePath,
    bucket: classify(filePath),
    bytes: bytes.byteLength,
    loc: text === null ? null : lineCount(text),
    anyTokens: text !== null && isCode ? lexicalCount(text, "any") : 0,
    unknownTokens: text !== null && isCode ? lexicalCount(text, "unknown") : 0,
  }
}

function summarize(files: FileRecord[]): {
  buckets: Record<Bucket, BucketSummary>
  totals: Report["totals"]
} {
  const summaries = Object.fromEntries(buckets.map((bucket) => [bucket, emptySummary()])) as Record<Bucket, BucketSummary>

  for (const file of files) {
    const summary = summaries[file.bucket]
    summary.files += 1
    summary.anyTokens += file.anyTokens
    summary.unknownTokens += file.unknownTokens

    if (file.loc === null) {
      summary.binaryFiles += 1
      continue
    }

    summary.textFiles += 1
    summary.loc += file.loc
    summary.maxFileLoc = Math.max(summary.maxFileLoc, file.loc)
    if (file.loc >= lineThreshold) summary.filesAtOrAbove500Loc += 1
  }

  const totals = files.reduce<Report["totals"]>(
    (total, file) => {
      total.files += 1
      total.anyTokens += file.anyTokens
      total.unknownTokens += file.unknownTokens
      if (file.loc === null) {
        total.binaryFiles += 1
      } else {
        total.textFiles += 1
        total.loc += file.loc
        if (file.loc >= lineThreshold) total.filesAtOrAbove500Loc += 1
      }
      return total
    },
    {
      files: 0,
      textFiles: 0,
      binaryFiles: 0,
      loc: 0,
      anyTokens: 0,
      unknownTokens: 0,
      filesAtOrAbove500Loc: 0,
    },
  )

  return { buckets: summaries, totals }
}

function executablePath(command: string): string | null {
  const localCandidates = [
    path.join(root, "node_modules", ".bin", command),
    path.join(root, "node_modules", ".bin", `${command}.cmd`),
  ]
  for (const candidate of localCandidates) {
    if (existsSync(candidate)) return candidate
  }
  return Bun.which(command) ?? null
}

function executableLabel(command: string): string | null {
  const resolved = executablePath(command)
  if (resolved === null) return null
  const rootPrefix = `${root}${path.sep}`
  return resolved.startsWith(rootPrefix) ? path.relative(root, resolved) : command
}

function measurement(
  command: string,
  executable: string,
  note: string,
  value: number | null = null,
): Measurement {
  const resolved = executableLabel(executable)
  return {
    command,
    availability: resolved === null ? "unavailable" : "available",
    executable: resolved,
    value,
    status: resolved === null ? "unavailable" : "not-run",
    note,
  }
}

function builtInMeasurement(command: string, note: string): Measurement {
  return {
    command,
    availability: "available",
    executable: "bun",
    value: null,
    status: "not-run",
    note,
  }
}

function measurements(totalLoc: number): Report["measurements"] {
  return {
    complexity: measurement(
      "scc --by-file --format json packages script",
      "scc",
      "Standard cyclomatic-complexity runner is not a repository dependency; install/configure it before publishing values.",
    ),
    halstead: measurement(
      "bunx --no-install typhonjs-escomplex packages script",
      "typhonjs-escomplex",
      "No Halstead runner is configured; null means unmeasured, not zero.",
    ),
    fileLoc: {
      command: "bun run quality:report",
      availability: "available",
      executable: "bun",
      value: totalLoc,
      status: "measured",
      note: "Measured by this report from tracked text files; binary assets have null per-file LOC.",
    },
    branchCoverage: builtInMeasurement(
      "bun test --coverage",
      "Bun can collect runtime coverage, but this inventory does not run tests or claim a coverage percentage.",
    ),
    crap: measurement(
      "bunx --no-install crap packages script",
      "crap",
      "CRAP requires branch coverage plus complexity input; no runner is configured.",
    ),
    mutation: measurement(
      "bunx --no-install stryker run",
      "stryker",
      "Mutation is intentionally not run in pull-request inventory; keep scheduled mutation recording separate.",
    ),
    duplicate: measurement(
      "bunx --no-install jscpd packages script",
      "jscpd",
      "No duplicate-code runner is configured; null means unmeasured, not zero duplication.",
    ),
    deadCode: measurement(
      "bun run lint:unused",
      "knip",
      "Knip is configured by the existing lint:unused script; this report does not reinterpret its findings as zero dead code.",
    ),
  }
}

function guardrails(summary: Record<Bucket, BucketSummary>): Record<EnforcedBucket, Guardrail> {
  return Object.fromEntries(
    enforcedBuckets.map((bucket) => {
      const current = summary[bucket]
      return [
        bucket,
        {
          maxFileLoc: current.maxFileLoc,
          filesAtOrAbove500Loc: current.filesAtOrAbove500Loc,
          anyTokens: current.anyTokens,
          unknownTokens: current.unknownTokens,
          files: current.files,
        },
      ]
    }),
  ) as Record<EnforcedBucket, Guardrail>
}

function compareGuardrails(
  current: Record<EnforcedBucket, Guardrail>,
  baseline: Record<EnforcedBucket, Guardrail>,
): string[] {
  const regressions: string[] = []
  for (const bucket of enforcedBuckets) {
    for (const metric of ["maxFileLoc", "filesAtOrAbove500Loc", "anyTokens", "unknownTokens"] as const) {
      if (current[bucket][metric] > baseline[bucket][metric]) {
        regressions.push(`${bucket}.${metric}: ${baseline[bucket][metric]} → ${current[bucket][metric]}`)
      }
    }
  }
  return regressions
}

async function loadBaseline(): Promise<Baseline> {
  if (!(await Bun.file(baselinePath).exists())) {
    throw new Error(`baseline missing at ${baselineRelativePath}; run \`bun run quality:baseline\``)
  }
  const baseline = (await Bun.file(baselinePath).json()) as Baseline
  if (baseline.schemaVersion !== 1 || baseline.scope.basis !== "git-tracked-files") {
    throw new Error(`unsupported quality baseline at ${baselineRelativePath}`)
  }
  return baseline
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function parseFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index === -1) return null
  const value = args[index + 1]
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function printText(report: Report, check: boolean): void {
  console.log("quality report (git-tracked files)")
  console.log("bucket       files  text  binary      LOC  >=500  any  unknown")
  for (const bucket of buckets) {
    const summary = report.buckets[bucket]
    console.log(
      `${bucket.padEnd(11)} ${String(summary.files).padStart(6)} ${String(summary.textFiles).padStart(6)} ${String(summary.binaryFiles).padStart(6)} ${String(summary.loc).padStart(9)} ${String(summary.filesAtOrAbove500Loc).padStart(6)} ${String(summary.anyTokens).padStart(5)} ${String(summary.unknownTokens).padStart(8)}`,
    )
  }

  console.log("\nmeasurement availability")
  for (const [name, metric] of Object.entries(report.measurements)) {
    const value = metric.value === null ? "unmeasured" : String(metric.value)
    console.log(`- ${name}: ${metric.availability}; ${value}; ${metric.command}`)
  }

  if (check) {
    if (report.regressions.length === 0) {
      console.log("\nbaseline check: pass (no new guardrail regressions)")
    } else {
      console.error("\nbaseline check: fail")
      for (const regression of report.regressions) console.error(`- ${regression}`)
    }
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const check = args.includes("--check")
  const writeBaseline = args.includes("--write-baseline")
  const format = parseFlag(args, "--format") ?? "text"
  const output = parseFlag(args, "--output")

  if (check && writeBaseline) throw new Error("--check and --write-baseline cannot be combined")
  if (format !== "text" && format !== "json") throw new Error(`unsupported format: ${format}`)

  const trackedFiles = await readTrackedFiles()
  const files = await Promise.all(trackedFiles.map(inspectFile))
  const summary = summarize(files)
  const report: Report = {
    schemaVersion: 1,
    scope: {
      basis: "git-tracked-files",
      root: ".",
      excluded: [...excludedPaths].sort(),
      includedAdditionalPaths,
      locDefinition: "UTF-8 text files counted by logical lines; trailing newline does not add an empty line; binary files have null per-file LOC.",
      tokenDefinition: "Lexical word matches in TypeScript-family files; comments and strings are included and counts are inventory signals, not type-check results.",
    },
    buckets: summary.buckets,
    totals: summary.totals,
    files,
    measurements: measurements(summary.totals.loc),
    guardrails: guardrails(summary.buckets),
    regressions: [],
  }

  if (check) {
    const baseline = await loadBaseline()
    report.regressions = compareGuardrails(report.guardrails, baseline.guardrails)
  }

  if (writeBaseline) {
    const baseline: Baseline = {
      schemaVersion: 1,
      scope: report.scope,
      guardrails: report.guardrails,
    }
    await writeJson(baselinePath, baseline)
    const writeMessage = format === "json" ? console.error : console.log
    writeMessage(`wrote ${baselineRelativePath}`)
  }

  if (output !== null) {
    await writeJson(path.resolve(root, output), report)
    const writeMessage = format === "json" ? console.error : console.log
    writeMessage(`wrote ${output}`)
  }

  if (format === "json") {
    console.log(JSON.stringify(report, null, 2))
  } else if (!writeBaseline) {
    printText(report, check)
  }

  return report.regressions.length > 0 ? 1 : 0
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
