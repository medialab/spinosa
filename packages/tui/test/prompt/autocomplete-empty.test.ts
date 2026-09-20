import { describe, expect, test } from "bun:test"
import { formatAutocompleteEmptyMessage } from "../../src/component/prompt/autocomplete"

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
