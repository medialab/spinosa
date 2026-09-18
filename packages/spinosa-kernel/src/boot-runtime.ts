/**
 * Product boot after the version fast path. Canvas/pdf stay out of TUI boot.
 * Doctor and pdf-runtime smokes still stage at start; everything else waits
 * for `ensureDocumentConverters` (onboarding tools green-dot, first PDF).
 */
import { installSpinosaBootNoiseSuppression } from "./native/boot-noise"
import { ensureCanvasNativeBinding } from "./native/canvas-native"
import { installDomMatrixPolyfill } from "./native/dom-matrix-polyfill"
import { commandNeedsCanvas } from "./native/canvas-boot"
import { registerDocumentConverterLoader, ensureDocumentConverters } from "@spinosa/core/tools/detection"
import { installProcessFailureLogs } from "@spinosa/kernel-core/observability/boot-log"

installProcessFailureLogs()
installSpinosaBootNoiseSuppression()

registerDocumentConverterLoader(async () => {
  ensureCanvasNativeBinding()
  const { loadNapiCanvas } = await import("./generated/napi-canvas-force.gen.ts")
  await loadNapiCanvas()
})

if (commandNeedsCanvas(process.argv.slice(1))) {
  await ensureDocumentConverters()
}
installDomMatrixPolyfill()
const { GlobalReady } = await import("@spinosa/kernel-core/global")
await GlobalReady
await import("./cli-main.ts")
