import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { shouldSkipTemplateCopyEntry, writeTextAtomic } from "../utils/fs"
import { resolvePathWithinRoot } from "../utils/path"
import { readFrameworkFilesTsv, type FrameworkManifestEntry } from "./manifest"

export const FRAMEWORK_CHECKSUMS_RELPATH = ".spinosa/framework-checksums.json"

export type FrameworkChecksums = Record<string, string>

/** Agent / config names retired when Pilosa was renamed to Spinosa. */
const RETIRED_MANAGED_NAME = /(^|\/)pilosa([-_.]|$)/i

export function isRetiredManagedName(relativePath: string): boolean {
  const base = path.basename(relativePath)
  return RETIRED_MANAGED_NAME.test(relativePath) || RETIRED_MANAGED_NAME.test(base)
}

export function readFrameworkChecksums(wsPath: string): FrameworkChecksums {
  const p = path.join(wsPath, FRAMEWORK_CHECKSUMS_RELPATH)
  if (!existsSync(p)) return {}
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: FrameworkChecksums = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)) out[key] = value.toLowerCase()
    }
    return out
  } catch {
    return {}
  }
}

export function writeFrameworkChecksums(wsPath: string, checksums: FrameworkChecksums): void {
  const p = path.join(wsPath, FRAMEWORK_CHECKSUMS_RELPATH)
  mkdirSync(path.dirname(p), { recursive: true })
  writeTextAtomic(p, JSON.stringify(checksums, null, 2) + "\n")
}

export function sha256File(filePath: string): string {
  const hash = createHash("sha256")
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const fd = openSync(filePath, "r")
  try {
    let bytesRead = 0
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest("hex")
}

export function filesMatch(a: string, b: string): boolean {
  try {
    const sa = statSync(a)
    const sb = statSync(b)
    if (sa.size !== sb.size) return false
    if (!sa.isFile() || !sb.isFile()) return false
    return sha256File(a) === sha256File(b)
  } catch {
    return false
  }
}

/** List managed files under a manifest path in `root` (template or workspace). */
export function managedFilesUnder(root: string, relativePath: string): string[] {
  const start = resolvePathWithinRoot(root, relativePath, "framework manifest path")
  if (!existsSync(start)) return []
  const result: string[] = []

  const visit = (absolute: string, relative: string) => {
    const stat = statSync(absolute)
    if (stat.isFile()) {
      result.push(relative)
      return
    }
    if (!stat.isDirectory()) return
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (shouldSkipTemplateCopyEntry(entry.name, entry.isDirectory())) continue
      const childRelative = path.join(relative, entry.name)
      const child = resolvePathWithinRoot(root, childRelative, "framework manifest path")
      visit(child, childRelative)
    }
  }

  visit(start, relativePath.replace(/[\\/]$/, ""))
  return result
}

/** Checksums for template files that currently match the workspace copy. */
export function computeMatchingFrameworkChecksums(
  templateRoot: string,
  workspacePath: string,
  entries?: FrameworkManifestEntry[],
): FrameworkChecksums {
  const fwEntries = entries ?? readFrameworkFilesTsv(
    path.join(templateRoot, ".spinosa", "workspace-files.tsv"),
  )
  const sourceHashCache = new Map<string, string>()
  const checksums: FrameworkChecksums = {}
  const seen = new Set<string>()
  for (const entry of fwEntries) {
    if (entry.role === "user_state" || entry.policy === "exclude_from_update") continue
    for (const relativeFile of managedFilesUnder(templateRoot, entry.path)) {
      if (seen.has(relativeFile)) continue
      seen.add(relativeFile)
      const sourceFile = resolvePathWithinRoot(templateRoot, relativeFile, "framework manifest path")
      const workspaceFile = resolvePathWithinRoot(workspacePath, relativeFile, "framework manifest path")
      let sourceStat
      let workspaceStat
      try {
        sourceStat = statSync(sourceFile)
        workspaceStat = statSync(workspaceFile)
      } catch {
        continue
      }
      if (!sourceStat.isFile() || !workspaceStat.isFile()) continue
      if (sourceStat.size !== workspaceStat.size) continue
      let sourceHash = sourceHashCache.get(sourceFile)
      if (!sourceHash) {
        sourceHash = sha256File(sourceFile)
        sourceHashCache.set(sourceFile, sourceHash)
      }
      const hash = sha256File(workspaceFile)
      if (hash !== sourceHash) continue
      checksums[relativeFile] = hash
    }
  }
  return checksums
}

/** Seed checksum baseline after workspace create / successful update. */
export function recordFrameworkChecksums(templateRoot: string, workspacePath: string): FrameworkChecksums {
  const checksums = computeMatchingFrameworkChecksums(templateRoot, workspacePath)
  writeFrameworkChecksums(workspacePath, checksums)
  return checksums
}
