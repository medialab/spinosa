/**
 * Product entry — stage canvas skia .node before the rest of the CLI graph loads
 * (Bun --compile extracts natives without reliable optional-dep require on Linux).
 * ONNX/ppu-paddle-ocr removed — tesseract (pdftoppm) is sole OCR engine; no
 * onnxruntime companion libs or Linux LD_LIBRARY_PATH re-exec needed.
 */
import { ensureCanvasNativeBinding } from "./native/canvas-native"
import { installDomMatrixPolyfill } from "./native/dom-matrix-polyfill"

// Linux binary noise suppression: optional-dep npm bug + musl cpuid warning are benign;
// doctor still reports Canvas: available. Suppress only these known strings.
const _origWarn = console.warn.bind(console)
const _origError = console.error.bind(console)
function _suppressSpinosaBootNoise(msg: string): boolean {
  return (
    msg.includes('Cannot load "@napi-rs/canvas"') ||
    msg.includes("Cannot polyfill `ImageData`") ||
    msg.includes("Cannot polyfill `Path2D`") ||
    msg.includes("onnxruntime cpuid_info warning")
  )
}
console.warn = (...args: unknown[]) => {
  if (args.length > 0 && _suppressSpinosaBootNoise(String(args[0]))) return
  _origWarn(...(args as never[]))
}
console.error = (...args: unknown[]) => {
  if (args.length > 0 && _suppressSpinosaBootNoise(String(args[0]))) return
  _origError(...(args as never[]))
}

ensureCanvasNativeBinding()
installDomMatrixPolyfill()
// Force the per-target `@napi-rs/canvas-*` package into the compile graph (stub in dev).
// OCR force-import is omitted from the gen module on linux-x64 builds.
await import("./generated/napi-canvas-force.gen.ts")
await import("./cli-main.ts")
