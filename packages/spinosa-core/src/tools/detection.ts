import { createRequire } from "node:module"
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

export function ocrAvailable(): boolean {
  if (_ocrAvailable !== undefined) return _ocrAvailable
  if (!isOcrPlatformSupported()) {
    _ocrAvailable = false
    return _ocrAvailable
  }
  _ocrAvailable = moduleAvailable("ppu-paddle-ocr", true)
  return _ocrAvailable
}
