import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from "node:fs"
import * as path from "node:path"
import { tmpdir } from "node:os"
import {
  loadManifest,
  manifestPath,
  pruneManifest,
  reconcileManifest,
  recordResult,
  type ManifestRecord,
} from "../src/import/manifest"

function makeLogs(): { root: string; logsDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-manifest-"))
  const logsDir = path.join(root, ".logs")
  mkdirSync(logsDir, { recursive: true })
  return { root, logsDir }
}

function makeSource(root: string, rel: string, content: string): string {
  const src = path.join(root, "source", rel)
  mkdirSync(path.dirname(src), { recursive: true })
  writeFileSync(src, content)
  return src
}

describe("import manifest", () => {
  test("missing file loads empty, corrupt lines are skipped", () => {
    const { root, logsDir } = makeLogs()
    try {
      const empty = loadManifest(logsDir)
      expect(empty.records.size).toBe(0)
      expect(empty.corruptLines).toBe(0)
      writeFileSync(manifestPath(logsDir), `not json\n{"rel":"","status":"done","bytes":1,"mtimeMs":2}\n`)
      const loaded = loadManifest(logsDir)
      expect(loaded.records.size).toBe(0)
      expect(loaded.corruptLines).toBe(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("latest line per rel wins (append history)", () => {
    const { root, logsDir } = makeLogs()
    try {
      const src = makeSource(root, "a.txt", "hello")
      recordResult({ logsDir, rel: "a.txt", ext: "txt", route: "direct", status: "failed", srcFile: src, dest: "raw/a.txt", engine: "direct" })
      recordResult({ logsDir, rel: "a.txt", ext: "txt", route: "direct", status: "done", srcFile: src, dest: "raw/a.txt", engine: "direct" })
      const { records } = loadManifest(logsDir)
      expect(records.size).toBe(1)
      expect(records.get("a.txt")!.status).toBe("done")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("reconcile splits unchanged / changed / removed / untracked; failures retry", () => {
    const { root, logsDir } = makeLogs()
    try {
      const same = makeSource(root, "same.txt", "same content")
      const edited = makeSource(root, "edited.txt", "v1")
      const gone = makeSource(root, "gone.txt", "gone")
      const failed = makeSource(root, "failed.png", "bytes")
      const rec = (rel: string, src: string, status: ManifestRecord["status"]) =>
        recordResult({ logsDir, rel, ext: "txt", route: "direct", status, srcFile: src, dest: `raw/${rel}`, engine: "direct" })
      rec("same.txt", same, "done")
      rec("edited.txt", edited, "done")
      rec("gone.txt", gone, "done")
      rec("failed.png", failed, "failed")
      // Edit one file (content + mtime change).
      writeFileSync(edited, "v1 with more content here")
      const now = new Date(Date.now() + 5000)
      utimesSync(edited, now, now)
      rmSync(gone)
      const { records } = loadManifest(logsDir)
      const result = reconcileManifest(records, [
        { rel: "same.txt", srcFile: same, ext: "txt" },
        { rel: "edited.txt", srcFile: edited, ext: "txt" },
        { rel: "failed.png", srcFile: failed, ext: "png" },
        { rel: "brand-new.txt", srcFile: makeSource(root, "brand-new.txt", "new"), ext: "txt" },
      ])
      expect(result.unchanged).toEqual(["same.txt"])
      expect(result.changed).toEqual(["edited.txt"])
      expect(result.removed).toEqual(["gone.txt"])
      expect(result.untracked.sort()).toEqual(["brand-new.txt", "failed.png"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("pruneManifest drops removed rels and keeps the rest", () => {
    const { root, logsDir } = makeLogs()
    try {
      const a = makeSource(root, "a.txt", "a")
      const b = makeSource(root, "b.txt", "b")
      for (const [rel, src] of [["a.txt", a], ["b.txt", b]] as const) {
        recordResult({ logsDir, rel, ext: "txt", route: "direct", status: "done", srcFile: src, dest: `raw/${rel}`, engine: "direct" })
      }
      expect(pruneManifest(logsDir, ["b.txt", "ghost.txt"])).toBe(1)
      const { records } = loadManifest(logsDir)
      expect([...records.keys()]).toEqual(["a.txt"])
      expect(existsSync(manifestPath(logsDir))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
