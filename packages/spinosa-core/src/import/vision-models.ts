/**
 * OCR / vision model registry for MarkItDown image handling.
 *
 * `markitdown-ts` can call a vision LLM via Vercel AI SDK `LanguageModel`
 * (`llmModel` + `llmPrompt`) to transcribe images into Markdown. Without it,
 * images are EXIF-only. See https://github.com/dead8309/markitdown-ts
 *
 * This module is the single source of truth for:
 * - curated OCR model options shown in the onboarding TUI
 * - helper to create a Vercel `LanguageModel` for the selected option
 * - prompt used for OCR transcription
 *
 * Provider wiring: OpenRouter free endpoint via `@ai-sdk/openai` with
 * `baseURL: https://openrouter.ai/api/v1` is the cheapest hosted vision
 * path. Tesseract remains the offline fallback. Selection is persisted per
 * workspace (see pipeline hooks + workspace config).
 */

export type OcrModelKind = "tesseract" | "vision" | "none"

export type OcrModelOption = {
  /** Stable id persisted in workspace config (e.g. `tesseract-local`, `openrouter/qwen2.5-vl:free`). */
  id: string
  /** Human label shown in selector. */
  label: string
  /** Detail line under label. */
  detail: string
  kind: OcrModelKind
  /** For vision: `provider/model` as passed to Vercel AI SDK. */
  modelId?: string
  /** Provider id for auth lookup (openrouter, openai, etc.). */
  provider?: string
  /** Whether model is known to support vision input. */
  vision: boolean
  /** Cost hint. */
  cost?: "free" | "paid" | "offline"
  /** Requires API key env (e.g. OPENROUTER_API_KEY). */
  requiresKey?: string
}

export const OCR_VISION_PROMPT = `
Transcribe all visible text accurately.
Preserve headings, paragraphs, lists, and tables in Markdown.
Mark unreadable content as [illegible].
Do not add extra commentary beyond the transcription.
`.trim()

export const OCR_MODEL_OPTIONS: OcrModelOption[] = [
  {
    id: "tesseract-local",
    label: "Tesseract (offline)",
    detail: "Scanned PDFs via pdftoppm + tesseract (ita+eng+fra, 300dpi) · images copied (no OCR)",
    kind: "tesseract",
    vision: false,
    cost: "offline",
  },
  {
    id: "openrouter/qwen2.5-vl-32b:free",
    label: "Qwen 2.5 VL 32B (free)",
    detail: "OpenRouter free · vision · images + scanned PDFs via LLM · rate-limited",
    kind: "vision",
    modelId: "qwen/qwen2.5-vl-32b-instruct:free",
    provider: "openrouter",
    vision: true,
    cost: "free",
    requiresKey: "OPENROUTER_API_KEY",
  },
  {
    id: "openrouter/gemini-flash-1.5-8b:free",
    label: "Gemini Flash 1.5 8B (free)",
    detail: "OpenRouter free · vision · images + scanned PDFs via LLM · rate-limited",
    kind: "vision",
    modelId: "google/gemini-flash-1.5-8b:free",
    provider: "openrouter",
    vision: true,
    cost: "free",
    requiresKey: "OPENROUTER_API_KEY",
  },
  {
    id: "none",
    label: "No OCR (copy only)",
    detail: "Images copied to raw/ as-is · scanned PDFs skipped",
    kind: "none",
    vision: false,
    cost: "offline",
  },
]

export function defaultOcrModelId(): string {
  // Default to offline Tesseract so fresh workspaces work without network/key.
  return "tesseract-local"
}

export function findOcrModel(id: string): OcrModelOption | undefined {
  return OCR_MODEL_OPTIONS.find((o) => o.id === id)
}

export function isVisionModel(id: string): boolean {
  return findOcrModel(id)?.kind === "vision"
}

export function requiresKeyForModel(id: string): string | undefined {
  return findOcrModel(id)?.requiresKey
}

/**
 * Create a Vercel AI SDK `LanguageModel` for the selected vision option.
 * Lazy-imports `@ai-sdk/openai` so workspaces using Tesseract don't need the dep.
 * For OpenRouter we reuse the OpenAI compatible provider with custom baseURL.
 *
 * Returns `undefined` when model is not vision or key is missing (caller should fallback).
 */
export async function createVisionLanguageModel(
  ocrModelId: string,
): Promise<undefined | { model: unknown; modelId: string; provider: string }> {
  const opt = findOcrModel(ocrModelId)
  if (!opt || opt.kind !== "vision" || !opt.modelId) return undefined
  const key = opt.requiresKey ? process.env[opt.requiresKey] : undefined
  if (opt.requiresKey && !key) return undefined
  // Lazy import — keeps Tesseract-only workspaces from needing `ai`/`@ai-sdk/openai`.
  try {
    const { createOpenAI } = await import("@ai-sdk/openai")
    const baseURL = opt.provider === "openrouter" ? "https://openrouter.ai/api/v1" : undefined
    const openai = createOpenAI({
      apiKey: key ?? "sk-test",
      ...(baseURL ? { baseURL } : {}),
    })
    const model = openai(opt.modelId!)
    return { model, modelId: opt.modelId!, provider: opt.provider ?? "openai" }
  } catch {
    return undefined
  }
}
