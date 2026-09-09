import {
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
  writeFileSync,
  renameSync,
} from "node:fs"
import * as path from "node:path"
import type { ChildProcess } from "node:child_process"
import { safeCopy, writeTextAtomic } from "../utils/fs"
import {
  findSourceFiles,
  classifySourceFile,
  markdownRawRelPath,
  markitdownOutputRelPath,
  ocrOutputRelPath,
} from "../extension/classifier"
import { ImportBatchManager } from "../import/batch"
import { injectColdFrontmatter, convertedOutputExists } from "../import/frontmatter"
import { scanSource } from "../scan/scanner"
import { fileExt, IMAGE_EXTENSIONS, extInList } from "../constants"
import type { PpuOcrFile } from "../import/ppu-ocr"
import { spinosaLogInfo } from "../utils/log"
import { MarkItDown } from "@spinosa/markitdown"
import { isSpinosaCancellationError, throwIfSpinosaCancelled } from "../import/cancellation"
import { markitdownConvertFile } from "../import/markitdown-convert"
import { preserveFailedImportFiles, type ClassifiedEntry, type ImportProgressCallback } from "../import/pipeline"

function backupConvertedOutput(outputPath: string): string[] {
  const paths = [outputPath]
  if (outputPath.endsWith(".md")) paths.push(`${outputPath.slice(0, -3)}_pages`)
  const backups: string[] = []
  for (const source of paths) {
    if (!existsSync(source)) continue
    const backup = `${source}.spinosa-backup-${process.pid}-${crypto.randomUUID()}`
    try {
      renameSync(source, backup)
      backups.push(backup)
    } catch (error) {
      for (const previous of backups) {
        const original = previous.replace(/\.spinosa-backup-\d+-[^/]+$/, "")
        try { renameSync(previous, original) } catch { /* preserve original error */ }
      }
      throw error
    }
  }
  return backups
}

function restoreConvertedOutput(outputPath: string, backups: string[]): boolean {
  try { rmSync(outputPath, { force: true, recursive: true }) } catch { /* cleanup */ }
  const pageDir = outputPath.endsWith(".md") ? `${outputPath.slice(0, -3)}_pages` : undefined
  if (pageDir) try { rmSync(pageDir, { force: true, recursive: true }) } catch { /* cleanup */ }
  let restored = true
  for (const backup of backups) {
    const original = backup.replace(/\.spinosa-backup-\d+-[^/]+$/, "")
    try { renameSync(backup, original) } catch { restored = false }
  }
  return restored
}

function removeConvertedBackups(backups: string[]): void {
  for (const backup of backups) try { rmSync(backup, { force: true, recursive: true }) } catch { /* cleanup */ }
}

export interface AddFilesOptions {
  workspacePath: string
  sourcePath: string
  sourceIsDir?: boolean
  subfolder?: string
  extensions?: string
  overwrite?: boolean
  onProgress?: (message: string) => void
  onFileProgress?: ImportProgressCallback
  shouldAbort?: () => boolean
  /** AbortSignal for immediate MarkItDown/OCR child cancel. */
  signal?: AbortSignal
  /** Register MarkItDown/OCR worker children so cancel can kill them. */
  onChild?: (child: ChildProcess) => void
}

export interface AddFilesResult {
  success: boolean
  totalTargeted: number
  copied: number
  skipped: number
  failed: number
  mdConverted: number
  mdSkipped: number
  mdFailed: number
  ocrConverted: number
  ocrSkipped: number
  ocrFailed: number
  failedFilePaths: string[]
}

