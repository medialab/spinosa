import { describe, expect, test } from "bun:test"
import { safeRelPath, safeRelPaths } from "../src/extension/classifier"

describe("safeRelPath", () => {
  test("keeps short paths untouched", () => {
    expect(safeRelPath("docs/report.md")).toBe("docs/report.md")
    expect(safeRelPaths(["docs/report.md"])).toEqual(["docs/report.md"])
  })

  test("case-insensitive collisions in one directory never overwrite each other", () => {
    // On default macOS/Windows volumes `Report.txt` and `report.txt` map to the
    // same output name; the second one must get a suffix instead of clobbering.
    const out = safeRelPaths(["Report.txt", "report.txt", "REPORT.txt"])
    expect(out[0]).toBe("Report.txt")
    expect(out[1]).toBe("report_1.txt")
    expect(out[2]).toBe("REPORT_2.txt")
    expect(new Set(out.map((p) => p.toLowerCase()))).toHaveLength(out.length)
  })

  test("exact duplicates in one directory get the same treatment", () => {
    const out = safeRelPaths(["a.md", "a.md"])
    expect(out).toEqual(["a.md", "a_1.md"])
  })

  test("same names in different directories stay untouched", () => {
    const out = safeRelPaths(["x/notes.txt", "y/notes.txt"])
    expect(out).toEqual(["x/notes.txt", "y/notes.txt"])
  })

  test("truncation twins are disambiguated", () => {
    const long = "z".repeat(300)
    const out = safeRelPaths([`dir/${long}.txt`, `dir/${long}.txt`])
    expect(out[0]).toBe(out[0])
    expect(out[1]).not.toBe(out[0])
    expect(out[0]!.length).toBeLessThanOrEqual(254)
  })

  test("every distinct input yields a distinct safe path", () => {
    const input = ["MIXED.txt", "mixed.txt", "Mixed.Txt", "mixed.TXT"]
    const out = safeRelPaths(input)
    expect(new Set(out).size).toBe(input.length)
  })

  test("sibling files share one directory — tree is not shredded", () => {
    // Regression 2026-09-12: every file after the first in a folder minted
    // `folder_1`, `folder_2`, … (one folder per file) instead of rejoining
    // the identical input directory. 2713 source files became 2713 top dirs.
    const out = safeRelPaths([
      "generic-files/Artificial_Inquiries_CompleteColor.pdf",
      "generic-files/notes.md",
      "Ex0-Pre-sessions-interviews/Transcriptions/COHORT2/a.md",
      "Ex0-Pre-sessions-interviews/Transcriptions/COHORT2/b.md",
      "Ex0-Pre-sessions-interviews/Transcriptions/COHORT3/c.md",
    ])
    expect(out).toEqual([
      "generic-files/Artificial_Inquiries_CompleteColor.pdf",
      "generic-files/notes.md",
      "Ex0-Pre-sessions-interviews/Transcriptions/COHORT2/a.md",
      "Ex0-Pre-sessions-interviews/Transcriptions/COHORT2/b.md",
      "Ex0-Pre-sessions-interviews/Transcriptions/COHORT3/c.md",
    ])
  })

  test("case-variant twin directories under one parent still disambiguate", () => {
    // `Docs/` vs `docs/` under the same parent would merge on macOS/Windows:
    // the twin forks instead of merging, while identical dirs rejoin.
    const out = safeRelPaths(["Ex9/Docs/a.md", "Ex9/docs/b.md", "Ex9/Docs/c.md"])
    expect(out[0]).toBe("Ex9/Docs/a.md")
    expect(out[2]).toBe("Ex9/Docs/c.md")
    expect(out[1]).toBe("Ex9/docs_1/b.md")
  })
})