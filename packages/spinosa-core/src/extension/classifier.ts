import { readdirSync, realpathSync, statSync } from "node:fs"
import * as path from "node:path"
import { homedir } from "node:os"
import {
  fileExt,
  extInList,
  MARKDOWN_EXTENSIONS,
  NATIVE_EXTENSIONS,
  MARKITDOWN_EXTENSIONS,
  IMAGE_EXTENSIONS,
  AUDIO_VIDEO_EXTENSIONS,
  BINARY_COPYABLE_EXTENSIONS,
} from "../constants"
import type { FileClass, ImportRoute } from "./types"
import { isVisionModelId } from "../import/vision-helpers"

const HOME = homedir()

const TCC_SKIP_DIRS: string[] = [
  "/System",
  ...(HOME ? [`${HOME}/Music`] : []),
  ...(HOME ? [`${HOME}/Library/Calendar`] : []),
  ...(HOME ? [`${HOME}/Library/Calendars`] : []),
  ...(HOME ? [`${HOME}/Library/Mail`] : []),
  ...(HOME ? [`${HOME}/Library/Messages`] : []),
  ...(HOME ? [`${HOME}/Library/Safari`] : []),
  ...(HOME ? [`${HOME}/Pictures/Photos Library.photoslibrary`] : []),
]

function isTccSensitiveSourcePath(filePath: string): boolean {
  const normal = filePath.replace(/\/+$/, "")
  for (const dir of TCC_SKIP_DIRS) {
    if (normal === dir || normal.startsWith(dir + "/")) return true
  }
  const name = path.basename(normal)
  if (name.endsWith(".app")) return true
  if (name === "Photos Library.photoslibrary") return true
  if (name.endsWith(".photoslibrary")) return true
  return false
}

export function shouldSkipSourceFile(filePath: string): boolean {
  if (isTccSensitiveSourcePath(filePath)) return true
  const name = path.basename(filePath)
  const lower = name.toLowerCase()
  if (lower === "agents.md") return true

  const normal = filePath.replace(/\/+$/, "")
  if (normal.endsWith("/.DS_Store")) return true
  if (normal.includes("/.__")) return true // matches ._* pattern
  if (normal.endsWith("/.localized")) return true
  if (normal.includes("/__MACOSX/")) return true
  if (normal.endsWith("/.gitkeep")) return true
  if (normal.includes("/node_modules/")) return true
  if (normal.includes("/.git/")) return true

  // Check for ._ prefix on basename (Apple Double files)
  if (name.startsWith("._")) return true

  return false
}

export function findSourceFiles(sourcePath: string, shouldAbort?: () => boolean): string[] {
  const results: string[] = []
  const visited = new Set<string>()

  function walk(dir: string) {
    if (shouldAbort?.()) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (shouldAbort?.()) return
      const fullPath = path.join(dir, entry.name)
      if (isTccSensitiveSourcePath(fullPath)) continue
      if (entry.isDirectory()) {
        let real: string
        try {
          real = realpathSync(fullPath)
        } catch {
          continue
        }
        if (visited.has(real)) continue
        visited.add(real)
        walk(fullPath)
      } else if (entry.isFile()) {
        results.push(fullPath)
      }
    }
  }

  walk(sourcePath)
  return results
}

export async function classifySourceFile(filePath: string): Promise<FileClass> {
  try {
    if (shouldSkipSourceFile(filePath)) return "ignored"

    const ext = fileExt(filePath)

    if (extInList(ext, MARKDOWN_EXTENSIONS)) return "markdown"
    if (extInList(ext, MARKITDOWN_EXTENSIONS)) return "markitdown"
    if (extInList(ext, NATIVE_EXTENSIONS)) return "native"

    if (ext === "pdf") {
      // Outcome-based: all PDFs start as ocr_convertible; the processing phase
      // triages via the pdf.js encoded-text census — digital PDFs extract
      // directly, scanned PDFs go to the selected OCR engine. Keeps scan light.
      return "ocr_convertible"
    }

    if (extInList(ext, IMAGE_EXTENSIONS)) return "ocr_convertible"

    if (extInList(ext, AUDIO_VIDEO_EXTENSIONS)) {
      const audioExts = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff"]
      return audioExts.includes(ext) ? "audio" : "video"
    }

    if (extInList(ext, BINARY_COPYABLE_EXTENSIONS)) return "binary_copyable"

    return "unknown"
  } catch {
    return "unknown"
  }
}

