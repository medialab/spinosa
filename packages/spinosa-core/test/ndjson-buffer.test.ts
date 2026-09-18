import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { appendNdjson, flushNdjson } from "../src/import/ndjson-buffer"

describe("ndjson buffer", () => {
  test("flushes batched diagnostic lines", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "spinosa-ndjson-"))
    const file = path.join(dir, "log.ndjson")
    try {
      appendNdjson(file, { a: 1 })
      appendNdjson(file, { b: 2 })
      flushNdjson(file)
      const text = readFileSync(file, "utf-8")
      expect(text).toContain('"a":1')
      expect(text).toContain('"b":2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
