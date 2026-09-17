import { describe, expect, test } from "bun:test"
import { buildPaletteList } from "../../src/component/command-palette"

const entry = (value: string, suggested = false): { value: string; suggested: boolean; category?: string } => ({
  value,
  suggested,
})

describe("buildPaletteList", () => {
  test("unfiltered lists each command once, suggested first", () => {
    const list = buildPaletteList([entry("b"), entry("a", true), entry("c", true)], undefined)
    expect(list.map((option) => option.value)).toEqual(["suggested:a", "suggested:c", "b"])
    expect(list[0]?.category).toBe("Suggested")
  })

  test("filtered search stays complete over all options", () => {
    const options = [entry("b"), entry("a", true)]
    expect(buildPaletteList(options, "a")).toEqual(options)
  })

  test("empty options stay empty", () => {
    expect(buildPaletteList([], undefined)).toEqual([])
  })
})
