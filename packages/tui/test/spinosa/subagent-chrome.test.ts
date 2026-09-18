import { describe, expect, test } from "bun:test"
import { DEFAULT_THEMES, resolveTheme } from "../../src/theme"
import {
  hashString,
  pickSubagentAccent,
  pickSubagentAccentIndex,
  sessionBackLabel,
  sessionBackWidth,
  siblingSubagentIDs,
  subagentAccentPalette,
} from "../../src/routes/session/subagent-chrome"

describe("sessionBackLabel", () => {
  test("parent conversations use Workspace home with an arrow", () => {
    expect(sessionBackLabel({})).toBe("< Workspace home")
    expect(sessionBackLabel({ parentID: null })).toBe("< Workspace home")
    expect(sessionBackLabel(undefined)).toBe("< Workspace home")
    expect(sessionBackWidth(sessionBackLabel({}))).toBe("< Workspace home".length + 4)
  })

  test("child conversations use back", () => {
    expect(sessionBackLabel({ parentID: "ses_parent" })).toBe("back")
    expect(sessionBackWidth("back")).toBe(8)
  })
})

describe("pickSubagentAccent", () => {
  test("the same session id keeps the same palette index", () => {
    expect(pickSubagentAccentIndex("ses_alpha", [], 6)).toBe(pickSubagentAccentIndex("ses_alpha", [], 6))
  })

  test("a colliding sibling steps to a free palette slot", () => {
    const size = 6
    const seen = new Map<number, string>()
    let first = ""
    let second = ""
    for (let i = 0; i < 4000; i++) {
      const id = `ses_${i}`
      const index = hashString(id) % size
      const prev = seen.get(index)
      if (prev) {
        first = prev
        second = id
        break
      }
      seen.set(index, id)
    }
    expect(first).not.toBe("")
    const siblings = [first, second]
    expect(pickSubagentAccentIndex(first, siblings, size)).toBe(hashString(first) % size)
    expect(pickSubagentAccentIndex(second, siblings, size)).not.toBe(pickSubagentAccentIndex(first, siblings, size))
  })

  test("the accent comes from the theme palette", () => {
    const theme = resolveTheme(DEFAULT_THEMES.opencode, "dark")
    const color = pickSubagentAccent(theme, "ses_child", ["ses_child", "ses_other"])
    expect(subagentAccentPalette(theme)).toContainEqual(color)
  })

  test("sibling ids are the children that share a parent", () => {
    expect(
      siblingSubagentIDs(
        [
          { id: "parent" },
          { id: "b", parentID: "parent", time: { created: 2 } },
          { id: "a", parentID: "parent", time: { created: 1 } },
          { id: "c", parentID: "other" },
        ],
        { id: "a", parentID: "parent" },
      ),
    ).toEqual(["a", "b"])
    expect(siblingSubagentIDs([{ id: "parent" }], { id: "parent" })).toEqual([])
  })
})
