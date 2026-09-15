import { describe, expect, test } from "bun:test"
import { formatTodoValue } from "../../src/routes/session/footer"

describe("formatTodoValue", () => {
  test("formats step and content", () => {
    expect(formatTodoValue({ current: 2, total: 5, content: "write report" })).toBe("2/5: write report")
  })

  test("clips long labels without splitting graphemes", () => {
    const value = formatTodoValue({ current: 1, total: 10, content: `done 🎉 ${"z".repeat(60)}` })
    expect(value.endsWith("…")).toBe(true)
    expect(Bun.stringWidth(value)).toBeLessThanOrEqual(50)
  })
})
