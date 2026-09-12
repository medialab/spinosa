import { existsSync } from "node:fs"
import { lstat, readdir } from "node:fs/promises"
import path from "node:path"
import { detectLlmTools as coreDetectLlmTools } from "@spinosa/core/tools/detection"
import { resolveUserPath } from "@spinosa/core/utils/path"
import { pluralCount } from "@spinosa/core/utils/string"
import { fileExt } from "@spinosa/core/constants"
import { shouldSkipSourceFile, classifySourceFile, scanClassifySourceFile } from "@spinosa/core/extension/classifier"
import type { FileClass } from "@spinosa/core/extension/types"
import { suggestWorkspacePath as coreSuggestWorkspacePath } from "@spinosa/core/scan/scanner"
import { resolveWorkspacePath as resolveCoreWorkspacePath } from "@spinosa/core/commands/create"
import { detectDocumentTools as coreDetectDocumentTools } from "@spinosa/core/scan/scanner"
import type { ToolStatus as CoreToolStatus } from "@spinosa/core/scan/scanner"

export type OnboardingImportOption = {
  ext: string
  count: number
  bytes: number
  selected: boolean
}

export type OnboardingPreviewRow = {
  label: string
  status: string
  detail?: string
  tone?: "normal" | "muted" | "success" | "error"
}

export type NewWorkspacePreview = {
  projectName: string
  sourcePath: string
  workspacePath: string
  preflightRows: OnboardingPreviewRow[]
  scanRows: OnboardingPreviewRow[]
  importOptions: OnboardingImportOption[]
}

export type ImportScanPreview = {
  projectName: string
  sourcePath: string
  scanRows: OnboardingPreviewRow[]
  importOptions: OnboardingImportOption[]
}

export type ToolStatus = CoreToolStatus

// ── Per-extension scan ───────────────────────────────────────────────

type ExtEntry = { ext: string; count: number; bytes: number }

function shouldSkipScanDir(name: string) {
  return name === ".git" || name === ".spinosa" || name === "node_modules" || name === "__MACOSX" || name === ".trash" || name.endsWith(".app") || name.endsWith(".photoslibrary")
}

// Bound a filesystem op so a stuck/unresponsive mount (e.g. cloud FUSE) cannot
// hang the scan forever.
function withFsTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

async function scanByExtension(
  sourcePath: string,
  classify: (filePath: string) => Promise<FileClass> = scanClassifySourceFile,
  onFile?: (relativePath: string, isFile: boolean, discovered: number) => void,
  shouldAbort?: () => boolean,
): Promise<{
  extMap: Map<string, ExtEntry>
  totals: { markdown: number; markitdown: number; native: number; ocr: number; video: number; audio: number; unknown: number; ignored: number; total: number }
}> {
  const extMap = new Map<string, ExtEntry>()
  const totals = { markdown: 0, markitdown: 0, native: 0, ocr: 0, video: 0, audio: 0, unknown: 0, ignored: 0, total: 0 }
  let discovered = 0

  const stack = [sourcePath]
  while (stack.length > 0) {
    if (shouldAbort?.()) break
    const dir = stack.pop()
    if (!dir) continue
    let entries: string[]
    try { entries = await withFsTimeout(readdir(dir), `readdir ${dir}`) } catch { continue }
    for (const entry of entries) {
      if (shouldAbort?.()) break
      if (entry.startsWith(".") && entry !== "." && entry !== "..") continue
      const fullPath = path.join(dir, entry)
      if (onFile) onFile(path.relative(sourcePath, fullPath) || entry, false, discovered)
      let st
      try { st = await withFsTimeout(lstat(fullPath), `lstat ${fullPath}`) } catch { continue }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        if (shouldSkipScanDir(entry)) continue
        stack.push(fullPath)
        continue
      }
      if (!st.isFile()) continue
      discovered++
      if (onFile) onFile(path.relative(sourcePath, fullPath) || entry, true, discovered)
      try {
        totals.total++
        if (shouldSkipSourceFile(fullPath)) { totals.ignored++; continue }
        const ext = fileExt(fullPath)
        const cls = await classify(fullPath)
        switch (cls) {
          case "markdown": totals.markdown++; break
          case "markitdown": totals.markitdown++; break
          case "native": totals.native++; break
          case "ocr_convertible": totals.ocr++; break
          case "video": totals.video++; break
          case "audio": totals.audio++; break
          default: totals.unknown++; break
        }
        // Only importable classes appear in extension toggles (matches CLI scanSource).
        if (!ext || cls === "unknown" || cls === "ignored") continue
        const existing = extMap.get(ext)
        if (existing) { existing.count++; existing.bytes += st.size }
        else { extMap.set(ext, { ext, count: 1, bytes: st.size }) }
      } catch {
        totals.unknown++; continue
      }
    }
  }
  return { extMap, totals }
}

// ── Build scan rows (for display) ────────────────────────────────────

