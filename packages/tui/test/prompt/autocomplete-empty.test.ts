import { describe, expect, test } from "bun:test"
import { AUTOCOMPLETE_POSITION_POLL_MS, formatAutocompleteEmptyMessage } from "../../src/component/prompt/autocomplete"

describe("formatAutocompleteEmptyMessage", () => {
  test("empty results stay soft", () => {
    expect(formatAutocompleteEmptyMessage()).toBe("No matching items")
    expect(formatAutocompleteEmptyMessage("")).toBe("No matching items")
    expect(formatAutocompleteEmptyMessage("   ")).toBe("No matching items")
  })

  test("search failures surface the error", () => {
    expect(formatAutocompleteEmptyMessage("ENOENT")).toBe("Couldn’t search files: ENOENT")
  })
})

describe("autocomplete poll", () => {
  test("position poll is slower than a 20 Hz timer", () => {
    expect(AUTOCOMPLETE_POSITION_POLL_MS).toBeGreaterThanOrEqual(200)
  })
})
