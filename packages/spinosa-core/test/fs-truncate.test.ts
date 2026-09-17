import { describe, expect, test } from "bun:test"
import path from "node:path"
import { truncateDestPath } from "../src/utils/fs"

const MAX_PATH_BYTES = 1000
const MAX_NAME_BYTES = 250

describe("truncateDestPath", () => {
  test("preserves absolute path root on macOS-style paths", () => {
    const longStem = "a".repeat(200)
    const dest = path.join("/Users", "name", "workspace", "raw", `${longStem}.md`)
    const truncated = truncateDestPath(dest)
    expect(path.isAbsolute(truncated)).toBe(true)
    expect(truncated.startsWith("/Users/")).toBe(true)
    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(MAX_PATH_BYTES)
  })

  test("handles multibyte filenames by byte length", () => {
    const multibyte = "文".repeat(120)
    const dest = path.join("/tmp", "workspace", "raw", `${multibyte}.md`)
    const truncated = truncateDestPath(dest)
    expect(Buffer.byteLength(path.basename(truncated), "utf8")).toBeLessThanOrEqual(MAX_NAME_BYTES)
    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(MAX_PATH_BYTES)
  })

  test("shortens several long parent directories", () => {
    const parents = Array.from({ length: 8 }, (_, index) => "segment".repeat(20) + index)
    const dest = path.join("/Users", "name", ...parents, "file.txt")
    const truncated = truncateDestPath(dest)
    expect(path.isAbsolute(truncated)).toBe(true)
    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(MAX_PATH_BYTES)
  })

  test("falls back to a deterministic hash when truncation cannot fit", () => {
    const dest = path.join("/Users", "name", "x".repeat(900), "y".repeat(900), "document.pdf")
    const truncated = truncateDestPath(dest)
    expect(truncated.startsWith("/Users/")).toBe(true)
    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(MAX_PATH_BYTES)
    expect(truncateDestPath(dest)).toBe(truncated)
  })
})

describe("truncateDestPath reserve", () => {
  test("reserved room keeps the rescue temp file inside limits", () => {
    // The rescue copy writes `target + .spinosa-part-<pid>-<uuid>` (~50B).
    // Without the reserve the temp file itself overflows and rescue dies.
    const reserve = Buffer.byteLength(`.spinosa-part-${process.pid}-${"0".repeat(36)}`, "utf8")
    const dest = path.join("/tmp", "ws", "raw", `${"a".repeat(240)}.txt`)
    const target = truncateDestPath(dest, reserve)
    const tmpComponent = path.basename(target) + `.spinosa-part-${process.pid}-${"0".repeat(36)}`
    expect(Buffer.byteLength(path.basename(target), "utf8")).toBeLessThanOrEqual(250 - reserve)
    expect(Buffer.byteLength(tmpComponent, "utf8")).toBeLessThanOrEqual(255)
  })
})
