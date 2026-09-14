import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import * as path from "node:path"
import { isCompiledBinaryDistribution } from "../distribution/bootstrap"
import { bundledTessdataDir, bundledToolPath } from "../distribution/tools"
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
    // Production: Spinosa-owned bundled Tesseract + tessdata first. Host PATH
    // is never the production dependency mechanism (no silent Bun.which
    // fallback, no pdftoppm/Poppler requirement — the internal pdf.js +
    // Canvas renderer handles rasterization).
    if (bundledToolPath("tesseract") && bundledTessdataDir()) {
      _tesseractAvailable = true
      return _tesseractAvailable
    }
    // Developer-only fallback behind an explicit flag.
    if (process.env.SPINOSA_DEV_HOST_TOOLS === "1") {
      const which = (cmd: string): string | null => {
        if (typeof Bun !== "undefined" && (Bun as unknown as { which?: (c: string) => string | null }).which) {
          return (Bun as unknown as { which: (c: string) => string | null }).which!(cmd)
        }
        return null
      }
      if (which("tesseract")) {
        // Standalone contract: bundled tessdata first, then an explicit
        // TESSDATA_PREFIX. Never host-system install locations.
        const candidates = [
          bundledTessdataDir(),
          process.env.TESSDATA_PREFIX,
        ].filter(Boolean) as string[]
        for (const base of candidates) {
          if (existsSync(base) && ["eng.traineddata", "ita.traineddata", "fra.traineddata"].every((f) => existsSync(path.join(base, f)))) {
            _tesseractAvailable = true
            return _tesseractAvailable
          }
        }
      }
    }
    _tesseractAvailable = false
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
  // Bundled Tesseract is the OCR engine.
  _ocrAvailable = tesseractAvailable()
  return _ocrAvailable
}

export function _resetDetectionCacheForTests(): void {
  _ocrAvailable = undefined
  _tesseractAvailable = undefined
  _pdfjsAvailable = undefined
}
