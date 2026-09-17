#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import {
  buildTemplatePackMeta,
  listFrameworkManifestFiles,
} from "../packages/spinosa-core/src/framework/template-pack.ts"
import { releaseTemplateInputs } from "./release/template-inputs"

const root = path.resolve(import.meta.dir, "..")
const failures: string[] = []

const relative = (filePath: string): string => path.relative(root, filePath).split(path.sep).join("/")

function fail(message: string): void {
  failures.push(message)
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T
}

function capture(source: string, pattern: RegExp, label: string): string | undefined {
  const match = source.match(pattern)
  if (!match?.[1]) fail(`${label} is missing`)
  return match?.[1]
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort()
}

function compareSets(label: string, expected: Iterable<string>, actual: Iterable<string>): void {
  const expectedValues = sorted(expected)
  const actualValues = sorted(actual)
  if (expectedValues.length === actualValues.length && expectedValues.every((value, index) => value === actualValues[index])) {
    return
  }
  const expectedSet = new Set(expectedValues)
  const actualSet = new Set(actualValues)
  const missing = expectedValues.filter((value) => !actualSet.has(value)).slice(0, 5)
  const unexpected = actualValues.filter((value) => !expectedSet.has(value)).slice(0, 5)
  const detail = [
    missing.length > 0 ? `missing=${missing.join(",")}` : "",
    unexpected.length > 0 ? `unexpected=${unexpected.join(",")}` : "",
  ].filter(Boolean)
  fail(`${label} differs (${detail.join("; ") || "duplicate entries"})`)
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(filePath))
    else if (entry.isFile()) files.push(filePath)
  }
  return files
}

function checkTemplatePack(): void {
  const packageManifest = readJson<{ version?: unknown }>(path.join(root, "package.json"))
  if (typeof packageManifest.version !== "string") {
    fail("package.json version is missing")
    return
  }

  const templateRoot = path.join(root, "workspace-template")
  const manifestFiles = releaseTemplateInputs(root, listFrameworkManifestFiles(templateRoot))
  const expected = buildTemplatePackMeta(packageManifest.version, manifestFiles)
  const metadataPath = path.join(root, "packages/spinosa-kernel/src/generated/template-pack-meta.json")
  const generatedPath = path.join(root, "packages/spinosa-kernel/src/generated/template-pack.gen.ts")
  const blobDirectory = path.join(root, "packages/spinosa-kernel/src/generated/template-blobs")
  const metadata = readJson<{ version?: unknown; packId?: unknown; fileCount?: unknown }>(metadataPath)
  const generated = readFileSync(generatedPath, "utf8")

  for (const [label, actual, expectedValue] of [
    ["template metadata version", metadata.version, expected.version],
    ["template metadata packId", metadata.packId, expected.packId],
    ["template metadata fileCount", metadata.fileCount, expected.files.length],
  ] as const) {
    if (actual !== expectedValue) fail(`${label}: expected ${expectedValue}, got ${actual}`)
  }

  const generatedVersion = capture(generated, /\bversion:\s*"([^"]+)"/, "generated template version")
  const generatedPackId = capture(generated, /\bpackId:\s*"([^"]+)"/, "generated template packId")
  if (generatedVersion !== expected.version) fail(`generated template version: expected ${expected.version}, got ${generatedVersion}`)
  if (generatedPackId !== expected.packId) fail(`generated template packId: expected ${expected.packId}, got ${generatedPackId}`)

  const generatedEntries = [...generated.matchAll(/\{\s*path:\s*"([^"]+)"\s*,\s*mode:\s*\d+\s*,\s*sha256:\s*"([a-f0-9]{64})"/g)]
  if (generatedEntries.length !== expected.files.length) {
    fail(`generated template entry count: expected ${expected.files.length}, got ${generatedEntries.length}`)
  }
  compareSets(
    "generated template entries",
    expected.files.map((file) => `${file.path}\0${file.sha256}`),
    generatedEntries.map(([, filePath, sha256]) => `${filePath}\0${sha256}`),
  )

  const expectedBlobs = new Set(expected.files.map((file) => `${file.sha256}.bin`))
  const currentBlobs = readdirSync(blobDirectory).filter((file) => file.endsWith(".bin"))
  compareSets("template blob files", expectedBlobs, currentBlobs)
  const generatedBlobs = new Set([...generated.matchAll(/template-blobs\/([a-f0-9]{64})\.bin/g)].map(([, sha256]) => `${sha256}.bin`))
  compareSets("generated template imports", expectedBlobs, generatedBlobs)
}

function checkGeneratedHeaders(): void {
  const generatedRoots = [
    path.join(root, "packages/sdk/src/gen"),
    path.join(root, "packages/sdk/src/v2/gen"),
    path.join(root, "packages/spinosa-kernel/src/generated"),
  ]
  for (const directory of generatedRoots) {
    const sourceFiles = walkFiles(directory).filter((filePath) => filePath.endsWith(".ts"))
    if (sourceFiles.length === 0) fail(`generated source root is empty: ${relative(directory)}`)
    for (const filePath of sourceFiles) {
      const header = readFileSync(filePath, "utf8").slice(0, 1_000)
      if (!/@generated|auto[- ]generated/i.test(header)) {
        fail(`missing generated header: ${relative(filePath)}`)
      }
    }
  }
}

function checkArityData(): void {
  const arityPath = path.join(root, "packages/spinosa-kernel/src/permission/arity.ts")
  const source = readFileSync(arityPath, "utf8")
  const marker = "@generated-data version=2026-09-01; source=reviewed command-prefix arity catalog"
  if (!source.includes(marker)) fail(`arity catalog marker missing: ${relative(arityPath)}`)
  if (/Generated with following prompt|DO NOT MAKE ANY OTHER COMMENTS/i.test(source)) {
    fail(`arity catalog still contains the generator prompt: ${relative(arityPath)}`)
  }
}

function checkProductionComments(): void {
  const banned = [
    /MUST[ _-]?FIX/i,
    /TODO:\s*clean this up/i,
    /TODO:\s*.*for some reason/i,
  ]
  const sourceFiles = walkFiles(path.join(root, "packages"))
    .filter((filePath) => /\/src\/[^/].*\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath))
    .filter((filePath) => !/(?:\/generated\/|\/gen\/|\.gen\.(?:ts|tsx|js|jsx)$)/.test(filePath))
    .filter((filePath) => !/(?:\/test\/|\.(?:test|spec)\.(?:ts|tsx|js|jsx)$)/.test(filePath))
  for (const filePath of sourceFiles) {
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (banned.some((pattern) => pattern.test(line))) {
        fail(`unresolved hygiene marker: ${relative(filePath)}:${index + 1}`)
      }
    }
  }
}

checkTemplatePack()
checkGeneratedHeaders()
checkArityData()
checkProductionComments()

if (failures.length > 0) {
  console.error("Generated-data checks failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log("✓ generated-data checks passed (template pack, generated headers, arity data, and source markers)")
}
