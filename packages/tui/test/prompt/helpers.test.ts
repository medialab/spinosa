import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import type { EditorSelection } from "../../src/context/editor"
import {
  fadeColor,
  getEditorRangeLabel,
  hasEditorRangeSelection,
  pastedFilepath,
  randomIndex,
} from "../../src/component/prompt/helpers"

type EditorRange = EditorSelection["ranges"][number]

const makeRange = (start: { line: number; character: number }, end = start, text = ""): EditorRange => ({
  text,
  selection: { start, end },
})

describe("prompt helpers", () => {
  test("normalizes pasted paths for each platform", () => {
    expect(pastedFilepath('"file:///tmp/my%20file.txt"', "darwin")).toBe("/tmp/my file.txt")
    expect(pastedFilepath('"relative\\path\\file.txt"', "darwin")).toBe("relativepathfile.txt")
    expect(pastedFilepath('"C:\\tmp\\file.txt"', "win32")).toBe("C:\\tmp\\file.txt")
  })

  test("returns safe placeholder indexes", () => {
    expect(randomIndex(0)).toBe(0)
    expect(randomIndex(-1)).toBe(0)

    const originalRandom = Math.random
    Math.random = () => 0.99
    try {
      expect(randomIndex(10)).toBe(9)
    } finally {
      Math.random = originalRandom
    }
  })

  test("detects and labels selected editor ranges", () => {
    const empty = makeRange({ line: 2, character: 3 })
    const sameLine = makeRange({ line: 2, character: 3 }, { line: 2, character: 7 }, "text")
    const multiLine = makeRange({ line: 2, character: 3 }, { line: 5, character: 1 }, "text")

    expect(hasEditorRangeSelection(empty)).toBe(false)
    expect(hasEditorRangeSelection(sameLine)).toBe(true)
    expect(hasEditorRangeSelection(multiLine)).toBe(true)
    expect(getEditorRangeLabel(empty)).toBeUndefined()
    expect(getEditorRangeLabel(sameLine)).toBe("#2")
    expect(getEditorRangeLabel(multiLine)).toBe("#2-5")
  })

  test("fades color alpha without changing RGB", () => {
    const color = RGBA.fromValues(0.2, 0.4, 0.6, 0.8)
    expect(fadeColor(color, 0.5).toInts()).toEqual(RGBA.fromValues(0.2, 0.4, 0.6, 0.4).toInts())
  })
})
