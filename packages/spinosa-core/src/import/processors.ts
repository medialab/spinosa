import type { ChildProcess } from "node:child_process"
import type { ProgressEmitter } from "../progress/progress"
import {
  processDirectCopy,
  processImageCopy,
  processMarkitdown,
  processOcr,
  processPdf,
  type PhaseResult,
  type ClassifiedEntry,
} from "./pipeline"
import { processVisionInProcess } from "./vision-transcribe"

export type ImportProcessorId = "direct" | "copy" | "markitdown" | "pdf" | "vision" | "ocr"

export type ImportProcessorContext = {
  files: ClassifiedEntry[]
  logsDir: string
  prog?: ProgressEmitter
  onLog?: (msg: string) => void
  shouldAbort?: () => boolean
  /** AbortSignal for immediate child cancel (preferred over shouldAbort polling). */
  signal?: AbortSignal
  /** Register OCR/MarkItDown (or other) child processes for cancel-by-id. */
  onChild?: (child: ChildProcess) => void
  onRetry?: (attempt: number, reason: string) => void
  onRename?: (original: string, renamed: string) => void
  overwrite?: boolean
  ocrModelId?: string | (() => string)
  onVisionFailure?: (rel: string, modelId: string, error: string) => Promise<"retry" | "skip" | "abort">
  transcribeVision?: import("./vision-transcribe").VisionTranscribe
}

export type ImportProcessor = {
  id: ImportProcessorId
  label: string
  /** Phase name published via ProgressEmitter / job.progress. */
  phase: string
  run: (ctx: ImportProcessorContext) => Promise<PhaseResult>
}

/**
 * Uniform processor registry for import phases.
 * Wizards call through this so cancel/progress/child wiring stays consistent.
 */
export const importProcessors: Record<ImportProcessorId, ImportProcessor> = {
  direct: {
    id: "direct",
    label: "Direct copy",
    phase: "direct-progress",
    run: async (ctx) =>
      processDirectCopy(
        ctx.files,
        ctx.prog,
        ctx.onLog,
        ctx.overwrite,
        ctx.shouldAbort,
        ctx.onRetry,
        ctx.onRename,
        ctx.logsDir,
      ),
  },
  markitdown: {
    id: "markitdown",
    label: "MarkItDown",
    phase: "MarkItDown",
    run: async (ctx) =>
      processMarkitdown(ctx.files, ctx.logsDir, ctx.prog, ctx.onLog, ctx.shouldAbort, {
        onChild: ctx.onChild,
        signal: ctx.signal,
        ocrModelId: ctx.ocrModelId,
      }),
  },
  copy: {
    id: "copy",
    label: "Copy as-is",
    phase: "copy",
    run: async (ctx) =>
      processImageCopy(
        ctx.files,
        ctx.prog,
        ctx.onLog,
        ctx.overwrite,
        ctx.shouldAbort,
        ctx.logsDir,
      ),
  },
  vision: {
    id: "vision",
    label: "Vision",
    phase: "Vision",
    run: async (ctx) =>
      processVisionInProcess(ctx.files, ctx.logsDir, ctx.prog, ctx.onLog, ctx.shouldAbort, {
        visionModelId: ctx.ocrModelId,
        transcribeVision: ctx.transcribeVision,
        signal: ctx.signal,
        onVisionFailure: ctx.onVisionFailure,
        onChild: ctx.onChild,
      }),
  },
  pdf: {
    id: "pdf",
    label: "PDF",
    phase: "PDF",
    run: async (ctx) =>
      processPdf(ctx.files, ctx.logsDir, ctx.prog, ctx.onLog, ctx.shouldAbort, {
        signal: ctx.signal,
        ocrModelId: ctx.ocrModelId,
      }),
  },
  ocr: {
    id: "ocr",
    label: "OCR",
    phase: "OCR",
    run: async (ctx) =>
      processOcr(ctx.files, ctx.logsDir, ctx.prog, ctx.onLog, ctx.shouldAbort, {
        onChild: ctx.onChild,
        signal: ctx.signal,
      }),
  },
}

export function listImportProcessors(): ImportProcessor[] {
  return [importProcessors.direct, importProcessors.copy, importProcessors.markitdown, importProcessors.pdf, importProcessors.vision, importProcessors.ocr]
}

export async function runImportProcessor(
  id: ImportProcessorId,
  ctx: ImportProcessorContext,
): Promise<PhaseResult> {
  return importProcessors[id].run(ctx)
}