function buildScanRows(totals: { markdown: number; markitdown: number; native: number; ocr: number; video: number; audio: number; unknown: number; ignored: number; total: number }): OnboardingPreviewRow[] {
  const rows: OnboardingPreviewRow[] = []
  if (totals.total > 0) rows.push({ label: "Source scan", status: `${totals.total} file${totals.total === 1 ? "" : "s"}` })
  const push = (count: number, label: string) => {
    if (count > 0) rows.push({ label, status: `${count} file${count === 1 ? "" : "s"}` })
  }
  push(totals.markdown, "Text-based files to copy")
  push(totals.markitdown, "Office docs / HTML / EPUB")
  push(totals.native, "Native Markdown to copy")
  push(totals.ocr, "Scanned PDFs + images (engine selected later)")
  push(totals.video, "Videos")
  push(totals.audio, "Audio")
  if (totals.unknown > 0) rows.push({ label: "Unknown files", status: `${pluralCount(totals.unknown, "file")} unsupported`, tone: "muted" })
  if (totals.ignored > 0) rows.push({ label: "Ignored", status: `${pluralCount(totals.ignored, "file")} skipped`, tone: "muted" })
  return rows
}

// ── Build import options (per extension, for toggles) ────────────────

function extToImportOptions(extMap: Map<string, ExtEntry>): OnboardingImportOption[] {
  const options: OnboardingImportOption[] = []
  // Audio/video are NOT selected by default — same as Bash MULTI_CHOOSE_EXCLUDE
  const audioExts = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff"])
  const videoExts = new Set(["mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv"])

  for (const [ext, entry] of extMap) {
    const isAv = audioExts.has(ext) || videoExts.has(ext)
    options.push({
      ext,
      count: entry.count,
      bytes: entry.bytes,
      selected: !isAv,
    })
  }
  options.sort((a, b) => a.ext.localeCompare(b.ext))
  return options
}

function buildPreflightRows(workspacePath: string, toolStatus: ToolStatus): OnboardingPreviewRow[] {
  const rows: OnboardingPreviewRow[] = []
  rows.push({ label: "Workspace", status: "writable", detail: path.basename(workspacePath), tone: "success" })
  const ocrStatus = toolStatus.ocr ? "available" : toolStatus.ocrUnsupportedReason ? "unsupported" : "missing"
  const ocrTone = toolStatus.ocr ? "success" : toolStatus.ocrUnsupportedReason ? "muted" : "error"
  rows.push({
    label: "Tesseract",
    status: ocrStatus,
    detail: toolStatus.ocrUnsupportedReason ?? (toolStatus.ocr ? "Italian, English and French scans (free, offline)" : "Install tesseract + poppler + language data (French, Italian, English)"),
    tone: ocrTone,
  })
  rows.push({ label: "MarkItDown", status: toolStatus.markitdown ? "available" : "missing", tone: toolStatus.markitdown ? "success" : "error" })
  rows.push({ label: "PDF.js", status: toolStatus.pdfjs ? "available" : "missing", tone: toolStatus.pdfjs ? "success" : "error" })
  return rows
}

export async function detectDocumentTools(): Promise<ToolStatus> {
  return coreDetectDocumentTools()
}

export function detectLlmTools(): string[] {
  return coreDetectLlmTools()
}

function resolveWorkspacePath(sourcePath: string, workspaceName?: string): string {
  const resolved = resolveUserPath(sourcePath)
  if (!resolved) return ""
  return resolveCoreWorkspacePath(resolved, workspaceName)
}

export async function buildNewWorkspacePreview(sourcePath: string, workspaceName?: string, onFile?: (relativePath: string, isFile: boolean, discovered: number) => void, shouldAbort?: () => boolean): Promise<NewWorkspacePreview> {
  const projectName = workspaceName?.trim() || path.basename(sourcePath)
  const workspacePath = resolveWorkspacePath(sourcePath, workspaceName)
  const toolStatus = await detectDocumentTools()
  const { extMap, totals } = await scanByExtension(sourcePath, scanClassifySourceFile, onFile, shouldAbort)

  return {
    projectName,
    sourcePath,
    workspacePath,
    preflightRows: buildPreflightRows(workspacePath, toolStatus),
    scanRows: buildScanRows(totals),
    importOptions: extToImportOptions(extMap),
  }
}

export async function buildImportScanPreview(
  sourcePath: string,
  options?: { classify?: (filePath: string) => Promise<FileClass>; onFile?: (relativePath: string, isFile: boolean, discovered: number) => void; shouldAbort?: () => boolean },
): Promise<ImportScanPreview> {
  const projectName = path.basename(sourcePath)
  const { extMap, totals } = await scanByExtension(sourcePath, options?.classify, options?.onFile, options?.shouldAbort)

  return {
    projectName,
    sourcePath,
    scanRows: buildScanRows(totals),
    importOptions: extToImportOptions(extMap),
  }
}

export { resolveUserPath } from "@spinosa/core/utils/path"
export { suggestWorkspacePath } from "@spinosa/core/scan/scanner"
