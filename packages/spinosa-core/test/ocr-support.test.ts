import { describe, expect, test } from "bun:test"
import { isOcrPlatformSupported, ocrUnsupportedReason } from "../src/tools/ocr-support"

describe("OCR platform gate (local OCR removed)", () => {
  test("no platform reports local OCR support", () => {
    expect(isOcrPlatformSupported({ platform: "linux", arch: "x64" })).toBe(false)
    expect(isOcrPlatformSupported({ platform: "darwin", arch: "arm64" })).toBe(false)
    expect(isOcrPlatformSupported({ platform: "darwin", arch: "x64" })).toBe(false)
    expect(isOcrPlatformSupported({ platform: "linux", arch: "arm64" })).toBe(false)
  })

  test("unsupported reason directs at vision/copy", () => {
    for (const hints of [
      { platform: "linux", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ] as const) {
      const reason = ocrUnsupportedReason(hints)
      expect(reason).toBeDefined()
      expect(reason!).toMatch(/vision model|copy/i)
    }
  })
})
