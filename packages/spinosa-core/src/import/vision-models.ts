/**
 * Legacy OCR model registry for short model ids (no "/").
 *
 * The TUI renders its own option list (onboarding-helpers); this registry
 * exists only so old persisted short ids still resolve to a kind via
 * findOcrModel. Do not add display copy here — it will drift.
 * Provider wiring is via kernel `/provider/{providerID}/models/{modelID}/vision/transcribe`.
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
  /** For vision: `provider/model` as passed to kernel. */
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
    detail: "Choose a provider and a vision-capable model — images and scanned PDFs transcribed via SDK (needs API key)",
    kind: "vision",
    vision: true,
    cost: "paid",
  },
  {
    id: "none",
    label: "Don't OCR, just copy files as-is",
    detail: "Images and scanned PDFs copied to raw/ unchanged · no text extracted · no model needed",
    kind: "none",
    vision: false,
    cost: "offline",
  },
]

export function findOcrModel(id: string): OcrModelOption | undefined {
  return OCR_MODEL_OPTIONS.find((o) => o.id === id)
}
