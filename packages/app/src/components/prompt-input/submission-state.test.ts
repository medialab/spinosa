import { describe, expect, test } from "bun:test"
import { mergeSubmissionContext } from "./submission-state"

describe("mergeSubmissionContext", () => {
  test("adds the active editor selection to the submitted context", () => {
    const items = [{ type: "file" as const, path: "notes.md", key: "file:notes.md:1:3" }]
    const selected = {
      type: "file" as const,
      path: "src/main.ts",
      selection: { startLine: 8, startChar: 0, endLine: 12, endChar: 0 },
    }

    expect(mergeSubmissionContext(items, selected)).toEqual([
      ...items,
      { ...selected, key: "file:src/main.ts:8:12" },
    ])
    expect(items).toHaveLength(1)
  })

  test("does not duplicate a selection already added explicitly", () => {
    const selected = {
      type: "file" as const,
      path: "src/main.ts",
      selection: { startLine: 8, startChar: 0, endLine: 12, endChar: 0 },
    }
    const items = [{ ...selected, key: "file:src/main.ts:8:12" }]

    expect(mergeSubmissionContext(items, selected)).toBe(items)
  })
})
