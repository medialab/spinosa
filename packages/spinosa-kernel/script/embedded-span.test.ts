import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  assertEmbeddedSpanIntact,
  assertNoEmbeddedBuildPaths,
  findEmbeddedSpans,
  resolveWorkspaceBundledModule,
  scanEmbeddedBuildPaths,
  scrubEmbeddedBuildPaths,
  sha256Hex,
  WORKSPACE_BUNDLED_MODULE_NAMES,
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

describe("workspace bundled modules (unzipper / markitdown-ts)", () => {
  test("resolve stays inside the repo and ignores HOME markitdown-ts", () => {
    const repoRoot = path.resolve(import.meta.dir, "../../..")
    const home = os.homedir()
    for (const name of WORKSPACE_BUNDLED_MODULE_NAMES) {
      const resolved = resolveWorkspaceBundledModule(name)
      expect(resolved.startsWith(repoRoot + path.sep)).toBe(true)
      expect(resolved.startsWith(path.join(home, "node_modules"))).toBe(false)
    }
  })

  test("unknown specifiers fail closed", () => {
    expect(() => resolveWorkspaceBundledModule("youtube-transcript")).toThrow(/not a workspace-bundled module/)
  })
})

describe("embedded native span protection (binary is never rewritten after compile)", () => {
  test("findEmbeddedSpans locates every pristine copy", () => {
    const needle = testNeedle()
    const { haystack, span } = fakeBinary(needle)
    expect(findEmbeddedSpans(haystack, needle)).toEqual([span])
    // Bun embeds the same file asset more than once: both copies protected.
    const doubled = Buffer.concat([haystack, Buffer.alloc(64, 0x41), needle])
    const second: EmbeddedSpan = {
      start: haystack.byteLength + 64,
      end: haystack.byteLength + 64 + needle.byteLength,
    }
    expect(findEmbeddedSpans(doubled, needle)).toEqual([span, second])
  })

  test("findEmbeddedSpans fails closed when absent or too small", () => {
    const haystack = Buffer.alloc(8192, 0x41)
    expect(() => findEmbeddedSpans(haystack, testNeedle())).toThrow(/not locatable/)
    expect(() => findEmbeddedSpans(haystack, Buffer.alloc(16, 0x44))).toThrow(/too small/)
  })

  test("scan is report-only and never mutates the binary (beta.18/beta.19 fix)", () => {
    const needle = testNeedle()
    const { haystack, span } = fakeBinary(needle)
    withTempFile(haystack, (file) => {
      const before = fs.readFileSync(file)
      const count = scanEmbeddedBuildPaths(file)
      expect(count).toBeGreaterThanOrEqual(1)
      const after = fs.readFileSync(file)
      expect(after.equals(before)).toBe(true)
      // Pristine embedded bytes stay intact without any exemption list.
      expect(after.subarray(span.start, span.end).equals(needle)).toBe(true)
      assertEmbeddedSpanIntact(file, span, sha256Hex(needle), "test blob")
    })
  })

  test("deprecated scrub alias is non-mutating (scan-only)", () => {
    const needle = testNeedle()
    const { haystack, span } = fakeBinary(needle)
    withTempFile(haystack, (file) => {
      const before = fs.readFileSync(file)
      scrubEmbeddedBuildPaths(file, [span])
      expect(fs.readFileSync(file).equals(before)).toBe(true)
    })
  })

  test("assert ignores generic builder paths but fails closed on personal markers", () => {
    // Generic builder path without any personal marker: report-only, no throw.
    withTempFile(Buffer.from("prefix /Users/runner/work/spinosa-main/some/path suffix", "utf-8"), (file) => {
      expect(() => assertNoEmbeddedBuildPaths(file, [])).not.toThrow()
    })
    // Personal markers fail closed in CI (release binaries must never carry
    // a maintainer username) and warn locally (local checkout paths do).
    const prevCI = process.env.CI
    process.env.CI = "1"
    try {
      withTempFile(Buffer.from("prefix tommasoprinetti suffix", "utf-8"), (file) => {
        expect(() => assertNoEmbeddedBuildPaths(file, [])).toThrow(/personal marker/)
      })
    } finally {
      if (prevCI === undefined) delete process.env.CI
      else process.env.CI = prevCI
    }
  })
})
