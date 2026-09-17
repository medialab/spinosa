/**
 * pdf.js and @napi-rs/canvas emit known-benign warnings in compiled binaries.
 * The parent isolate already swallowed them; the TUI worker is a second
 * isolate, so the same lines flash on the terminal after preflight.
 */
export function isSpinosaBootNoise(msg: string): boolean {
  return (
    msg.includes('Cannot load "@napi-rs/canvas"') ||
    // pdfjs-dist emits one warning per missing global (ImageData, Path2D,
    // DOMMatrix) with varying quote styles.
    msg.includes("Cannot polyfill")
  )
}

let installed = false
let captureInstalled = false
let captured: string[] = []

export function capturedSpinosaBootNoise(): readonly string[] {
  return captured
}

export function resetSpinosaBootNoiseCapture(): void {
  captured = []
}

export function installSpinosaBootNoiseCapture(): void {
  if (captureInstalled) return
  captureInstalled = true
  const origWarn = console.warn.bind(console)
  const origError = console.error.bind(console)
  console.warn = (...args: unknown[]) => {
    if (args.length > 0 && isSpinosaBootNoise(String(args[0]))) {
      captured.push(String(args[0]))
      return
    }
    origWarn(...args as never[])
  }
  console.error = (...args: unknown[]) => {
    if (args.length > 0 && isSpinosaBootNoise(String(args[0]))) {
      captured.push(String(args[0]))
      return
    }
    origError(...args as never[])
  }
}

export function installSpinosaBootNoiseSuppression(): void {
  if (installed) return
  installed = true
  const origWarn = console.warn.bind(console)
  const origError = console.error.bind(console)
  console.warn = (...args: unknown[]) => {
    if (args.length > 0 && isSpinosaBootNoise(String(args[0]))) return
    origWarn(...(args as never[]))
  }
  console.error = (...args: unknown[]) => {
    if (args.length > 0 && isSpinosaBootNoise(String(args[0]))) return
    origError(...(args as never[]))
  }
}
