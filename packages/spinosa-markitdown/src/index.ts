/**
 * @spinosa/markitdown — Spinosa fork of markitdown-ts 0.0.10
 * Branched from dead8309/markitdown-ts, vendored for seamless integration.
 * Vision is now externalized to SDK (packages/spinosa-core/src/import/vision-transcribe.ts);
 * this patch is retained only for backwards-compat and is gated on `options.llmModel`.
 * New code must not pass `llmModel` — use the Vision processor instead.
 * Patches: legacy image vision support for IMAGE_EXTENSIONS + OCR prompt.
 */
import { MarkItDown as Upstream } from "markitdown-ts"
import { generateText } from "ai"
import * as fs from "node:fs"

const SPINOSA_IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".webp",
])
// Single source of truth for MIME is now packages/spinosa-core/src/import/vision-helpers.ts
// (kept here for backwards-compat). Keep in sync with IMAGE_EXTENSIONS.
const SPINOSA_OCR_PROMPT = `Transcribe all visible text accurately.
Preserve headings, paragraphs, lists, and tables in Markdown.
Mark unreadable content as [illegible].
Do not add extra commentary beyond the transcription.`

const MIME_FOR_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

// Patch upstream ImageConverter to handle all image types for vision
// We do it by reaching into the prototype after import (sync)
let patched = false
function patchImageConverter() {
  if (patched) return
  patched = true
  try {
    // Upstream ImageConverter is not exported, but we can find it via a dummy instance
    const dummy = new Upstream() as any
    const converters = dummy.converters as any[]
    if (!converters) return
    for (const c of converters) {
      if (c.constructor?.name === "ImageConverter" && c.convert) {
        const orig = c.convert.bind(c)
        // Patch prototype so all instances share
        const proto = Object.getPrototypeOf(c)
        const origProto = proto.convert
        proto.convert = async function(source: string | Buffer, options: any = {}) {
          const ext = (options.file_extension || "").toLowerCase()
          const isVision = Boolean(options.llmModel)
          // For vision, allow any spinosa image ext
          if (isVision && SPINOSA_IMAGE_EXTS.has(ext)) {
            // Ensure prompt
            if (!options.llmPrompt?.trim()) options = { ...options, llmPrompt: SPINOSA_OCR_PROMPT }
            // Try upstream first (jpg/png) — if it returns null, do our own LLM call
            const res = await origProto.call(this, source, options).catch(() => null)
            if (res?.markdown?.trim()) return res
            // Fallback: direct LLM call for webp (upstream only supports jpg/png) — always send as data URL with correct MIME
            try {
              const buf = typeof source === "string" ? fs.readFileSync(source) : Buffer.from(source as any)
              const b64 = buf.toString("base64")
              const mime = MIME_FOR_EXT[ext] || "image/jpeg"
              const dataUrl = `data:${mime};base64,${b64}`
              const prompt = options.llmPrompt || SPINOSA_OCR_PROMPT
              const gen = await generateText({
                model: options.llmModel,
                messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image", image: dataUrl }] }],
              })
              const text = gen.text?.trim() ?? ""
              if (text) return { title: null, markdown: `# Description:\n${text}`, text_content: text }
            } catch (e) {
              console.error("Spinosa ImageConverter fallback error:", e)
            }
            return null
          }
          if (isVision && !options.llmPrompt?.trim()) {
            options = { ...options, llmPrompt: SPINOSA_OCR_PROMPT }
          }
          return origProto.call(this, source, options)
        }
        break
      }
    }
  } catch {}
}
patchImageConverter()

export class MarkItDown extends Upstream {
  constructor() {
    super()
    // ensure patch applied to this instance's converter as well (in case dummy approach missed)
    try {
      const converters = (this as any).converters as any[]
      if (converters) {
        for (const c of converters) {
          if (c.constructor?.name === "ImageConverter") {
            // already patched via prototype
          }
        }
      }
    } catch {}
  }
}

export type ConverterResult = Awaited<ReturnType<MarkItDown["convert"]>>
export type ConverterOptions = Parameters<MarkItDown["convert"]>[1]
