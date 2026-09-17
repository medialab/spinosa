import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { assertSafeWorkspaceName, isWritableDirectory, workspaceParentDir } from "../src/commands/create"

describe("assertSafeWorkspaceName", () => {
  test("accepts ordinary workspace names", () => {
    expect(() => assertSafeWorkspaceName("My Field Research")).not.toThrow()
    expect(() => assertSafeWorkspaceName("étude-2019")).not.toThrow()
    expect(() => assertSafeWorkspaceName("  padded  ")).not.toThrow()
  })

  test("rejects empty or whitespace-only names", () => {
    expect(() => assertSafeWorkspaceName("")).toThrow(/empty/i)
    expect(() => assertSafeWorkspaceName("   ")).toThrow(/empty/i)
  })

  test("rejects dot and dot-dot names", () => {
    expect(() => assertSafeWorkspaceName(".")).toThrow(/invalid/i)
    expect(() => assertSafeWorkspaceName("..")).toThrow(/invalid/i)
  })

  test("rejects path separators and traversal", () => {
    expect(() => assertSafeWorkspaceName("../evil")).toThrow(/separators/i)
    expect(() => assertSafeWorkspaceName("evil/../../home")).toThrow(/separators/i)
    expect(() => assertSafeWorkspaceName("..\\evil")).toThrow(/separators/i)
    expect(() => assertSafeWorkspaceName("a\0b")).toThrow(/separators/i)
  })

  test("rejects overlong names", () => {
    expect(() => assertSafeWorkspaceName("x".repeat(121))).toThrow(/at most 120/i)
    expect(() => assertSafeWorkspaceName("x".repeat(120))).not.toThrow()
  })
})

describe("workspaceParentDir", () => {
  test("keeps a writable sibling parent", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "spinosa-ws-"))
    const corpus = path.join(root, "archive")
    mkdirSync(corpus, { recursive: true })
    try {
      expect(workspaceParentDir(corpus, path.join(root, "home"))).toBe(path.resolve(root))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("falls back to home when the source parent is not writable", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return
    const root = mkdtempSync(path.join(os.tmpdir(), "spinosa-ws-"))
    const locked = path.join(root, "locked")
    const corpus = path.join(locked, "archive")
    const home = path.join(root, "home")
    mkdirSync(corpus, { recursive: true })
    mkdirSync(home, { recursive: true })
    chmodSync(locked, 0o555)
    try {
      expect(isWritableDirectory(locked)).toBe(false)
      expect(workspaceParentDir(corpus, home)).toBe(path.resolve(home))
    } finally {
      chmodSync(locked, 0o755)
      rmSync(root, { recursive: true, force: true })
    }
  })
})