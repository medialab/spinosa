import { describe, expect, test, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import * as path from "node:path"
import { tmpdir } from "node:os"
import {
  bundledToolsBinDir,
  bundledToolsRoot,
  toolsPlatformTag,
  verifyBundledTools,
} from "../src/distribution/tools"

const ORIGINAL_TOOLS_DIR = process.env.SPINOSA_TOOLS_DIR

afterEach(() => {
  if (ORIGINAL_TOOLS_DIR === undefined) delete process.env.SPINOSA_TOOLS_DIR
  else process.env.SPINOSA_TOOLS_DIR = ORIGINAL_TOOLS_DIR
})

describe("legacy tools layout helpers (no engine ships)", () => {
  test("toolsPlatformTag mirrors installer mapping", () => {
    expect(toolsPlatformTag("darwin", "arm64")).toBe("darwin-arm64")
    expect(toolsPlatformTag("darwin", "x64")).toBe("darwin-x64")
    expect(toolsPlatformTag("linux", "aarch64")).toBe("linux-arm64")
    expect(toolsPlatformTag("linux", "amd64")).toBe("linux-x64")
    expect(toolsPlatformTag("win32", "x64")).toBeUndefined()
  })

  test("SPINOSA_TOOLS_DIR overrides the home layout", () => {
    const home = mkdtempSync(path.join(tmpdir(), "spinosa-tools-"))
    try {
      const custom = path.join(home, "custom-tools")
      mkdirSync(path.join(custom, "bin"), { recursive: true })
      process.env.SPINOSA_TOOLS_DIR = custom
      expect(bundledToolsRoot(home)).toBe(custom)
      expect(bundledToolsBinDir(home)).toBe(path.join(custom, "bin"))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("verifyBundledTools requires nothing (no engine ships)", () => {
    const home = mkdtempSync(path.join(tmpdir(), "spinosa-tools-"))
    const empty = mkdtempSync(path.join(tmpdir(), "spinosa-tools-empty-"))
    try {
      expect(verifyBundledTools(home)).toEqual([])
      expect(verifyBundledTools(empty)).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
