import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, statSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { allocateDestinations, allocateDestinationsStable, existingOutputBelongsToSource, persistDestMap, loadDestMap, shouldSkipDestWalkDir } from "../src/import/destinations"

function makeWs(): string {
  const ws = mkdtempSync(path.join(tmpdir(), "spinosa-dest-"))
  mkdirSync(path.join(ws, "raw"), { recursive: true })
  mkdirSync(path.join(ws, ".logs"), { recursive: true })
  return ws
}

describe("destination allocation", () => {
  test("case-insensitive collisions disambiguate globally", () => {
    const ws = makeWs()
    try {
      const a = path.join(ws, "a.txt")
      const b = path.join(ws, "b.txt")
      writeFileSync(a, "a")
      writeFileSync(b, "b")
      const allocs = allocateDestinations(
        [
          { rel: "Report.txt", srcFile: a, desiredDest: path.join(ws, "raw", "Report.md") },
          { rel: "report.txt", srcFile: b, desiredDest: path.join(ws, "raw", "report.md") },
        ],
        ws,
      )
      expect(allocs[0]!.dest).not.toBe(allocs[1]!.dest)
      expect(allocs[1]!.disambiguated).toBe(true)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  test("existing workspace files and page dirs are reserved", () => {
    const ws = makeWs()
    try {
      writeFileSync(path.join(ws, "raw", "doc.md"), "existing")
      mkdirSync(path.join(ws, "raw", "doc"), { recursive: true })
      const src = path.join(ws, "src.pdf")
      writeFileSync(src, "pdf")
      const allocs = allocateDestinations(
        [{ rel: "doc.pdf", srcFile: src, desiredDest: path.join(ws, "raw", "doc.md") }],
        ws,
      )
      expect(allocs[0]!.dest).not.toBe(path.join(ws, "raw", "doc.md"))
      expect(allocs[0]!.disambiguated).toBe(true)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  test("dest map persists and ownership requires same source", () => {    const ws = makeWs()
    try {
      const src = path.join(ws, "s.txt")
      writeFileSync(src, "v1")
      const dest = path.join(ws, "raw", "s.md")
      writeFileSync(dest, "out")
      const logs = path.join(ws, ".logs")
      persistDestMap(logs, [{ rel: "s.txt", srcFile: src, desiredDest: dest, dest, disambiguated: false }])
      expect(loadDestMap(logs)["s.txt"]).toBe(dest)
      expect(existingOutputBelongsToSource(dest, src, undefined)).toBe(false)
      const stat = statSync(src)
      expect(existingOutputBelongsToSource(dest, src, { bytes: stat.size, mtimeMs: stat.mtimeMs })).toBe(true)
      expect(existingOutputBelongsToSource(dest, src, { bytes: -1, mtimeMs: stat.mtimeMs })).toBe(false)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  test("allocation is stable across runs (own outputs do not force rename)", () => {
    const ws = makeWs()
    try {
      const logs = path.join(ws, ".logs")
      mkdirSync(logs, { recursive: true })
      const src = path.join(ws, "a.txt")
      writeFileSync(src, "a")
      const desired = path.join(ws, "raw", "a.md")
      const first = allocateDestinationsStable(
        [{ rel: "a.txt", srcFile: src, desiredDest: desired }],
        ws,
        loadDestMap(logs),
      )
      expect(first[0]!.dest).toBe(desired)
      persistDestMap(logs, first)
      // Simulate delivered output, then re-run: dest must not change.
      writeFileSync(desired, "out")
      const second = allocateDestinationsStable(
        [{ rel: "a.txt", srcFile: src, desiredDest: desired }],
        ws,
        loadDestMap(logs),
      )
      expect(second[0]!.dest).toBe(desired)
      expect(second[0]!.disambiguated).toBe(false)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  test("destination walk skips heavy directories", () => {
    expect(shouldSkipDestWalkDir("node_modules")).toBe(true)
    expect(shouldSkipDestWalkDir("dist")).toBe(true)
    expect(shouldSkipDestWalkDir(".git")).toBe(true)
    expect(shouldSkipDestWalkDir("raw")).toBe(false)
  })
})