// Lightweight classifier used during the scan phase. Identical to
// classifySourceFile except PDFs are treated as ocr_convertible without
// running a (main-thread, CPU-heavy) pdf.js parse — the precise
// text-vs-scanned detection is deferred to the processing phase.
export async function scanClassifySourceFile(filePath: string): Promise<FileClass> {
  try {
    if (shouldSkipSourceFile(filePath)) return "ignored"

    const ext = fileExt(filePath)

    if (extInList(ext, MARKDOWN_EXTENSIONS)) return "markdown"
    if (extInList(ext, MARKITDOWN_EXTENSIONS)) return "markitdown"
    if (extInList(ext, NATIVE_EXTENSIONS)) return "native"

    if (ext === "pdf") return "ocr_convertible"

    if (extInList(ext, IMAGE_EXTENSIONS)) return "ocr_convertible"

    if (extInList(ext, AUDIO_VIDEO_EXTENSIONS)) {
      const audioExts = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff"]
      return audioExts.includes(ext) ? "audio" : "video"
    }

    if (extInList(ext, BINARY_COPYABLE_EXTENSIONS)) return "binary_copyable"

    return "unknown"
  } catch {
    return "unknown"
  }
}

export async function importRouteForFile(
  srcFile: string,
  opts?: { markitdownChoice?: boolean; ocrChoice?: boolean; ocrModelId?: string },
): Promise<ImportRoute | undefined> {
  const klass = await classifySourceFile(srcFile)

  switch (klass) {
    case "markdown":
      return "markdown_rename"
    case "native":
      return "native_copy"
    case "video":
    case "audio":
      return "media_copy"
    case "markitdown":
      if (opts?.markitdownChoice) return "markitdown"
      return undefined
    case "ocr_convertible": {
      if (!opts?.ocrChoice) return undefined
      const ext = fileExt(srcFile)
      const modelId = opts?.ocrModelId
      // "none" means keep files as-is: copy, never OCR, never drop.
      if (modelId === "none") return "copy"
      if (extInList(ext, IMAGE_EXTENSIONS)) {
        // Images: vision model → dedicated SDK transcription, otherwise copy-only.
        // MarkItDown handles office docs only, never images.
        if (modelId) {
          if (modelId === "tesseract-local") return "copy"
          if (isVisionModelId(modelId)) return "vision"
          try {
            const { findOcrModel } = await import("../import/vision-models")
            const m = findOcrModel(modelId)
            if (m) return m.kind === "vision" ? "vision" : "copy"
          } catch {}
        }
        return "copy"
      }
      // PDFs: vision model → vision page transcription; tesseract (or legacy
      // unset) → tesseract OCR, which extracts digital PDFs via pdf.js first.
      if (modelId && modelId !== "tesseract-local") {
        if (isVisionModelId(modelId)) return "vision"
        try {
          const { findOcrModel } = await import("../import/vision-models")
          if (findOcrModel(modelId)?.kind === "vision") return "vision"
        } catch {}
      }
      return "ocr"
    }
    case "binary_copyable":
      return "binary_copy"
    default:
      return undefined
  }
}

export function markdownRawRelPath(relPath: string): string {
  const ext = fileExt(relPath)
  if (ext === "md") return relPath

  const dir = path.dirname(relPath)
  const name = path.basename(relPath)
  const stem = name.slice(0, name.lastIndexOf("."))
  const result = `${stem}__${ext}.md`

  if (dir === ".") return result
  return `${dir}/${result}`
}

