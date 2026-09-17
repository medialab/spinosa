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

export class ZipArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ZipArchiveError"
  }
}

/** Archive limits (zip-bomb hardening). */
export const ZIP_LIMITS = {
  maxFiles: 1000,
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
  maxDepth: 3,
} as const

/**
 * Hardened Zip processing: bounded concurrency, explicit archive limits, every
 * entry awaited before return, structured failure (never `[ERROR]` markdown
 * as a successful conversion).
 */
export async function convertZipBuffer(
  zipBuffer: Buffer,
  fileExtension: string,
  convertEntry: (buffer: Buffer, extension: string) => Promise<{ markdown: string } | null>,
  zipFileName = "archive.zip",
  depth = 0,
): Promise<string> {
  if (depth > ZIP_LIMITS.maxDepth) {
    throw new ZipArchiveError(`zip nesting depth exceeds ${ZIP_LIMITS.maxDepth}: ${zipFileName}`)
  }
  let unzipper: typeof import("unzipper")
  try {
    unzipper = await import("unzipper")
  } catch {
    throw new ZipArchiveError("unzipper is not bundled — ZIP imports require the shipped Spinosa binary")
  }
  if (fileExtension.toLowerCase() !== ".zip") {
    throw new ZipArchiveError(`not a zip archive: ${zipFileName}`)
  }
  const directory = await unzipper.Open.buffer(zipBuffer)
  const entries = directory.files.filter((f: { type: string }) => f.type === "File")
  if (entries.length > ZIP_LIMITS.maxFiles) {
    throw new ZipArchiveError(`zip file count ${entries.length} exceeds limit ${ZIP_LIMITS.maxFiles}: ${zipFileName}`)
  }
  const CONCURRENCY = 4
  const results = new Array<string | null>(entries.length).fill(null)
  let totalBytes = 0
  let cursor = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++
      const entry = entries[index]! as {
        path: string
        buffer: () => Promise<Buffer>
      }
      const buf = await entry.buffer()
      if (buf.byteLength > ZIP_LIMITS.maxEntryBytes) {
        throw new ZipArchiveError(`zip entry ${entry.path} exceeds ${ZIP_LIMITS.maxEntryBytes} bytes`)
      }
      totalBytes += buf.byteLength
      if (totalBytes > ZIP_LIMITS.maxTotalBytes) {
        throw new ZipArchiveError(`zip total expanded size exceeds ${ZIP_LIMITS.maxTotalBytes} bytes: ${zipFileName}`)
      }
      const ext = entry.path.includes(".") ? entry.path.slice(entry.path.lastIndexOf(".")) : ""
      if (ext.toLowerCase() === ".zip") {
        const nested = await convertZipBuffer(buf, ".zip", convertEntry, entry.path, depth + 1)
        results[index] = `\n## File: ${entry.path}\n\n${nested}\n`
        continue
      }
      const converted = await convertEntry(buf, ext)
      results[index] = converted ? `\n## File: ${entry.path}\n\n${converted.markdown}\n` : null
    }
  })
  await Promise.all(workers)
  const body = results.filter((r): r is string => typeof r === "string").join("")
  return `Content from the zip file \`${zipFileName}\`:\n\n${body}`.trim()
}

function patchZipConverter() {
  try {
    const dummy = new Upstream() as unknown as { converters?: Array<{ constructor?: { name?: string }; convert?: unknown }> }
    const converters = dummy.converters
    if (!converters) return
    for (const c of converters) {
      if (c.constructor?.name === "ZipConverter") {
        const proto = Object.getPrototypeOf(c) as {
          convert?: (source: string | Buffer, options?: Record<string, unknown>) => Promise<unknown>
        }
        const origProto = proto.convert
        if (typeof origProto !== "function" || (origProto as { __spinosaZipPatched?: boolean }).__spinosaZipPatched) return
        const patchedConvert = async function (source: string | Buffer, options: Record<string, unknown> = {}) {
          const fileExtension = String(options.file_extension ?? "")
          if (fileExtension.toLowerCase() !== ".zip") return null
          const parentConverters = options._parent_converters as Array<{
            convert?: (source: Buffer, opts: Record<string, unknown>) => Promise<{ markdown: string } | null>
            constructor?: { name?: string }
          }> | undefined
          if (!parentConverters) {
            throw new ZipArchiveError("no converters available to process zip contents")
          }
          const buf = typeof source === "string" ? fs.readFileSync(source) : Buffer.from(source as Uint8Array)
          const zipFileName = typeof source === "string" ? source.split("/").pop() ?? "archive.zip" : "archive.zip"
          const convertEntry = async (entryBuffer: Buffer, extension: string) => {
            const fileOptions = { ...options, file_extension: extension, _parent_converters: parentConverters }
            for (const converter of parentConverters) {
              if (converter.constructor?.name === "ZipConverter") continue
              const result = await converter.convert?.(entryBuffer, fileOptions)
              if (result) return result
            }
            return null
          }
          const markdown = await convertZipBuffer(buf, fileExtension, convertEntry, zipFileName)
          return { title: null, markdown, text_content: markdown }
        }
        ;(patchedConvert as { __spinosaZipPatched?: boolean }).__spinosaZipPatched = true
        proto.convert = patchedConvert
        return
      }
    }
  } catch {}
}
patchZipConverter()

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
