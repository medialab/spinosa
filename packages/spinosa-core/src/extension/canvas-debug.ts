/**
 * Diagnostic probe for PDF→PNG / @napi-rs/canvas under Bun --compile.
 * Enable with SPINOSA_DEBUG_CANVAS=1 (stderr NDJSON lines: type=canvas-debug).
 */
import { existsSync, readdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

export type CanvasDebugEvent = {
  type: "canvas-debug"
  step: string
  ok?: boolean
  [key: string]: unknown
}

function enabled(): boolean {
  const v = process.env.SPINOSA_DEBUG_CANVAS
  return v === "1" || v === "true" || v === "yes"
}

export function isCanvasDebugEnabled(): boolean {
  return enabled()
}

export function canvasDebugLog(step: string, fields: Record<string, unknown> = {}): void {
  if (!enabled()) return
  const event: CanvasDebugEvent = {
    type: "canvas-debug",
    step,
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    bunfs: typeof import.meta.url === "string" ? import.meta.url.startsWith("file:///$bunfs") || import.meta.url.includes("/$bunfs/") : false,
    importMetaUrl: typeof import.meta.url === "string" ? import.meta.url.slice(0, 200) : String(import.meta.url),
    ...fields,
  }
  process.stderr.write(`${JSON.stringify(event)}\n`)
}

function globalsSnapshot(label: string): Record<string, unknown> {
  const g = globalThis as Record<string, unknown>
  return {
    label,
    ImageData: typeof g.ImageData,
    Path2D: typeof g.Path2D,
    DOMMatrix: typeof g.DOMMatrix,
    ImageDataTruthy: Boolean(g.ImageData),
    Path2DTruthy: Boolean(g.Path2D),
    DOMMatrixTruthy: Boolean(g.DOMMatrix),
  }
}

function expectedSkiaNames(): string[] {
  if (process.platform === "darwin") {
    return process.arch === "arm64"
      ? ["skia.darwin-arm64.node", "skia.darwin-universal.node"]
      : ["skia.darwin-x64.node", "skia.darwin-universal.node"]
  }
  if (process.platform === "linux") {
    return process.arch === "arm64"
      ? ["skia.linux-arm64-gnu.node", "skia.linux-arm64-musl.node"]
      : ["skia.linux-x64-gnu.node", "skia.linux-x64-musl.node"]
  }
  if (process.platform === "win32") {
    return process.arch === "arm64" ? ["skia.win32-arm64-msvc.node"] : ["skia.win32-x64-msvc.node"]
  }
  return []
}

function probeSkiaPaths(): Record<string, unknown> {
  const envPath = process.env.NAPI_RS_NATIVE_LIBRARY_PATH
  const names = expectedSkiaNames()
  const candidates: string[] = []
  if (envPath) candidates.push(envPath)
  for (const name of names) {
    candidates.push(path.join(tmpdir(), name))
    candidates.push(path.join("/$bunfs/root", name))
    // Bun sometimes hashes: skia.linux-arm64-gnu-<hash>.node — list bunfs if readable
  }

  const found: { path: string; exists: boolean; size?: number; error?: string }[] = []
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const st = statSync(p)
        found.push({ path: p, exists: true, size: st.size })
      } else {
        found.push({ path: p, exists: false })
      }
    } catch (e) {
      found.push({ path: p, exists: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  let bunfsRootListing: string[] | string = "n/a"
  try {
    bunfsRootListing = readdirSync("/$bunfs/root")
      .filter((n) => n.includes("skia") || n.includes("canvas") || n.endsWith(".node"))
      .slice(0, 40)
  } catch (e) {
    bunfsRootListing = e instanceof Error ? e.message : String(e)
  }

  let tmpSkiaListing: string[] | string = "n/a"
  try {
    tmpSkiaListing = readdirSync(tmpdir())
      .filter((n) => n.includes("skia") || n.endsWith(".node"))
      .slice(0, 40)
  } catch (e) {
    tmpSkiaListing = e instanceof Error ? e.message : String(e)
  }

  return {
    NAPI_RS_NATIVE_LIBRARY_PATH: envPath ?? null,
    expectedSkiaNames: names,
    candidates: found,
    bunfsRootSkiaOrNode: bunfsRootListing,
    tmpdirSkiaOrNode: tmpSkiaListing,
    tmpdir: tmpdir(),
  }
}

function errDetail(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { error: String(e) }
  const details = e as Error & { cause?: unknown; code?: string }
  return {
    error: e.message,
    name: e.name,
    code: details.code,
    cause: details.cause instanceof Error ? details.cause.message : details.cause ? String(details.cause) : undefined,
    stack: e.stack?.split("\n").slice(0, 6),
  }
}

/** Full canvas load/resolve probe — call once before PDF render or from doctor. */
export async function debugCanvasEnvironment(reason: string): Promise<void> {
  if (!enabled()) return

  canvasDebugLog("begin", { reason, ...globalsSnapshot("before-any-import") })
  canvasDebugLog("skia-paths", probeSkiaPaths())

  // 1) ESM dynamic import (same path as doctor probeCanvas)
  try {
    const mod = await import("@napi-rs/canvas")
    const keys = Object.keys(mod as object).slice(0, 30)
    canvasDebugLog("esm-import", {
      ok: true,
      keys,
      hasCreateCanvas: typeof (mod as { createCanvas?: unknown }).createCanvas === "function",
      hasImageData: typeof (mod as { ImageData?: unknown }).ImageData !== "undefined",
      hasPath2D: typeof (mod as { Path2D?: unknown }).Path2D !== "undefined",
      hasDOMMatrix: typeof (mod as { DOMMatrix?: unknown }).DOMMatrix !== "undefined",
      ...globalsSnapshot("after-esm-import"),
    })
    try {
      const createCanvas = (mod as { createCanvas: (w: number, h: number) => { width: number; height: number; getContext: (t: string) => unknown } })
        .createCanvas
      const c = createCanvas(8, 8)
      const ctx = c.getContext("2d")
      canvasDebugLog("esm-createCanvas", {
        ok: true,
        width: c.width,
        height: c.height,
        hasContext: Boolean(ctx),
      })
    } catch (e) {
      canvasDebugLog("esm-createCanvas", { ok: false, ...errDetail(e) })
    }
  } catch (e) {
    canvasDebugLog("esm-import", { ok: false, ...errDetail(e), ...globalsSnapshot("after-esm-import-fail") })
  }

  // 2) createRequire — mirrors pdfjs-dist node_utils.js
  try {
    const req = createRequire(import.meta.url)
    let resolved: string | null = null
    try {
      resolved = req.resolve("@napi-rs/canvas")
    } catch (e) {
      canvasDebugLog("createRequire-resolve", { ok: false, ...errDetail(e) })
    }
    if (resolved) {
      canvasDebugLog("createRequire-resolve", {
        ok: true,
        resolved,
        resolvedIsBunfs: resolved.includes("/$bunfs/") || resolved.startsWith("/$bunfs"),
        resolvedExists: existsSync(resolved),
      })
    }

    // Platform package resolve
    const platPkgs =
      process.platform === "linux"
        ? ["@napi-rs/canvas-linux-arm64-gnu", "@napi-rs/canvas-linux-arm64-musl", "@napi-rs/canvas-linux-x64-gnu", "@napi-rs/canvas-linux-x64-musl"]
        : process.platform === "darwin"
          ? ["@napi-rs/canvas-darwin-arm64", "@napi-rs/canvas-darwin-x64", "@napi-rs/canvas-darwin-universal"]
          : ["@napi-rs/canvas-win32-x64-msvc", "@napi-rs/canvas-win32-arm64-msvc"]
    for (const pkg of platPkgs) {
      try {
        const p = req.resolve(pkg)
        canvasDebugLog("createRequire-platform", {
          ok: true,
          pkg,
          resolved: p,
          exists: existsSync(p),
          size: existsSync(p) ? statSync(p).size : undefined,
          isBunfs: p.includes("/$bunfs/"),
        })
      } catch (e) {
        canvasDebugLog("createRequire-platform", { ok: false, pkg, ...errDetail(e) })
      }
    }

    try {
      const canvas = req("@napi-rs/canvas") as {
        createCanvas?: (w: number, h: number) => unknown
        ImageData?: unknown
        Path2D?: unknown
        DOMMatrix?: unknown
      }
      canvasDebugLog("createRequire-load", {
        ok: true,
        hasCreateCanvas: typeof canvas.createCanvas === "function",
        hasImageData: typeof canvas.ImageData !== "undefined",
        hasPath2D: typeof canvas.Path2D !== "undefined",
        hasDOMMatrix: typeof canvas.DOMMatrix !== "undefined",
        ...globalsSnapshot("after-createRequire-load"),
      })
      if (typeof canvas.createCanvas === "function") {
        try {
          const c = canvas.createCanvas(8, 8) as { width: number; height: number }
          canvasDebugLog("createRequire-createCanvas", { ok: true, width: c.width, height: c.height })
        } catch (e) {
          canvasDebugLog("createRequire-createCanvas", { ok: false, ...errDetail(e) })
        }
      }
    } catch (e) {
      canvasDebugLog("createRequire-load", {
        ok: false,
        ...errDetail(e),
        ...globalsSnapshot("after-createRequire-load-fail"),
      })
    }
  } catch (e) {
    canvasDebugLog("createRequire-setup", { ok: false, ...errDetail(e) })
  }

  // 3) pdfjs-style: createRequire from the pdfjs module URL if resolvable
  try {
    const req = createRequire(import.meta.url)
    let pdfjsUrl: string | null = null
    try {
      pdfjsUrl = req.resolve("pdfjs-dist/legacy/build/pdf.mjs")
    } catch {
      pdfjsUrl = null
    }
    canvasDebugLog("pdfjs-resolve", {
      ok: Boolean(pdfjsUrl),
      pdfjsUrl,
      pdfjsIsBunfs: pdfjsUrl?.includes("/$bunfs/") ?? false,
    })
    if (pdfjsUrl) {
      try {
        const pdfjsReq = createRequire(pdfjsUrl)
        const canvas = pdfjsReq("@napi-rs/canvas")
        canvasDebugLog("pdfjs-createRequire-load", {
          ok: true,
          hasImageData: typeof (canvas as { ImageData?: unknown }).ImageData !== "undefined",
          hasCreateCanvas: typeof (canvas as { createCanvas?: unknown }).createCanvas === "function",
          ...globalsSnapshot("after-pdfjs-createRequire"),
        })
      } catch (e) {
        canvasDebugLog("pdfjs-createRequire-load", {
          ok: false,
          ...errDetail(e),
          ...globalsSnapshot("after-pdfjs-createRequire-fail"),
        })
      }
    }
  } catch (e) {
    canvasDebugLog("pdfjs-createRequire-setup", { ok: false, ...errDetail(e) })
  }

  canvasDebugLog("end", { reason, ...globalsSnapshot("final") })
}
