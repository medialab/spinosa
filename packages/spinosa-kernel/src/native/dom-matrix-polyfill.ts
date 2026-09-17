/**
 * pdfjs-dist optionally loads `@napi-rs/canvas` and otherwise expects DOM
 * globals. When canvas is unresolved in a compiled worker isolate, pdfjs
 * warns `Cannot polyfill \`ImageData\`` / Path2D / DOMMatrix and can throw
 * ReferenceError. Stub the three globals before any Server/pdfjs import.
 * Real PDF render still needs canvas.
 */
export function installDomMatrixPolyfill(): void {
  const g = globalThis as Record<string, unknown>
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrix {
      constructor(_init?: string | number[]) {}
    }
  }
  if (typeof g.ImageData === "undefined") {
    g.ImageData = class ImageData {
      readonly data: Uint8ClampedArray
      readonly width: number
      readonly height: number
      constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth: number, maybeHeight?: number) {
        if (typeof widthOrData === "number") {
          this.width = widthOrData
          this.height = heightOrWidth
          this.data = new Uint8ClampedArray(this.width * this.height * 4)
        } else {
          this.data = widthOrData
          this.width = heightOrWidth
          this.height = maybeHeight ?? 0
        }
      }
    }
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2D {
      constructor(_path?: string | Path2D) {}
    }
  }
}
