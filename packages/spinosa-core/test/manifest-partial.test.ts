import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import {
  loadManifest,
  manifestPath,
  recordResult,
  reconcileManifest,
  hashSourceFile,
} from "../src/import/manifest"

function makeLogs(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "spinosa-manifest-"))
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("manifest partial state + integrity", () => {
  test("partial is preserved and only done skips", () => {
    const logs = makeLogs()
    try {
      const src = path.join(logs, "a.txt")
      writeFileSync(src, "hello")
      recordResult({ logsDir: logs, rel: "a.txt", ext: ".txt", route: "direct", status: "partial", srcFile: src, dest: "raw/a.txt", engine: "copy", pages: 12, completedPages: [1, 2, 3], pendingPages: [4] })
      const { records } = loadManifest(logs)
      expect(records.get("a.txt")?.status).toBe("partial")
      expect(records.get("a.txt")?.pendingPages).toEqual([4])
      const scan = [{ rel: "a.txt", srcFile: src, ext: ".txt" }]
      const r = reconcileManifest(records, scan)
      expect(r.untracked).toContain("a.txt")
      expect(r.unchanged).not.toContain("a.txt")
    } finally {
      rmSync(logs, { recursive: true, force: true })
    }
  })

  test("done with pendingPages degrades to partial (never done with gaps)", () => {
    const logs = makeLogs()
    try {
      const src = path.join(logs, "b.txt")
      writeFileSync(src, "hello")
      recordResult({ logsDir: logs, rel: "b.txt", ext: ".txt", route: "pdf", status: "done", srcFile: src, dest: "raw/b.md", engine: "pdfjs", pendingPages: [2] })
      const { records } = loadManifest(logs)
      expect(records.get("b.txt")?.status).toBe("partial")
    } finally {
      rmSync(logs, { recursive: true, force: true })
    }
  })

  test("content digest distinguishes same-stat edits", () => {
    const logs = makeLogs()
    try {
      const src = path.join(logs, "c.txt")
      writeFileSync(src, "version-one")
      const d1 = hashSourceFile(src)
      expect(d1).toMatch(/^[0-9a-f]{64}$/)
      recordResult({ logsDir: logs, rel: "c.txt", ext: ".txt", route: "direct", status: "done", srcFile: src, dest: "raw/c.txt", engine: "copy" })
      const { records } = loadManifest(logs)
      expect(records.get("c.txt")?.sha256).toBe(d1)
    } finally {
      rmSync(logs, { recursive: true, force: true })
    }
  })

  test("malformed lines never crash import (fuzz)", () => {
    const logs = makeLogs()
    try {
      const evil = [
        "",
        "not json",
        "[]",
        "42",
        "null",
        '{"rel":"","status":"done","bytes":1,"mtimeMs":1}',
        '{"rel":"x","status":"done-hax","bytes":1,"mtimeMs":1}',
        '{"rel":"x","status":"done","bytes":"1","mtimeMs":1}',
        '{"rel":"../escape","status":"done","bytes":1,"mtimeMs":1}',
        '{"rel":"x","status":"done","bytes":1,"mtimeMs":1,"sha256":"zzz"}',
        '{"rel":"x","status":"done","bytes":1,"mtimeMs":1,"pages":"12"}',
        '{"rel":"x","status":"done","bytes":1,"mtimeMs":1,"pendingPages":["a"]}',
        `{"rel":"${"a".repeat(5000)}","status":"done","bytes":1,"mtimeMs":1}`,
      ]
      writeFileSync(manifestPath(logs), `${evil.join("\n")}\n`)
      const { records, corruptLines } = loadManifest(logs)
      expect(records.size).toBe(0)
      expect(corruptLines).toBe(evil.filter((l) => l.trim().length > 0).length)
    } finally {
      rmSync(logs, { recursive: true, force: true })
    }
  })

  test("reroute / engine / model changes force retry", () => {
    const logs = makeLogs()
    try {
      const src = path.join(logs, "d.txt")
      writeFileSync(src, "hello")
      recordResult({ logsDir: logs, rel: "d.txt", ext: ".txt", route: "direct", status: "done", srcFile: src, dest: "raw/d.txt", engine: "copy", model: "m1" })
      const { records } = loadManifest(logs)
      const scan = [{ rel: "d.txt", srcFile: src, ext: ".txt" }]
      expect(reconcileManifest(records, scan).unchanged).toContain("d.txt")
      expect(
        reconcileManifest(records, scan, { route: new Map([["d.txt", "vision"]]) }).changed,
      ).toContain("d.txt")
      expect(
        reconcileManifest(records, scan, { engine: new Map([["d.txt", "vision-model"]]) }).changed,
      ).toContain("d.txt")
      expect(
        reconcileManifest(records, scan, { model: new Map([["d.txt", "m2"]]) }).changed,
      ).toContain("d.txt")
    } finally {
      rmSync(logs, { recursive: true, force: true })
    }
  })
})
