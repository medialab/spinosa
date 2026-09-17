import { describe, expect, test } from "bun:test"
import { ZIP_LIMITS, ZipArchiveError, convertZipBuffer } from "@spinosa/markitdown"

describe("hardened ZIP conversion", () => {
  test("limits are explicit and bounded", () => {
    expect(ZIP_LIMITS.maxFiles).toBeLessThanOrEqual(5000)
    expect(ZIP_LIMITS.maxEntryBytes).toBeLessThanOrEqual(500 * 1024 * 1024)
    expect(ZIP_LIMITS.maxTotalBytes).toBeLessThanOrEqual(2 * 1024 * 1024 * 1024)
    expect(ZIP_LIMITS.maxDepth).toBeLessThanOrEqual(5)
  })

  test("non-zip extension throws structured failure (never [ERROR] markdown)", async () => {
    await expect(
      convertZipBuffer(Buffer.from("x"), ".txt", async () => null),
    ).rejects.toBeInstanceOf(ZipArchiveError)
  })

  test("nesting depth throws structured failure", async () => {
    await expect(
      convertZipBuffer(Buffer.from("x"), ".zip", async () => null, "a.zip", 99),
    ).rejects.toBeInstanceOf(ZipArchiveError)
  })

  test("unzipper bundled in the dependency graph", async () => {
    const pkg = (await import("../package.json")) as { dependencies?: Record<string, string> }
    expect(pkg.dependencies?.unzipper).toBeDefined()
  })
})
