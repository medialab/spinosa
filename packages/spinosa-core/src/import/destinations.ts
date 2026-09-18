/**
 * Destination allocation (release hardening #12–13).
 *
 * Phase order: scan → classify → calculate desired dest → globally reserve →
 * disambiguate → process. Uniqueness considers all current import files,
 * existing workspace files, case-insensitive equality, UTF-8 truncation,
 * generated PDF page directories, and retained binary originals. The resolved
 * mapping is persisted to logsDir/dest-map.json. Output ownership (source →
 * dest) is stored in the manifest; existing outputs are adopted only when
 * they belong to the same source (content digest or fingerprint match).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { hashSourceFile } from "./manifest"

export const DEST_MAP_FILENAME = "dest-map.json"

export type DestAllocation = {
  rel: string
  srcFile: string
  desiredDest: string
  dest: string
  disambiguated: boolean
}

function foldKey(p: string): string {
  return p.toLowerCase()
}

const DEST_WALK_SKIP = new Set([
  ".logs",
  ".spinosa",
  ".git",
  ".trash",
  "node_modules",
  "dist",
  "Library",
  "Caches",
])

export function shouldSkipDestWalkDir(name: string): boolean {
  return DEST_WALK_SKIP.has(name)
}

function collectWorkspaceFiles(workspaceDir: string, maxFiles = 20000): Set<string> {
  const taken = new Set<string>()
  const stack = [workspaceDir]
  let count = 0
  while (stack.length > 0 && count < maxFiles) {
    const dir = stack.pop()!
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (shouldSkipDestWalkDir(name)) continue
      const abs = path.join(dir, name)
      let stat: { isDirectory(): boolean } | undefined
      try {
        stat = statSync(abs)
      } catch {
        continue
      }
      // Directories reserve too: a generated PDF page dir (raw/doc/) must
      // collide with a markdown dest (raw/doc.md) and vice versa.
      taken.add(foldKey(path.relative(workspaceDir, abs)))
      if (++count >= maxFiles) break
      if (stat.isDirectory()) {
        stack.push(abs)
      }
    }
  }
  return taken
}

function siblingVariants(destRel: string): string[] {
  // A markdown output reserves its page directory + binary original sibling.
  const out = [destRel]
  if (destRel.endsWith(".md")) {
    out.push(destRel.slice(0, -3))
    out.push(destRel.slice(0, -3) + ".png")
  }
  const base = destRel.replace(/\.[^.]+$/, "")
  out.push(`${base}.pdf`)
  return out
}

/** Globally reserve destinations across all routes + workspace files. */
export function allocateDestinations(
  entries: Array<{ rel: string; srcFile: string; desiredDest: string }>,
  workspaceDir: string,
): DestAllocation[] {
  return allocateDestinationsStable(entries, workspaceDir)
}

/**
 * Stable variant: entries whose rel already resolved to a dest in a prior run
 * (persisted dest-map) keep that dest, so resume runs converge instead of
 * disambiguating against the import's own previous outputs. First rel wins on
 * conflict; everything else allocates globally as usual.
 *
 * A workspace file sitting exactly at an entry's own desired dest is NOT a
 * collision: adopting vs overwriting that output is the phase runner's
 * decision (manifest ownership), not the allocator's. All other overlaps —
 * other entries' dests, page dirs, binary originals, unrelated workspace
 * files — disambiguate as usual.
 */
