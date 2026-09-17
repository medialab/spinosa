import { createRequire } from "node:module"
import { isCompiledBinaryDistribution } from "../distribution/bootstrap"

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
let converterLoader: (() => Promise<void>) | undefined
let convertersReady = false
let convertersFlight: Promise<void> | undefined

/** Kernel registers canvas staging here so TUI boot does not dlopen Skia. */
export function registerDocumentConverterLoader(loader: () => Promise<void>): void {
  converterLoader = loader
}

/** Stage canvas + load pdf.js natives. Safe to call from the tools green-dot check. */
export async function ensureDocumentConverters(): Promise<void> {
  if (convertersReady) return
  if (!convertersFlight) {
    convertersFlight = (async () => {
      if (converterLoader) await converterLoader()
      convertersReady = true
    })().finally(() => {
      convertersFlight = undefined
    })
  }
  await convertersFlight
}

export function pdfjsAvailable(): boolean {
  if (_pdfjsAvailable !== undefined) return _pdfjsAvailable
  _pdfjsAvailable = moduleAvailable("pdfjs-dist/legacy/build/pdf.mjs", true)
  return _pdfjsAvailable
}

/** Real pdf.js + canvas load for the onboarding tools row (not require.resolve). */
export async function probePdfjsRuntime(): Promise<boolean> {
  try {
    await ensureDocumentConverters()
    await import("../extension/pdf-js")
    _pdfjsAvailable = true
    return true
  } catch {
    _pdfjsAvailable = false
    return false
  }
}

export async function probeCanvasRuntime(): Promise<boolean> {
  try {
    await ensureDocumentConverters()
    const mod = await import("@napi-rs/canvas")
    return Boolean(mod)
  } catch {
    return false
  }
}

export async function probeMarkitdownRuntime(): Promise<boolean> {
  try {
    const mod = await import("@spinosa/markitdown")
    return Boolean(mod)
  } catch {
    try {
      const fallback = await import("markitdown-ts")
      return Boolean(fallback)
    } catch {
      return false
    }
  }
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

/**
 * Local OCR engine availability — always false (no local engine ships).
 * Vision transcription availability is decided by provider/auth state,
 * not here.
 */
export function ocrAvailable(): boolean {
  _ocrAvailable = false
  return _ocrAvailable
}

export function _resetDetectionCacheForTests(): void {
  _ocrAvailable = undefined
  _pdfjsAvailable = undefined
  convertersReady = false
  convertersFlight = undefined
  converterLoader = undefined
}
