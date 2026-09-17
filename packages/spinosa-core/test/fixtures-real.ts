import { existsSync, readdirSync } from "node:fs"
import * as path from "node:path"

/**
 * Local real-file test corpus.
 *
 * Built by `scripts/anonymize-fixtures.ts` from hand-picked personal files
 * (scrubbed: PII redacted, faces blurred, metadata stripped, names hashed).
 * The folder is git-ignored and NEVER committed — tests that consume it must
 * skip green when absent (CI / fresh clones):
 *
 *   import { describe } from "bun:test"
 *   import { hasRealFixtures } from "./fixtures-real"
 *   describe.if(hasRealFixtures)("...", () => { ... })
 */
export const FIXTURES_REAL_DIR = path.join(__dirname, "fixtures-real")

export const hasRealFixtures =
  existsSync(FIXTURES_REAL_DIR) && existsSync(path.join(FIXTURES_REAL_DIR, "manifest.json"))

/** Relative paths (e.g. `pdf/doc-001.pdf`) of scrubbed files, sorted. Empty when absent. */
export function listRealFiles(subdir?: string): string[] {
  if (!hasRealFixtures) return []
  const root = subdir ? path.join(FIXTURES_REAL_DIR, subdir) : FIXTURES_REAL_DIR
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (e.name === "manifest.json") continue
      if (e.isDirectory()) walk(path.join(dir, e.name), prefix + e.name + "/")
      else out.push(prefix + e.name)
    }
  }
  walk(root, subdir ? subdir + "/" : "")
  return out
}
