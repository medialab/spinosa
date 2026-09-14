import { describe, expect, test, afterEach } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { tmpdir } from "node:os"
import {
  bundledLegacyToolPath,
  bundledTessdataDir,
  bundledToolPath,
  bundledToolsRoot,
  ensureBundledToolsEnv,
  resolveTesseract,
  tesseractSource,
  toolsPlatformTag,
  verifyBundledTools,
} from "../src/distribution/tools"

const ORIGINAL_PATH = process.env.PATH
const ORIGINAL_TESSDATA = process.env.TESSDATA_PREFIX
const ORIGINAL_TOOLS_DIR = process.env.SPINOSA_TOOLS_DIR

afterEach(() => {
  if (ORIGINAL_PATH === undefined) delete process.env.PATH
  else process.env.PATH = ORIGINAL_PATH
  if (ORIGINAL_TESSDATA === undefined) delete process.env.TESSDATA_PREFIX
  else process.env.TESSDATA_PREFIX = ORIGINAL_TESSDATA
  if (ORIGINAL_TOOLS_DIR === undefined) delete process.env.SPINOSA_TOOLS_DIR
  else process.env.SPINOSA_TOOLS_DIR = ORIGINAL_TOOLS_DIR
})

function makeToolsHome(opts?: { bin?: boolean; langs?: string[] }): { home: string; root: string } {
  const home = mkdtempSync(path.join(tmpdir(), "spinosa-tools-"))
  const root = path.join(home, "tools", toolsPlatformTag()!)
  if (opts?.bin) {
    mkdirSync(path.join(root, "bin"), { recursive: true })
    const p = path.join(root, "bin", "tesseract")
    writeFileSync(p, "#!/bin/sh\nexit 0\n")
    chmodSync(p, 0o755)
  }
  if (opts?.langs) {
    mkdirSync(path.join(root, "tessdata"), { recursive: true })
    for (const lang of opts.langs) writeFileSync(path.join(root, "tessdata", `${lang}.traineddata`), "data")
  }
  return { home, root }
}

describe("bundled tools resolution", () => {
  test("toolsPlatformTag mirrors installer mapping", () => {
    expect(toolsPlatformTag("darwin", "arm64")).toBe("darwin-arm64")
    expect(toolsPlatformTag("darwin", "x64")).toBe("darwin-x64")
    expect(toolsPlatformTag("linux", "aarch64")).toBe("linux-arm64")
    expect(toolsPlatformTag("linux", "amd64")).toBe("linux-x64")
    expect(toolsPlatformTag("win32", "x64")).toBeUndefined()
  })

  test("SPINOSA_TOOLS_DIR overrides the home layout", () => {
    const { home } = makeToolsHome({ bin: true })
    try {
      const custom = path.join(home, "custom-tools")
      mkdirSync(path.join(custom, "bin"), { recursive: true })
      process.env.SPINOSA_TOOLS_DIR = custom
      expect(bundledToolsRoot(home)).toBe(custom)
      expect(bundledToolPath("tesseract", home)).toBeUndefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("bundledToolPath requires executables (tesseract only — no poppler)", () => {
    const { home, root } = makeToolsHome({ bin: true })
    try {
      expect(bundledToolPath("tesseract", home)).toBe(path.join(root, "bin", "tesseract"))
      // pdftoppm is not a production dependency: legacy alias only.
      expect(bundledLegacyToolPath("pdftoppm", home)).toBeUndefined()
      expect(bundledToolPath("tesseract", path.join(home, "empty"))).toBeUndefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("bundledTessdataDir requires all three languages", () => {
    const { home, root } = makeToolsHome({ langs: ["eng", "ita"] })
    try {
      expect(bundledTessdataDir(home)).toBeUndefined()
      writeFileSync(path.join(root, "tessdata", "fra.traineddata"), "data")
      expect(bundledTessdataDir(home)).toBe(path.join(root, "tessdata"))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("ensureBundledToolsEnv prepends bin once and sets TESSDATA_PREFIX", () => {
    const { home, root } = makeToolsHome({ bin: true, langs: ["eng", "ita", "fra"] })
    try {
      delete process.env.TESSDATA_PREFIX
      const bin = path.join(root, "bin")
      const first = ensureBundledToolsEnv(home)
      expect(first.binDir).toBe(bin)
      expect(process.env.PATH!.split(path.delimiter)[0]).toBe(bin)
      expect(process.env.TESSDATA_PREFIX!).toBe(path.join(root, "tessdata"))
      // Idempotent: no double prepend.
      ensureBundledToolsEnv(home)
      expect(process.env.PATH!.split(path.delimiter).filter((p) => p === bin)).toHaveLength(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("explicit TESSDATA_PREFIX is never overridden", () => {
    const { home } = makeToolsHome({ langs: ["eng", "ita", "fra"] })
    try {
      process.env.TESSDATA_PREFIX = "/system/tessdata"
      ensureBundledToolsEnv(home)
      expect(process.env.TESSDATA_PREFIX).toBe("/system/tessdata")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("tesseractSource classifies bundled/dev-host/none (never silent host)", () => {
    const { home } = makeToolsHome({ bin: true, langs: ["eng", "ita", "fra"] })
    const empty = mkdtempSync(path.join(tmpdir(), "spinosa-tools-empty-"))
    const prevDev = process.env.SPINOSA_DEV_HOST_TOOLS
    try {
      delete process.env.SPINOSA_DEV_HOST_TOOLS
      expect(tesseractSource(home)).toBe("bundled")
      // Production never sniffs host PATH: empty home is none even when a
      // host tesseract exists.
      expect(tesseractSource(empty)).toBe("none")
      expect(() => resolveTesseract(empty)).toThrow(/Bundled Tesseract is unavailable/)
      expect(resolveTesseract(home)).toContain("tesseract")
      expect(verifyBundledTools(home)).toEqual([])
      expect(verifyBundledTools(empty).length).toBeGreaterThan(0)
    } finally {
      if (prevDev === undefined) delete process.env.SPINOSA_DEV_HOST_TOOLS
      else process.env.SPINOSA_DEV_HOST_TOOLS = prevDev
      rmSync(home, { recursive: true, force: true })
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
