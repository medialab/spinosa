import { createCanvas, loadImage } from "@napi-rs/canvas"

export const VISION_IMAGE_MAX_EDGE_PX = 2048
export const VISION_IMAGE_JPEG_QUALITY = 82
export const VISION_IMAGE_MIN_OPTIMIZE_BYTES = 128 * 1024

export type VisionImagePayload = {
  data: Buffer
  mime: string
  optimized: boolean
  originalBytes: number
  width?: number
  height?: number
  originalWidth?: number
  originalHeight?: number
}

/**
 * Resize oversized images and JPEG-encode them using the native canvas binding
 * already bundled for Spinosa's PDF renderer. Small inputs are kept when a
 * re-encode would increase payload size.
 */
export async function optimizeVisionImage(data: Buffer, mime: string): Promise<VisionImagePayload> {
  if (data.byteLength < VISION_IMAGE_MIN_OPTIMIZE_BYTES) {
    return {
      data,
      mime,
      optimized: false,
      originalBytes: data.byteLength,
    }
  }

  const image = await loadImage(data)
  const originalWidth = image.width
  const originalHeight = image.height
  if (originalWidth < 1 || originalHeight < 1) throw new Error("image has invalid dimensions")

  const scale = Math.min(1, VISION_IMAGE_MAX_EDGE_PX / Math.max(originalWidth, originalHeight))
  const width = Math.max(1, Math.round(originalWidth * scale))
  const height = Math.max(1, Math.round(originalHeight * scale))
  const resized = width !== originalWidth || height !== originalHeight

  const canvas = createCanvas(width, height)
  const context = canvas.getContext("2d")
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const encoded = await canvas.encode("jpeg", VISION_IMAGE_JPEG_QUALITY)

  if (!resized && encoded.byteLength >= data.byteLength) {
    return {
      data,
      mime,
      optimized: false,
      originalBytes: data.byteLength,
      width: originalWidth,
      height: originalHeight,
      originalWidth,
      originalHeight,
    }
  }

  return {
    data: encoded,
    mime: "image/jpeg",
    optimized: true,
    originalBytes: data.byteLength,
    width,
    height,
    originalWidth,
    originalHeight,
  }
}
