/**
 * Product entry — stage canvas skia .node before the rest of the CLI graph loads
 * (Bun --compile extracts natives without reliable optional-dep require on Linux).
 * No OCR engine ships; no companion-lib staging needed.
 */
import { installSpinosaBootNoiseSuppression } from "./native/boot-noise"
import { ensureCanvasNativeBinding } from "./native/canvas-native"
import { installDomMatrixPolyfill } from "./native/dom-matrix-polyfill"

installSpinosaBootNoiseSuppression()

/**
 * Commands that never touch canvas: skip the native staging work (up to 3s
 * filesystem probes, doubled on cache miss, painful on restricted/noexec
 * Linux) for them. Everything else stages eagerly — doctor probes canvas
 * availability, native-imports/pdf-runtime smokes exercise it, and the TUI
 * parent renders through it. The tui-worker smoke must not dlopen canvas:
 * that extra isolate cannot require `@napi-rs/canvas` from bunfs chunks.
 * SPINOSA_SKIP_CANVAS_STAGE=1 forces the skip (restricted hosts); the canvas
 * consumer then reports missing instead of hanging.
 */
function _commandNeedsCanvas(argv: string[]): boolean {
  if (process.env.SPINOSA_SKIP_CANVAS_STAGE === "1") return false
  const words = argv.filter((a) => !a.startsWith("-"))
  const [cmd, sub, subsub] = words
  if (cmd === "version") return false
  if (cmd === "internal" && sub === "template") return false
  if (cmd === "internal" && sub === "smoke" && subsub === "provider-catalog") return false
  if (cmd === "internal" && sub === "smoke" && subsub === "tui-worker") return false
  return true
}

if (_commandNeedsCanvas(process.argv.slice(1))) {
  ensureCanvasNativeBinding()
}
installDomMatrixPolyfill()
// Force the per-target `@napi-rs/canvas-*` package into the compile graph (stub in dev).
await import("./generated/napi-canvas-force.gen.ts")
await import("./cli-main.ts")
