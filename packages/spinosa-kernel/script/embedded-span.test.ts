import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  assertEmbeddedSpanIntact,
  assertNoEmbeddedBuildPaths,
  findEmbeddedSpan,
  scrubEmbeddedBuildPaths,
  sha256Hex,
  type EmbeddedSpan,
} from "./build.ts"

const homePrefix = os.homedir().replaceAll("\\", "/").replace(/\/$/, "")

function withTempFile(contents: Buffer, run: (file: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrub-test-"))
  try {
    const file = path.join(dir, "fake-binary")
    fs.writeFileSync(file, contents)
    run(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Deterministic varied fill so embedded-span slices are unique. */
function variedFill(size: number, seed: number): Buffer {
  const out = Buffer.alloc(size)
  let state = seed >>> 0
  for (let i = 0; i < size; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    out[i] = 0x20 + (state % 0x5f)
  }
  return out
}

/** Synthetic "binary": filler + pristine blob (with a home path inside) + filler. */
function fakeBinary(needle: Buffer): { haystack: Buffer; span: EmbeddedSpan } {
  const pad = Buffer.alloc(4096, 0x41)
  const haystack = Buffer.concat([pad, needle, pad, Buffer.from(`${homePrefix}/outside/path`, "utf-8"), pad])
  const span: EmbeddedSpan = { start: pad.byteLength, end: pad.byteLength + needle.byteLength }
  return { haystack, span }
}

function testNeedle(): Buffer {
  return Buffer.concat([variedFill(2 * 1048576, 12345), Buffer.from(`${homePrefix}/kept/inside`, "utf-8")])
}

describe("embedded native span protection (scrub must not touch staged .node bytes)", () => {
  test("findEmbeddedSpan locates the unique pristine span", () => {
    const needle = testNeedle()
    const { haystack, span } = fakeBinary(needle)
    expect(findEmbeddedSpan(haystack, needle)).toEqual(span)
  })

  test("findEmbeddedSpan fails closed when absent or ambiguous", () => {
    const haystack = Buffer.alloc(8192, 0x41)
    expect(() => findEmbeddedSpan(haystack, Buffer.alloc(8192, 0x42))).toThrow(/not uniquely locatable/)
    const twice = Buffer.concat([Buffer.alloc(8192, 0x43), Buffer.alloc(8192, 0x43)])
    expect(() => findEmbeddedSpan(twice, Buffer.alloc(8192, 0x43))).toThrow(/not uniquely locatable/)
    expect(() => findEmbeddedSpan(haystack, Buffer.alloc(16, 0x44))).toThrow(/too small/)
  })

  test("scrub preserves the protected span and still scrubs outside it", () => {
    const needle = testNeedle()
    const { haystack, span } = fakeBinary(needle)
    withTempFile(haystack, (file) => {
      const count = scrubEmbeddedBuildPaths(file, [span])
      expect(count).toBe(1)
      const out = fs.readFileSync(file)
      // Outside the span: scrubbed to /spinosa + underscores.
      expect(out.includes(Buffer.from(`${homePrefix}/outside/path`, "utf-8"))).toBe(false)
      // Inside the span: byte-identical to pristine.
      expect(out.subarray(span.start, span.end).equals(needle)).toBe(true)
      assertNoEmbeddedBuildPaths(file, [span])
      assertEmbeddedSpanIntact(file, span, sha256Hex(needle), "test blob")
    })
  })

  test("scrub without span exemption clobbers the blob (the beta.18 failure)", () => {
    const needle = testNeedle()
    const { haystack, span } = fakeBinary(needle)
    withTempFile(haystack, (file) => {
      scrubEmbeddedBuildPaths(file)
      const out = fs.readFileSync(file)
      expect(out.subarray(span.start, span.end).equals(needle)).toBe(false)
      expect(() => assertEmbeddedSpanIntact(file, span, sha256Hex(needle), "test blob")).toThrow(/altered/)
    })
  })

  test("assert fails closed on unexempted leftovers", () => {
    withTempFile(Buffer.from(`prefix ${homePrefix}/leftover suffix`, "utf-8"), (file) => {
      expect(() => assertNoEmbeddedBuildPaths(file, [])).toThrow(/still contains/)
    })
  })
})
