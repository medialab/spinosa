import { describe, expect, test } from "bun:test"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import {
  optimizeVisionImage,
  VISION_IMAGE_JPEG_QUALITY,
  VISION_IMAGE_MAX_EDGE_PX,
  VISION_IMAGE_MIN_OPTIMIZE_BYTES,
} from "../src/import/vision-image"

describe("optimizeVisionImage", () => {
  test("resizes and compresses an oversized image", async () => {
    const source = createCanvas(2400, 1200)
    const context = source.getContext("2d")
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, source.width, source.height)
    for (let x = 0; x < source.width; x += 40) {
      context.fillStyle = `hsl(${x % 360}, 70%, 50%)`
      context.fillRect(x, 0, 20, source.height)
    }
    const input = await source.encode("jpeg", 100)

    const result = await optimizeVisionImage(input, "image/jpeg")

    expect(VISION_IMAGE_MAX_EDGE_PX).toBe(2048)
    expect(VISION_IMAGE_JPEG_QUALITY).toBe(82)
    expect(VISION_IMAGE_MIN_OPTIMIZE_BYTES).toBe(128 * 1024)
    expect(result.optimized).toBe(true)
    expect(result.mime).toBe("image/jpeg")
    expect(result.width).toBe(2048)
    expect(result.height).toBe(1024)
    expect(result.data.byteLength).toBeLessThan(input.byteLength)
    const decoded = await loadImage(result.data)
    expect(decoded.width).toBe(2048)
    expect(decoded.height).toBe(1024)
  })

  test("keeps a small input when JPEG encoding would make it larger", async () => {
    const source = createCanvas(1, 1)
    const input = await source.encode("png")

    const result = await optimizeVisionImage(input, "image/png")

    expect(result.optimized).toBe(false)
    expect(result.mime).toBe("image/png")
    expect(result.data.equals(input)).toBe(true)
  })
})
