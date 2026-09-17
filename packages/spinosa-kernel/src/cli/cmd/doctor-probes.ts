/**
 * Compiled `doctor` must actually load PDF/canvas/markitdown.
 * `moduleAvailable(..., true)` returns true for any bundled name without
 * dlopen, so a broken bunfs chunk still printed "available".
 */

export async function probePdfEngine(): Promise<boolean> {
  try {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs")
    return Boolean(mod)
  } catch {
    return false
  }
}

export async function probeCanvas(): Promise<boolean> {
  try {
    const mod = await import("@napi-rs/canvas")
    return Boolean(mod)
  } catch {
    return false
  }
}

export async function probeMarkitdown(): Promise<boolean> {
  try {
    const mod = await import("@spinosa/markitdown")
    return Boolean(mod)
  } catch {
    return false
  }
}
