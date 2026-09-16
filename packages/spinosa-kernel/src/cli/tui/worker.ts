/**
 * Compiled TUI worker entry. Do not import `@napi-rs/canvas` or pdf.js here.
 *
 * Bun --compile + splitting puts pdfjs-dist in a shared chunk whose
 * createRequire("@napi-rs/canvas") cannot resolve from
 * `/$bunfs/root/chunk-*.js`. Importing napi-canvas-force in this extra
 * isolate loads that chunk, prints ImageData/Path2D polyfill warnings, and
 * can stall the first `/provider` fetch on GNU x64. PDF render stays in the
 * parent isolate (`internal smoke pdf-runtime`).
 *
 * Stub ImageData/Path2D/DOMMatrix before worker-main so a later pdfjs
 * evaluation does not throw ReferenceError. Swallow leftover createRequire
 * noise if a shared chunk still loads.
 */
import { installSpinosaBootNoiseSuppression } from "../../native/boot-noise"
import { installDomMatrixPolyfill } from "../../native/dom-matrix-polyfill"

installSpinosaBootNoiseSuppression()
installDomMatrixPolyfill()
await import("./worker-main.ts")

export type { rpc } from "./worker-main"