export function allocateDestinationsStable(
  entries: Array<{ rel: string; srcFile: string; desiredDest: string }>,
  workspaceDir: string,
  priorMap?: Record<string, string>,
): DestAllocation[] {
  const taken = collectWorkspaceFiles(workspaceDir)
  const claimed = new Set<string>()
  const out: DestAllocation[] = []
  const foldRel = (abs: string): string => foldKey(path.relative(workspaceDir, abs) || path.basename(abs))
  const reserve = (relKey: string): void => {
    claimed.add(relKey)
    for (const v of siblingVariants(relKey)) claimed.add(v)
  }
  const preclaimed = new Map<string, string>()
  if (priorMap) {
    for (const entry of entries) {
      const prior = priorMap[entry.rel]
      if (!prior) continue
      if (preclaimed.has(entry.rel)) continue
      const priorAbs = path.isAbsolute(prior) ? prior : path.join(workspaceDir, prior)
      const key = foldRel(priorAbs)
      // Free this entry's own prior outputs so stability wins over the
      // workspace-taken set (which includes our own previous outputs).
      taken.delete(key)
      for (const v of siblingVariants(key)) taken.delete(v)
      if (!taken.has(key) && !claimed.has(key)) {
        preclaimed.set(entry.rel, priorAbs)
        taken.add(key)
        reserve(key)
      }
    }
  }
  for (const entry of entries) {
    const kept = preclaimed.get(entry.rel)
    if (kept) {
      out.push({ rel: entry.rel, srcFile: entry.srcFile, desiredDest: entry.desiredDest, dest: kept, disambiguated: kept !== entry.desiredDest })
      continue
    }
    const relDest = path.relative(workspaceDir, entry.desiredDest) || path.basename(entry.desiredDest)
    const ownKey = foldKey(relDest)
    // Own desired dest never collides with itself (runner decides adopt vs
    // overwrite); everything claimed by another entry or present in the
    // workspace under a different name still collides.
    const collides = (key: string): boolean =>
      key === ownKey ? claimed.has(key) : taken.has(key) || claimed.has(key)
    const dir = path.dirname(relDest)
    const ext = path.extname(relDest)
    let candidate = relDest
    let disambiguated = false
    let i = 0
    while ([candidate, ...siblingVariants(candidate)].some((v) => collides(foldKey(v)))) {
      i++
      if (i > 9999) break
      const stem = path.basename(relDest, ext).replace(/_\d+$/, "")
      candidate = path.join(dir, `${stem}_${i}${ext}`)
      disambiguated = true
    }
    reserve(foldKey(candidate))
    taken.add(foldKey(candidate))
    out.push({
      rel: entry.rel,
      srcFile: entry.srcFile,
      desiredDest: entry.desiredDest,
      dest: path.join(workspaceDir, candidate),
      disambiguated,
    })
  }
  return out
}

/** Persist the resolved source→dest mapping for resume/debugging. */
export function persistDestMap(logsDir: string, allocations: DestAllocation[]): string {
  mkdirSync(logsDir, { recursive: true })
  const file = path.join(logsDir, DEST_MAP_FILENAME)
  const map: Record<string, string> = {}
  for (const a of allocations) map[a.rel] = a.dest
  writeFileSync(file, `${JSON.stringify({ version: 1, map }, null, 2)}\n`, "utf-8")
  return file
}

export function loadDestMap(logsDir: string): Record<string, string> {
  try {
    const raw = readFileSync(path.join(logsDir, DEST_MAP_FILENAME), "utf-8")
    const obj = JSON.parse(raw) as { map?: Record<string, string> }
    if (obj && typeof obj.map === "object" && obj.map) return obj.map
  } catch {}
  return {}
}

/**
 * Adopt an existing output only when it belongs to the same source.
 * Returns true when the existing dest may be kept without reprocessing.
 */
export function existingOutputBelongsToSource(
  destAbs: string,
  srcFile: string,
  record?: { sha256?: string; bytes?: number; mtimeMs?: number },
): boolean {
  if (!existsSync(destAbs)) return false
  if (!record) return false
  try {
    const stat = statSync(srcFile)
    if (record.bytes !== undefined && record.bytes !== stat.size) return false
    if (record.mtimeMs !== undefined && record.mtimeMs !== stat.mtimeMs) return false
  } catch {
    return false
  }
  if (record.bytes !== undefined && record.mtimeMs !== undefined) return true
  if (record.sha256) {
    const digest = hashSourceFile(srcFile)
    if (!digest || digest !== record.sha256) return false
  }
  return true
}
