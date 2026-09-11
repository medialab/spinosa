/**
 * Vision helpers — single source for image → SDK transcription.
 * Keep IMAGE_EXTENSIONS as the gate (jpg/jpeg/png/webp only per product decision).
 * MIME map is authoritative for dataURL generation.
 */
import { fileExt } from "../constants"

export const VISION_MIME_FOR_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

export function mimeForImageExt(ext: string): string {
  const lower = ext.toLowerCase().replace(/^\./, "")
  return VISION_MIME_FOR_EXT[lower] ?? "image/jpeg"
}

export function isVisionModelId(id: string | undefined): boolean {
  if (!id) return false
  if (id === "tesseract-local" || id === "none" || id === "vision:provider-picker") return false
  return id.includes("/")
}

export function providerFromVisionId(id: string): string | undefined {
  if (!id.includes("/")) return undefined
  return id.slice(0, id.indexOf("/"))
}

export function modelFromVisionId(id: string): string | undefined {
  if (!id.includes("/")) return undefined
  return id.slice(id.indexOf("/") + 1)
}

/** Same prompt used for chat-vision transcription — collected as .md */
export const VISION_TRANSCRIBE_PROMPT = `
Transcribe all visible text accurately.
Preserve headings, paragraphs, lists, and tables in Markdown.
Mark unreadable content as [illegible].
Do not add extra commentary beyond the transcription.
`.trim()
