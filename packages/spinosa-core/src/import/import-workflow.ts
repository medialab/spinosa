import type { ChildProcess } from "node:child_process"
import type { ProgressEmitter } from "../progress/progress"
import type { ClassifiedEntry, PhaseResult } from "./pipeline"
import { runImportProcessor, type ImportProcessorId } from "./processors"

export type ClassifiedImportSources = {
  directFiles: ClassifiedEntry[]
  markitdownFiles: ClassifiedEntry[]
  ocrFiles: ClassifiedEntry[]
  logsDir: string
}

export type ImportPhaseResults = {
  direct: PhaseResult
  markitdown: PhaseResult
  ocr: PhaseResult
}

const emptyPhase = (): PhaseResult => ({
  converted: 0,
  skipped: 0,
  failed: 0,
  renamed: 0,
  recoverable: [],
})

export type RunImportWorkflowOptions = {
  prog?: ProgressEmitter
  onLog?: (msg: string) => void
  shouldAbort?: () => boolean
  /** AbortSignal for immediate child cancel (preferred over shouldAbort polling). */
  signal?: AbortSignal
  onChild?: (child: ChildProcess) => void
  onRetry?: (attempt: number, reason: string) => void
  onRename?: (original: string, renamed: string) => void
  overwrite?: boolean
  ocrModelId?: string
  /**
   * Called before each non-empty phase. Return false to skip the phase
   * (e.g. user declined a gate). Throw / abort via shouldAbort for cancel.
   */
  beforePhase?: (id: ImportProcessorId, fileCount: number) => boolean | Promise<boolean>
  /** Called after each phase that ran (including empty skips if you want — only non-empty). */
  afterPhase?: (id: ImportProcessorId, result: PhaseResult) => void | Promise<void>
}

/**
 * Shared import phase runner for onboarding + add-files wizards.
 * All phases use the processor registry (same progress + cancel + child protocol).
 */
export async function runImportWorkflow(
  classified: ClassifiedImportSources,
  options: RunImportWorkflowOptions = {},
): Promise<ImportPhaseResults> {
  const results: ImportPhaseResults = {
    direct: emptyPhase(),
    markitdown: emptyPhase(),
    ocr: emptyPhase(),
  }

  const phases: Array<{ id: ImportProcessorId; files: ClassifiedEntry[] }> = [
    { id: "direct", files: classified.directFiles },
    { id: "markitdown", files: classified.markitdownFiles },
    { id: "ocr", files: classified.ocrFiles },
  ]

  for (const { id, files } of phases) {
    if (options.shouldAbort?.()) break
    if (files.length === 0) continue

    const proceed = (await options.beforePhase?.(id, files.length)) ?? true
    if (!proceed) continue
    if (options.shouldAbort?.()) break

    const result = await runImportProcessor(id, {
      files,
      logsDir: classified.logsDir,
      prog: options.prog,
      onLog: options.onLog,
      shouldAbort: options.shouldAbort,
      signal: options.signal,
      onChild: options.onChild,
      onRetry: options.onRetry,
      onRename: options.onRename,
      overwrite: options.overwrite,
      ocrModelId: options.ocrModelId,
    })
    results[id] = result
    await options.afterPhase?.(id, result)
    if (options.shouldAbort?.()) break
  }

  return results
}
