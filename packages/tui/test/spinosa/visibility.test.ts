import { describe, expect, test } from "bun:test"
import { isSilentResearchAssistant } from "../../src/spinosa/visibility"

describe("isSilentResearchAssistant", () => {
  test("hides assistant replies to silent parent turns", () => {
    const parts = {
      user_silent: [{ type: "text", text: "route", metadata: { spinosaSilent: true } }],
      user_visible: [{ type: "text", text: "hello" }],
    }
    expect(isSilentResearchAssistant({ role: "assistant", parentID: "user_silent" }, parts)).toBe(true)
    expect(isSilentResearchAssistant({ role: "assistant", parentID: "user_visible" }, parts)).toBe(false)
    expect(isSilentResearchAssistant({ role: "user", parentID: "user_silent" }, parts)).toBe(false)
  })
})
