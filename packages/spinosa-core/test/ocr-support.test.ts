import { describe, expect, test } from "bun:test"
import { isOcrPlatformSupported, ocrUnsupportedReason } from "../src/tools/ocr-support"

describe("OCR platform gate", () => {
  test("linux-x64 is explicitly unsupported", () => {
    expect(isOcrPlatformSupported({ platform: "linux", arch: "x64" })).toBe(false)
    expect(ocrUnsupportedReason({ platform: "linux", arch: "x64" })).toMatch(/unsupported on linux-x64/i)
  })

  test("darwin and linux-arm64 remain supported", () => {
    expect(isOcrPlatformSupported({ platform: "darwin", arch: "arm64" })).toBe(true)
    expect(isOcrPlatformSupported({ platform: "darwin", arch: "x64" })).toBe(true)
    expect(isOcrPlatformSupported({ platform: "linux", arch: "arm64" })).toBe(true)
    expect(ocrUnsupportedReason({ platform: "linux", arch: "arm64" })).toBeUndefined()
    expect(ocrUnsupportedReason({ platform: "darwin", arch: "arm64" })).toBeUndefined()
  })
})
