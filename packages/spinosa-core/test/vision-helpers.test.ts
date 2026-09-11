import { describe, expect, test } from "bun:test"
import { mimeForImageExt, isVisionModelId, VISION_MIME_FOR_EXT, VISION_TRANSCRIBE_PROMPT } from "../src/import/vision-helpers"

describe("vision-helpers", () => {
  test("mimeForImageExt returns correct mime", () => {
    expect(mimeForImageExt("jpg")).toBe("image/jpeg")
    expect(mimeForImageExt("jpeg")).toBe("image/jpeg")
    expect(mimeForImageExt("png")).toBe("image/png")
    expect(mimeForImageExt("webp")).toBe("image/webp")
    expect(mimeForImageExt(".JPG")).toBe("image/jpeg")
    expect(mimeForImageExt("unknown")).toBe("image/jpeg")
  })

  test("isVisionModelId identifies vision ids", () => {
    expect(isVisionModelId("tesseract-local")).toBe(false)
    expect(isVisionModelId("none")).toBe(false)
    expect(isVisionModelId("vision:provider-picker")).toBe(false)
    expect(isVisionModelId(undefined)).toBe(false)
    expect(isVisionModelId("openai/gpt-4o-mini")).toBe(true)
    expect(isVisionModelId("openrouter/qwen2.5-vl:free")).toBe(true)
    expect(isVisionModelId("anthropic/claude-3-5-sonnet")).toBe(true)
  })

  test("VISION_TRANSCRIBE_PROMPT is OCR accurate", () => {
    expect(VISION_TRANSCRIBE_PROMPT).toContain("Transcribe all visible text")
    expect(VISION_TRANSCRIBE_PROMPT).toContain("[illegible]")
  })

  test("VISION_MIME_FOR_EXT has all IMAGE_EXTENSIONS", () => {
    expect(Object.keys(VISION_MIME_FOR_EXT).sort()).toEqual(["jpeg", "jpg", "png", "webp"])
  })
})
