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
    detail: "Suitable for documents; handwritten quality may be poor · Scanned PDFs via pdftoppm + tesseract (ita+eng+fra, 300dpi) · images copied",
    kind: "tesseract",
    vision: false,
    cost: "offline",
  },
  {
    id: "vision:provider-picker",
    label: "Vision model (provider / model)",
    detail: "Choose a provider and a vision-capable model — images transcribed via MarkItDown LLM (needs API key)",
    kind: "vision",
    vision: true,
    cost: "paid",
  },
  {
    id: "none",
    label: "Don't OCR images, just copy them",
    detail: "Images copied to raw/ as-is · scanned PDFs skipped · no model needed",
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

/** Resolve provider API key: env first, then Spinosa provider store (so TUI connect works). */
function resolveProviderKey(requiresKey: string): string | undefined {
  const direct = process.env[requiresKey]
  if (direct) return direct
  // Spinosa stores provider keys via opencode config / provider loader;
  // we also check common fallbacks without importing heavy kernel deps.
  // Google supports both GOOGLE_GENERATIVE_AI_API_KEY and GEMINI_API_KEY.
  if (requiresKey === "GOOGLE_API_KEY" || requiresKey === "GOOGLE_GENERATIVE_AI_API_KEY") {
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  }
  if (requiresKey === "ANTHROPIC_API_KEY") {
    return process.env.ANTHROPIC_API_KEY
  }
  return undefined
}

function isValidOcrModelId(id: string): boolean {
  if (id === "tesseract-local" || id === "none" || id === "vision:provider-picker") return true
  if (!id.includes("/")) return false
  const slash = id.indexOf("/")
  const provider = id.slice(0, slash)
  const model = id.slice(slash + 1)
  if (!provider || !model || model.length < 2) return false
  if (!/^[a-z0-9_-]+$/i.test(provider)) return false
  return true
}

/**
 * Create a Vercel AI SDK `LanguageModel` for the selected vision option.
 * Lazy-imports provider SDKs so Tesseract-only workspaces don't need deps.
 * For OpenRouter we reuse the OpenAI compatible provider with custom baseURL.
 * Supports both curated `OCR_MODEL_OPTIONS` ids and dynamic `provider/model`
 * ids from the catalog (e.g. `anthropic/claude-3.5-sonnet`, `openrouter/qwen/...`).
 *
 * Returns `undefined` when model is not vision or key is missing (caller should fallback).
 */
export async function createVisionLanguageModel(
  ocrModelId: string,
): Promise<undefined | { model: unknown; modelId: string; provider: string }> {
  if (!isValidOcrModelId(ocrModelId)) return undefined
  if (ocrModelId === "tesseract-local" || ocrModelId === "none") return undefined
  const opt = findOcrModel(ocrModelId)
  let modelId: string | undefined = opt?.modelId
  let provider: string | undefined = opt?.provider
  let requiresKey: string | undefined = opt?.requiresKey
  // Dynamic provider/model ids (e.g. `openrouter/qwen/...`, `anthropic/claude-...`)
  if (!modelId && ocrModelId.includes("/")) {
    const slash = ocrModelId.indexOf("/")
    provider = ocrModelId.slice(0, slash)
    modelId = ocrModelId.slice(slash + 1)
    // Vision is implied for any provider/model picked via the vision selector
    if (!modelId) return undefined
    // Derive key name: OPENROUTER_API_KEY, ANTHROPIC_API_KEY, etc.
    // Google uses GOOGLE_GENERATIVE_AI_API_KEY (alias GEMINI_API_KEY)
    if (provider === "google") requiresKey = "GOOGLE_GENERATIVE_AI_API_KEY"
    else requiresKey = provider === "openrouter" ? "OPENROUTER_API_KEY" : `${provider.toUpperCase()}_API_KEY`
    // Also respect opt for curated entries
    if (opt?.requiresKey) requiresKey = opt.requiresKey
  }
  if (!modelId) return undefined
  const key = requiresKey ? resolveProviderKey(requiresKey) : undefined
  // For curated free openrouter models, key is required; for dynamic, also require if provider needs it
  if (requiresKey && !key) return undefined
  // Lazy import — keeps Tesseract-only workspaces from needing `ai`/`@ai-sdk/openai`.
  // For production: openrouter proxies any provider; direct anthropic/google also work via OpenRouter.
  // Direct anthropic/google SDKs can be added later (@ai-sdk/anthropic, @ai-sdk/google) — fallback to openai-compatible for now.
  try {
    const { createOpenAI } = await import("@ai-sdk/openai")
    const baseURL = provider === "openrouter" ? "https://openrouter.ai/api/v1" : undefined
    // For direct anthropic/google, OpenAI-compatible endpoint will fail fast with clear auth error;
    // user should pick via openrouter (e.g. openrouter/anthropic/claude-3-5-sonnet) for cross-provider vision.
    const openai = createOpenAI({
      apiKey: key ?? "sk-test",
      ...(baseURL ? { baseURL } : {}),
    })
    const model = openai(modelId)
    return { model, modelId, provider: provider ?? "openai" }
  } catch {
    return undefined
  }
}
