import { describe, expect, test } from "bun:test"
import { truncateHead, truncatePathTail } from "../../src/spinosa/truncate-path"

function loneSurrogates(text: string): boolean {
  for (const unit of text) {
    const code = unit.codePointAt(0)!
    if (code >= 0xd800 && code <= 0xdfff) return true
  }
  return false
}

describe("truncatePathTail", () => {
  test("passes short paths through untouched", () => {
    expect(truncatePathTail("a/b/c.txt", 48)).toBe("a/b/c.txt")
    expect(truncatePathTail("a/b/c.txt", 9)).toBe("a/b/c.txt")
  })

  test("keeps the tail with an ASCII budget", () => {
    expect(truncatePathTail("aa/bb/cc/dd.txt", 8)).toBe("…/dd.txt")
  })

  test("never splits an emoji grapheme", () => {
    const filePath = `projects/🚀-launch-report-final-draft-${"x".repeat(40)}.md`
    const clipped = truncatePathTail(filePath, 24)
    expect(loneSurrogates(clipped)).toBe(false)
    expect(clipped.startsWith("…")).toBe(true)
    expect(Bun.stringWidth(clipped)).toBeLessThanOrEqual(24)
  })

  test("counts CJK as double cells", () => {
    // 8 × 2 cells = 16, over a 10-cell budget.
    const clipped = truncatePathTail("目录/子目录/文件报告文档.txt", 10)
    expect(Bun.stringWidth(clipped)).toBeLessThanOrEqual(10)
    expect(loneSurrogates(clipped)).toBe(false)
  })

  test("keeps combining marks with their base", () => {
    const filePath = `notes/${"y".repeat(50)}-café.md`
    const clipped = truncatePathTail(filePath, 12)
    // Decomposed e + combining mark must survive as one cluster (NFC: é).
    expect(clipped.normalize("NFC")).toContain("é")
    expect(loneSurrogates(clipped)).toBe(false)
    expect(Bun.stringWidth(clipped)).toBeLessThanOrEqual(12)
  })
})

describe("truncateHead", () => {
  test("passes short labels through untouched", () => {
    expect(truncateHead("1/3: write report", 50)).toBe("1/3: write report")
  })

  test("clips the head with a suffix ellipsis", () => {
    expect(truncateHead("1/10: write the quarterly report", 12)).toBe("1/10: write…")
  })

  test("never splits graphemes and respects the cell budget", () => {
    const clipped = truncateHead(`done 🎉🎉 ${"z".repeat(40)}`, 10)
    expect(loneSurrogates(clipped)).toBe(false)
    expect(Bun.stringWidth(clipped)).toBeLessThanOrEqual(10)
    expect(clipped.endsWith("…")).toBe(true)
  })
})
