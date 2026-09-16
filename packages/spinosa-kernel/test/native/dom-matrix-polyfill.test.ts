import { describe, expect, test } from "bun:test"
import { installDomMatrixPolyfill } from "../../src/native/dom-matrix-polyfill"

describe("pdf.js DOM polyfills", () => {
  test("installs ImageData, Path2D, and DOMMatrix when missing", () => {
    const g = globalThis as Record<string, unknown>
    const prev = {
      DOMMatrix: g.DOMMatrix,
      ImageData: g.ImageData,
      Path2D: g.Path2D,
    }
    delete g.DOMMatrix
    delete g.ImageData
    delete g.Path2D
    try {
      installDomMatrixPolyfill()
      expect(typeof g.DOMMatrix).toBe("function")
      expect(typeof g.ImageData).toBe("function")
      expect(typeof g.Path2D).toBe("function")
      const ImageDataCtor = g.ImageData as new (w: number, h: number) => { width: number; height: number }
      const img = new ImageDataCtor(2, 3)
      expect(img.width).toBe(2)
      expect(img.height).toBe(3)
    } finally {
      g.DOMMatrix = prev.DOMMatrix
      g.ImageData = prev.ImageData
      g.Path2D = prev.Path2D
    }
  })
})
