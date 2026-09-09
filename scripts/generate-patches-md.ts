#!/usr/bin/env bun
/**
 * Regenerate patches/PATCHES.md from root package.json patchedDependencies.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8")) as {
  patchedDependencies?: Record<string, string>
}
const patched = pkg.patchedDependencies ?? {}
const entries = Object.entries(patched).sort(([a], [b]) => a.localeCompare(b))

const patchFiles = new Set(
  readdirSync(resolve(root, "patches"))
    .filter((name) => name.endsWith(".patch"))
    .map((name) => `patches/${name}`),
)

const rows: string[] = []
const orphanPatches: string[] = []
const missingPatches: string[] = []

const missingRationale: string[] = []
for (const [key, patchPath] of entries) {
  const at = key.lastIndexOf("@")
  const name = at > 0 ? key.slice(0, at) : key
  const version = at > 0 ? key.slice(at + 1) : "?"
  const abs = resolve(root, patchPath)
  if (!existsSync(abs)) missingPatches.push(patchPath)
  else {
    const head = readFileSync(abs, "utf-8").slice(0, 400)
    if (!/^# Why:/m.test(head)) missingRationale.push(patchPath)
  }
  rows.push(`| \`${name}\` | ${version} | \`${patchPath}\` |`)
}

for (const file of patchFiles) {
  if (!Object.values(patched).includes(file) && !Object.values(patched).some((p) => p.replace(/%2F/g, "/") === file.replace(/%2F/g, "/"))) {
    // Compare decoded forms — patchedDependencies uses URL-encoded paths
    const decoded = decodeURIComponent(file)
    const declared = Object.values(patched).some((p) => decodeURIComponent(p) === decoded || p === file)
    if (!declared) orphanPatches.push(file)
  }
}

const body = `# Patch Audit

Generated from \`package.json\` \`patchedDependencies\` (${entries.length} entries).
Do not edit the table by hand — run \`bun scripts/generate-patches-md.ts\`.

| Package | Version | Patch file |
|---------|---------|------------|
${rows.join("\n")}

## Policy

1. Every patch file MUST have a comment at the top explaining WHY it exists (2-3 lines).
2. Beta dependencies should be re-checked when they go stable.
3. Before upgrading any patched dependency, test with the patch removed to see if the upstream fix has landed.
4. New patches should only be added when no workaround exists and the fix cannot be upstreamed within a reasonable timeframe.

## Drift checks

- Missing patch files: ${missingPatches.length ? missingPatches.map((p) => `\`${p}\``).join(", ") : "none"}
- Orphan patch files (not in patchedDependencies): ${orphanPatches.length ? orphanPatches.map((p) => `\`${p}\``).join(", ") : "none"}
- Missing rationale headers (\`# Why:\`): ${missingRationale.length ? missingRationale.map((p) => `\`${p}\``).join(", ") : "none"}
`

writeFileSync(resolve(root, "patches/PATCHES.md"), body)
console.log(`✓ Wrote patches/PATCHES.md (${entries.length} patches)`)
if (missingPatches.length || orphanPatches.length || missingRationale.length) {
  console.error("Warning: patch manifest drift detected")
  process.exitCode = 1
}