export async function addFiles(options: AddFilesOptions): Promise<AddFilesResult> {
  const { workspacePath, sourcePath, sourceIsDir, subfolder, extensions, overwrite, onProgress, onFileProgress, shouldAbort, signal, onChild } = options
  throwIfSpinosaCancelled(shouldAbort)
  const rawDir = path.join(workspacePath, "raw")
  spinosaLogInfo("add", `sourcePath=${sourcePath} workspacePath=${workspacePath} sourceIsDir=${sourceIsDir}`)

  if (!existsSync(rawDir)) {
    mkdirSync(rawDir, { recursive: true })
  }

  if (sourceIsDir) {
    return addFilesFromDir(sourcePath, rawDir, subfolder, extensions, overwrite, onProgress, onFileProgress, shouldAbort, signal, onChild)
  }
  return addSingleFile(sourcePath, rawDir, overwrite, onProgress, onFileProgress, shouldAbort)
}

async function addFilesFromDir(
  sourcePath: string,
  rawDir: string,
  subfolder?: string,
  extensions?: string,
  overwrite?: boolean,
  onProgress?: (msg: string) => void,
  onFileProgress?: ImportProgressCallback,
  shouldAbort?: () => boolean,
  signal?: AbortSignal,
  onChild?: (child: ChildProcess) => void,
): Promise<AddFilesResult> {
  const importBatches = new ImportBatchManager()
  await scanSource(sourcePath, importBatches)
  throwIfSpinosaCancelled(shouldAbort)
  if (extensions) {
    importBatches.parseExtensionsFromFlag(extensions)
  }

  onProgress?.("Scanning source directory...")

  const { copySource } = await import("../import/pipeline")
  const result = await copySource(sourcePath, rawDir, {
    batchManager: importBatches,
    markitdownChoice: true,
    // Keep selected OCR files in the attempt set so unavailable OCR is
    // reported and preserved as a failure instead of being silently omitted.
    ocrChoice: true,
    overwrite,
    subfolder,
    verifyAfter: false,
    shouldAbort,
    onProgress: onFileProgress,
    signal,
    onChild,
    onPhaseChange: (phase) => {
      switch (phase) {
        case "direct":
          onProgress?.("Importing files...")
          break
        case "markitdown":
          onProgress?.("Converting files with MarkItDown...")
          break
        case "ocr":
          onProgress?.("Processing OCR...")
          break
      }
    },
  })

  const totalTargeted = result.copied + result.skipped + result.failed
    + result.mdConverted + result.mdSkipped + result.mdFailed
    + result.ocrConverted + result.ocrSkipped + result.ocrFailed
  const failed = result.failed + result.mdFailed + result.ocrFailed

  onProgress?.("Import complete.")

  return {
    // A single non-fatal failure (broken symlink, chmod 000, OCR timeout) no
    // longer flips the whole import to "failed" when the vast majority of
    // files imported successfully. The `failed` count is surfaced separately
    // so the UI can report partial success instead of blocking the user.
    success: totalTargeted > 0 && failed < totalTargeted,
    totalTargeted,
    copied: result.copied,
    skipped: result.skipped,
    failed: result.failed,
    mdConverted: result.mdConverted,
    mdSkipped: result.mdSkipped,
    mdFailed: result.mdFailed,
    ocrConverted: result.ocrConverted,
    ocrSkipped: result.ocrSkipped,
    ocrFailed: result.ocrFailed,
    failedFilePaths: result.failedFilePaths,
  }
}

