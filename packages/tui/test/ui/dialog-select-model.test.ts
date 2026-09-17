import { describe, expect, test } from "bun:test"
import {
  countDialogRows,
  filterDialogOptions,
  flattenDialogOptions,
  groupDialogOptions,
  nextDialogSelection,
  type DialogSelectModelOption,
} from "../../src/ui/dialog-select-model"

type Option = DialogSelectModelOption<string>

const options: Option[] = [
  { value: "one", title: "Alpha", category: "First", details: ["detail"] },
  { value: "two", title: "Beta", category: "Second" },
  { value: "three", title: "Gamma", category: "First", disabled: true },
]

describe("dialog select model", () => {
  test("filters disabled options and prioritizes title matches", () => {
    expect(filterDialogOptions(options, "alp", false).map((option) => option.value)).toEqual(["one"])
    expect(filterDialogOptions(options, "", false).map((option) => option.value)).toEqual(["one", "two"])
    expect(filterDialogOptions(options, "alp", true).map((option) => option.value)).toEqual(["one", "two"])
  })

  test("matches categories and weights title matches ahead of category matches", () => {
    const matches: Option[] = [
      { value: "title", title: "Alpha", category: "Other" },
      { value: "category", title: "Other", category: "Alpha" },
    ]

    expect(filterDialogOptions(matches, "alpha", false).map((option) => option.value)).toEqual(["title", "category"])
  })

  test("groups and flattens options without losing order", () => {
    const first = options[0]!
    const second = options[1]!
    const grouped = groupDialogOptions(options.slice(0, 2), false)
    expect(grouped).toEqual([
      ["First", [first]],
      ["Second", [second]],
    ])
    expect(flattenDialogOptions(grouped)).toEqual(options.slice(0, 2))
    expect(groupDialogOptions(options.slice(0, 2), true)).toEqual([["", options.slice(0, 2)]])
  })

  test("keeps repeated and missing categories in stable groups", () => {
    const first: Option = { value: "first", title: "First", category: "Group" }
    const repeated: Option = { value: "repeated", title: "Repeated", category: "Group" }
    const uncategorized: Option = { value: "none", title: "No category" }

    expect(groupDialogOptions([first, repeated, uncategorized], false)).toEqual([
      ["Group", [first, repeated]],
      ["", [uncategorized]],
    ])
  })

  test("counts category headers and detail rows", () => {
    const grouped = groupDialogOptions(options.slice(0, 2), false)
    expect(countDialogRows(grouped, flattenDialogOptions(grouped))).toBe(6)
  })

  test("counts ungrouped rows and separators between multiple categories", () => {
    const first: Option = { value: "first", title: "First", category: "One" }
    const second: Option = { value: "second", title: "Second", category: "Two" }
    const third: Option = { value: "third", title: "Third", category: "Three" }
    const ungrouped: Option = { value: "none", title: "None" }
    const grouped = groupDialogOptions([first, second, third, ungrouped], false)

    expect(countDialogRows(grouped, flattenDialogOptions(grouped))).toBe(9)
  })
})

describe("nextDialogSelection", () => {
  test("wraps at either end and preserves in-range movement", () => {
    expect(nextDialogSelection(0, -1, 3)).toBe(2)
    expect(nextDialogSelection(2, 1, 3)).toBe(0)
    expect(nextDialogSelection(1, 1, 3)).toBe(2)
    expect(nextDialogSelection(1, -1, 3)).toBe(0)
  })
})
