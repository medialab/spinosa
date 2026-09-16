/**
 * Compiled TUI worker entry. Canvas + DOMMatrix must be installed before any
 * Server/pdfjs import — ESM static imports hoist, so the real worker lives in
 * worker-main.ts and is loaded after the same preamble as src/index.ts.
 */
import { ensureCanvasNativeBinding } from "../../native/canvas-native"
import { installDomMatrixPolyfill } from "../../native/dom-matrix-polyfill"

ensureCanvasNativeBinding()
installDomMatrixPolyfill()
await import("../../generated/napi-canvas-force.gen.ts")
await import("./worker-main.ts")

export type { rpc } from "./worker-main"