async function addSingleFile(
  srcFile: string,
  rawDir: string,
  overwrite?: boolean,
  onProgress?: (msg: string) => void,
  onFileProgress?: ImportProgressCallback,
  shouldAbort?: () => boolean,
): Promise<AddFilesResult> {
  const relPath = path.basename(srcFile)
  const emitFileStatus = (current: number, status: "queued" | "processing" | "done" | "failed") =>
    onFileProgress?.("single", current, 1, relPath, status)

  throwIfSpinosaCancelled(shouldAbort)
  emitFileStatus(0, "queued")
  emitFileStatus(0, "processing")
  const klass = await classifySourceFile(srcFile)
  throwIfSpinosaCancelled(shouldAbort)

  if (klass === "ignored") {
    emitFileStatus(1, "failed")
    const preserved = await preserveFailedImportFiles(
      [{ src: srcFile, rel: relPath, dest: path.join(rawDir, "__unimported__", relPath) }],
      rawDir,
    )
    return {
      success: false,
      totalTargeted: 1,
      copied: 0,
      skipped: 0,
      failed: 1,
      mdConverted: 0,
      mdSkipped: 0,
      mdFailed: 0,
      ocrConverted: 0,
      ocrSkipped: 0,
      ocrFailed: 0,
      failedFilePaths: preserved.failedFilePaths,
    }
  }

  if (klass === "unknown") {
    emitFileStatus(1, "failed")
    const preserved = await preserveFailedImportFiles(
      [{ src: srcFile, rel: relPath, dest: path.join(rawDir, "__unimported__", relPath) }],
      rawDir,
    )
    return {
      success: false,
      totalTargeted: 1,
      copied: 0,
      skipped: 0,
      failed: 1,
      mdConverted: 0,
      mdSkipped: 0,
      mdFailed: 0,
      ocrConverted: 0,
      ocrSkipped: 0,
      ocrFailed: 0,
      failedFilePaths: preserved.failedFilePaths,
    }
  }

  onProgress?.(`Classified as ${klass}`)

  const totalTargeted = 1
  let copied = 0
  let skipped = 0
  let failed = 0
  let mdConverted = 0
  let mdSkipped = 0
  let mdFailed = 0
  let ocrConverted = 0
  let ocrSkipped = 0
  let ocrFailed = 0
  let failedDest = path.join(rawDir, relPath)

  switch (klass) {
    case "markdown":
    case "native": {
      const fileName = path.basename(srcFile)
      const destName = klass === "markdown" ? markdownRawRelPath(fileName) : fileName
      const destFile = path.join(rawDir, destName)
      failedDest = destFile

      mkdirSync(path.dirname(destFile), { recursive: true })

      if (existsSync(destFile)) {
        if (!overwrite) {
          skipped = 1
          break
        }
        rmSync(destFile, { force: true })
      }

      if (safeCopy(srcFile, destFile)) {
        copied = 1
        if (destName.endsWith(".md")) {
          injectColdFrontmatter(destFile)
        }
      } else {
        failed = 1
      }

      break
    }

    case "markitdown": {
      const fileName = path.basename(srcFile)
      const stem = fileName.replace(/\.[^.]+$/, "")
      const ext = fileExt(fileName)
      const destName = `${stem}__${ext}.md`
      const destFile = path.join(rawDir, destName)
      failedDest = destFile

      mkdirSync(path.dirname(destFile), { recursive: true })

      if (convertedOutputExists(destFile)) {
        if (!overwrite) {
          skipped = 1
          break
        }
      }

      const backups = backupConvertedOutput(destFile)
      let restored = true

      try {
        const converter = new MarkItDown()
        const result = await markitdownConvertFile(converter, srcFile)
        throwIfSpinosaCancelled(shouldAbort)
        const text = result?.markdown ?? ""
        if (!text.trim()) throw new Error("MarkItDown returned no content")
        writeTextAtomic(destFile, text)
        mdConverted = 1
        injectColdFrontmatter(destFile)
        removeConvertedBackups(backups)
      } catch (error) {
        restored = restoreConvertedOutput(destFile, backups)
        if (isSpinosaCancellationError(error)) throw error
        mdFailed = 1
      }
      break
    }

    case "ocr_convertible": {
      const ext = fileExt(srcFile).toLowerCase()
      // Images: copy-only, pending network OCR
      if (extInList(ext, IMAGE_EXTENSIONS)) {
        const destFile = path.join(rawDir, path.basename(srcFile))
        failedDest = destFile
        mkdirSync(path.dirname(destFile), { recursive: true })
        if (existsSync(destFile)) {
          if (!overwrite) { skipped = 1; break }
          rmSync(destFile, { force: true })
        }
        if (safeCopy(srcFile, destFile)) {
          copied = 1
        } else {
          failed = 1
        }
        break
      }
      // PDFs: tesseract for scanned, MarkItDown for text-layer
      const fileName = path.basename(srcFile)
      const stem = fileName.replace(/\.[^.]+$/, "")
      const destName = `${stem}__${fileExt(fileName)}.md`
      const destFile = path.join(rawDir, destName)
      failedDest = destFile

      mkdirSync(path.dirname(destFile), { recursive: true })

      if (convertedOutputExists(destFile)) {
        if (!overwrite) {
          skipped = 1
          break
        }
      }

      const backups = backupConvertedOutput(destFile)
      let restored = true
      const tmpDest = destFile + `.spinosa-part-${process.pid}-${crypto.randomUUID()}`

      // Outcome-based text-layer detection: quick /Font check then MarkItDown
      let likelyTextPdf = false
      try {
        const head = (await import("node:fs")).readFileSync(srcFile).subarray(0, 262144).toString("utf-8")
        likelyTextPdf = head.includes("/Font") || head.includes("/CIDFont")
      } catch { likelyTextPdf = false }
      if (likelyTextPdf) {
        try {
          const converter = new MarkItDown()
          const result = await markitdownConvertFile(converter, srcFile)
          throwIfSpinosaCancelled(shouldAbort)
          const text = result?.markdown?.trim() ?? ""
          if (text) {
            writeTextAtomic(destFile, text)
            mdConverted = 1
            injectColdFrontmatter(destFile)
            removeConvertedBackups(backups)
            break
          }
        } catch {
          // fall through to OCR
        }
      }

      try {
        const { tesseractAvailable, ocrPdfViaTesseract } = await import("../import/tesseract-ocr")
        if (tesseractAvailable()) {
          await ocrPdfViaTesseract(srcFile, tmpDest, fileName, { shouldAbort })
          if (convertedOutputExists(tmpDest)) {
            renameSync(tmpDest, destFile)
            ocrConverted = 1
            injectColdFrontmatter(destFile)
          } else {
            restored = restoreConvertedOutput(destFile, backups)
            ocrFailed = 1
          }
        } else {
          const { runPpuOcrBatch } = await import("../import/ppu-ocr")
          await runPpuOcrBatch([{ src: srcFile, rel: fileName, dest: tmpDest }], { shouldAbort })
          if (convertedOutputExists(tmpDest)) {
            renameSync(tmpDest, destFile)
            ocrConverted = 1
            injectColdFrontmatter(destFile)
          } else {
            restored = restoreConvertedOutput(destFile, backups)
            ocrFailed = 1
          }
        }
      } catch (error) {
        restored = restoreConvertedOutput(destFile, backups)
        if (isSpinosaCancellationError(error)) throw error
        ocrFailed = 1
      } finally {
        try { rmSync(tmpDest, { force: true }) } catch { /* cleanup */ }
        if (restored) removeConvertedBackups(backups)
      }

      break
    }

    case "video":
    case "audio": {
      const destFile = path.join(rawDir, path.basename(srcFile))
      failedDest = destFile

      mkdirSync(path.dirname(destFile), { recursive: true })

      if (existsSync(destFile)) {
        if (!overwrite) {
          skipped = 1
          break
        }
        rmSync(destFile, { force: true })
      }

      if (safeCopy(srcFile, destFile)) {
        copied = 1
      } else {
        failed = 1
      }

      break
    }
  }

  onProgress?.("Single file import complete.")

  const failedFilePaths = failed + mdFailed + ocrFailed > 0
    ? (await preserveFailedImportFiles(
      [{ src: srcFile, rel: relPath, dest: failedDest }],
      rawDir,
    )).failedFilePaths
    : []
  emitFileStatus(1, failedFilePaths.length > 0 ? "failed" : "done")

  return {
    success: failed + mdFailed + ocrFailed === 0,
    totalTargeted,
    copied,
    skipped,
    failed,
    mdConverted,
    mdSkipped,
    mdFailed,
    ocrConverted,
    ocrSkipped,
    ocrFailed,
    failedFilePaths,
  }
}
