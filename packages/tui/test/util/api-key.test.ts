import { describe, expect, test } from "bun:test"
import { apiKeyInputError, normalizeApiKeyInput } from "../../src/util/api-key"

describe("normalizeApiKeyInput", () => {
  test("trims pasted whitespace and newlines", () => {
    expect(normalizeApiKeyInput("  sk-or-v1-abc123\n")).toBe("sk-or-v1-abc123")
  })

  test("strips a pasted Bearer prefix", () => {
    expect(normalizeApiKeyInput("Bearer sk-or-v1-abc123")).toBe("sk-or-v1-abc123")
  })
})

describe("apiKeyInputError", () => {
  test("accepts a clean key", () => {
    expect(apiKeyInputError("sk-or-v1-abc123")).toBeUndefined()
  })

  test("rejects empty input", () => {
    expect(apiKeyInputError("   \n ")).toContain("empty")
  })

  test("rejects multi-line terminal output (the Bearer-file-list class)", () => {
    expect(apiKeyInputError("✓ file-a.jpg\n✓ file-b.jpg")).toContain("spaces or line breaks")
  })

  test("rejects short input", () => {
    expect(apiKeyInputError("abc")).toContain("too short")
  })
})
