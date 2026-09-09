import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import * as path from "node:path"
import { isCompiledBinaryDistribution } from "../distribution/bootstrap"
import { isOcrPlatformSupported } from "./ocr-support"

const require = createRequire(import.meta.url)

/** Resolve optional modules without embedding the build machine's paths. */
export function moduleAvailable(name: string, bundledInBinary = false): boolean {
  if (bundledInBinary && isCompiledBinaryDistribution()) return true
  try {
    require.resolve(name)
    return true
  } catch {
    return false
  }
}

let _pdfjsAvailable: boolean | undefined

export function pdfjsAvailable(): boolean {
  if (_pdfjsAvailable !== undefined) return _pdfjsAvailable
  _pdfjsAvailable = moduleAvailable("pdfjs-dist/legacy/build/pdf.mjs", true)
  return _pdfjsAvailable
}

export async function pypdfium2Available(): Promise<boolean> {
  return moduleAvailable("pypdfium2")
}

export async function pypdfAvailable(): Promise<boolean> {
  return moduleAvailable("pypdf")
}

const LLM_COMMANDS = [
  { label: "Anthropic", command: "claude" },
  { label: "Gemini", command: "gemini" },
  { label: "OpenAI", command: "openai" },
  { label: "Codex CLI", command: "codex" },
  { label: "Spinosa", command: "spinosa" },
] as const

export function detectLlmTools(): string[] {
  return LLM_COMMANDS.filter(({ command }) => {
    if (typeof Bun !== "undefined" && Bun.which) return !!Bun.which(command)
    return false
  }).map(({ label }) => label)
}

let _ocrAvailable: boolean | undefined
let _tesseractAvailable: boolean | undefined

export function tesseractAvailable(): boolean {
  if (_tesseractAvailable !== undefined) return _tesseractAvailable
  try {
    const which = (cmd: string): string | null => {
      if (typeof Bun !== "undefined" && (Bun as unknown as { which?: (c: string) => string | null }).which) {
        return (Bun as unknown as { which: (c: string) => string | null }).which!(cmd)
      }
      return null
    }
    const hasTesseract = !!which("tesseract")
    const hasPdftoppm = !!which("pdftoppm")
    if (!hasTesseract || !hasPdftoppm) {
      _tesseractAvailable = false
      return _tesseractAvailable
    }
    const candidates = [
      process.env.TESSDATA_PREFIX,
      "/opt/homebrew/share/tessdata",
      "/usr/local/share/tessdata",
      "/usr/share/tessdata",
      "/usr/share/tesseract-ocr/4.00/tessdata",
      "/usr/share/tesseract-ocr/5/tessdata",
      "/opt/local/share/tessdata",
    ].filter(Boolean) as string[]
    for (const base of candidates) {
      if (existsSync(base) && ["eng.traineddata", "ita.traineddata", "fra.traineddata"].every((f) => existsSync(path.join(base, f)))) {
        _tesseractAvailable = true
        return _tesseractAvailable
      }
    }
    // No tessdata dir found but binaries exist → try --list-langs check, otherwise optimistically true
    try {
      const proc = (Bun as unknown as { spawnSync?: (cmd: string[], opts?: unknown) => unknown }).spawnSync?.(["tesseract", "--list-langs"], { stdout: "pipe", stderr: "pipe" } as unknown as never) as unknown as { stdout?: Uint8Array; stderr?: Uint8Array } | undefined
      if (proc) {
        const out = String(proc.stdout ?? "") + String(proc.stderr ?? "")
        if (out.includes("eng") && out.includes("ita") && out.includes("fra")) {
          _tesseractAvailable = true
          return _tesseractAvailable
        }
      }
    } catch { /* ignore */ }
    // Binaries present → claim available (per-file error will surface if langs missing)
    _tesseractAvailable = true
    return _tesseractAvailable
  } catch {
    _tesseractAvailable = false
    return _tesseractAvailable
  }
}

export function networkImageAvailable(): boolean {
  // Placeholder for future network OCR provider (e.g. cloud). Currently always false → images stay copy-only.
  return false
}

export function ocrAvailable(): boolean {
  if (_ocrAvailable !== undefined) return _ocrAvailable
  // Tesseract is the only OCR engine (ppu-paddle-ocr/onnx removed)
  _ocrAvailable = tesseractAvailable()
  return _ocrAvailable
}

export function _resetDetectionCacheForTests(): void {
  _ocrAvailable = undefined
  _tesseractAvailable = undefined
  _pdfjsAvailable = undefined
}