export function markitdownOutputRelPath(relPath: string): string {
  const dir = path.dirname(relPath)
  const name = path.basename(relPath)
  const stem = name.slice(0, name.length - path.extname(name).length)
  const ext = fileExt(relPath)
  const mdOut = ext === "md" || !ext ? `${stem}.md` : `${stem}__${ext}.md`
  if (dir === ".") return mdOut
  return `${dir}/${mdOut}`
}

export function ocrOutputRelPath(relPath: string): string {
  const dir = path.dirname(relPath)
  const name = path.basename(relPath)
  const stem = name.slice(0, name.length - path.extname(name).length)
  const ext = fileExt(relPath)
  const outName = ext === "md" || !ext ? `${stem}.md` : `${stem}__${ext}.md`
  if (dir === ".") return outName
  return `${dir}/${outName}`
}

const MAX_NAME_BYTES = 250

// Byte-length truncation: slicing by UTF-16 code units still overflows on
// multibyte names (the filesystem limit is 255 *bytes* per component).
function truncateUtf8ByBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let end = value.length
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > maxBytes) end--
  return end > 0 ? value.slice(0, end) : value.slice(0, 1)
}

// Split off the trailing extension (multi-part aware: ".tar.gz" -> ext ".gz")
// so truncation keeps the real suffix.
function splitExt(name: string): { stem: string; ext: string } {
  const ext = path.extname(name)
  const stem = ext ? name.slice(0, name.length - ext.length) : name
  return { stem, ext }
}

// Preprocess relative paths so every component fits filesystem name limits
// (macOS: 255 bytes/component). Applied at scan time so the same safe name is
// reused by every import phase and a too-long name never reaches a copy/write.
// Collision-safe across the whole set: exact duplicates AND case-insensitive
// duplicates (default macOS/Windows volumes) within one directory get a short
// disambiguator appended, so neither `Report.txt` silently overwrites
// `report.txt` nor the reverse.
export function safeRelPaths(relPaths: string[]): string[] {
  const seenLevels = new Map<string, Set<string>>()
  const seenInsensitiveLevels = new Map<string, Set<string>>()

  return relPaths.map((relPath) => {
    const parts = relPath.split("/")
    const out: string[] = []
    for (const raw of parts) {
      let name = raw
      if (Buffer.byteLength(raw, "utf8") > MAX_NAME_BYTES) {
        const { stem, ext } = splitExt(raw)
        name = truncateUtf8ByBytes(stem, Math.max(1, MAX_NAME_BYTES - Buffer.byteLength(ext, "utf8"))) + ext
      }
      const dirKey = out.join("/")
      const seen = seenLevels.get(dirKey) ?? new Set<string>()
      const seenInsensitive = seenInsensitiveLevels.get(dirKey) ?? new Set<string>()
      const collides = (candidate: string) => seen.has(candidate) || seenInsensitive.has(candidate.toLowerCase())
      if (collides(name)) {
        let i = 1
        let candidate = name
        const { stem, ext } = splitExt(name)
        const extBytes = Buffer.byteLength(ext, "utf8")
        const budget = MAX_NAME_BYTES - extBytes
        while (collides(candidate) && i < 9999) {
          const suffix = `_${i}`
          candidate = truncateUtf8ByBytes(stem, Math.max(1, budget - Buffer.byteLength(suffix, "utf8"))) + suffix + ext
          i++
        }
        name = candidate
      }
      seen.add(name)
      seenInsensitive.add(name.toLowerCase())
      seenLevels.set(dirKey, seen)
      seenInsensitiveLevels.set(dirKey, seenInsensitive)
      out.push(name)
    }
    return out.join("/")
  })
}

export function safeRelPath(relPath: string): string {
  return safeRelPaths([relPath])[0]!
}
