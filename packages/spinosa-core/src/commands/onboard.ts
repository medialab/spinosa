import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { scanSource, detectDocumentTools, type ScanCounts, type ScanBytes, type ToolStatus } from "../scan/scanner"
import { ImportBatchManager } from "../import/batch"
import type { PhaseResult } from "../import/pipeline"
import { writeSetupFiles } from "../workspace/registry"
import { writeWorkspaceStatus } from "../workspace/meta"
import { generateStartupPrompt } from "./startup"
import { preferredCliName, buildLaunchCommand } from "../handoff/builder"
import { copyToClipboard, runCliWithPrompt } from "../handoff/runner"
import { spinosaLogInfo } from "../utils/log"
import { throwIfSpinosaCancelled } from "../import/cancellation"
import type { ImportProgressCallback } from "../import/pipeline"

export type OnboardingPhase =
  | "scan"
  | "batch_selection"
  | "tool_validation"
  | "import"
  | "direct"
  | "markitdown"
  | "ocr"
  | "verification"
  | "cli_selection"
  | "prompt"
  | "complete"
  | "blocked"

export type OnboardingHandoffResult =
  | "prompt_copied"
  | "prompt_ready"
  | "launch_command_copied"
  | "launch_command_ready"
  | "run_requested"
  | "run_failed_command_copied"
  | "run_failed_command_ready"


export interface OnboardingOptions {
  workspacePath: string
  frameworkRoot: string
  sourcePath: string
  projectTitle: string
  flagExtensions?: string
  flagCli?: string
  flagLaunch?: "copy" | "run"
  onPhase?: (phase: OnboardingPhase, message: string) => void
  onCopyProgress?: ImportProgressCallback
  shouldAbort?: () => boolean
  /** Recovery count already collected from additional interactive sources. */
  additionalRecovered?: number
  /** Interactive multi-source flows may have no importable files in source 1. */
  allowEmptySelection?: boolean
  /** Selected OCR engine id (vision model / tesseract-local / none) for route-aware verify. */
  ocrModelId?: string
}

export interface OnboardingVerifyStats {
  missing: number
  recovered: number
  stillMissing: number
  missingFiles: string[]
  recoveredFiles: string[]
  stillMissingFiles: string[]
}

export interface OnboardingResult {
  success: boolean
  scanCounts?: ScanCounts & ScanBytes
  toolStatus?: ToolStatus
  cli?: string
  handoffResult?: OnboardingHandoffResult
  /** Present after verification when import delivery was checked. */
  verify?: OnboardingVerifyStats
  blockedPhase?: OnboardingPhase
  blockerReason?: string
}


export interface OnboardingSummary {
  projectTitle: string
  workspacePath: string
  scanCounts: ScanCounts & ScanBytes
  copyResult: { total: number; imported: number; copied: number; skipped: number; mdConverted: number; ocrConverted: number }
  cli: string
  handoffAction: string
  handoffResult: OnboardingHandoffResult
  toolStatus: ToolStatus
}


function today(): string {
  return new Date().toISOString().slice(0, 10)
}


// ── Shared context for phased onboarding ─────────────────────────────────

export interface OnboardingContext {
  workspacePath: string
  frameworkRoot: string
  sourcePath: string
  projectTitle: string
  scanCounts: ScanCounts & ScanBytes
  toolStatus: ToolStatus
  batches: ImportBatchManager
  rawDir: string
  copyableCount: number
}
export interface PhaseAccumulator {
  direct: PhaseResult
  markitdown: PhaseResult
  vision: PhaseResult
  ocr: PhaseResult
}

export function countDeliveredImportFiles(acc: PhaseAccumulator, recovered = 0): number {
  return acc.direct.converted
    + acc.direct.skipped
    + acc.markitdown.converted
    + acc.markitdown.skipped
    + (acc.vision?.converted ?? 0)
    + (acc.vision?.skipped ?? 0)
    + acc.ocr.converted
    + acc.ocr.skipped
    + recovered
}

// ── Phase A: Prepare (scan, batch selection, tool validation) ─────────────

export async function prepareOnboarding(
  options: OnboardingOptions,
): Promise<OnboardingContext | OnboardingResult> {
  const { workspacePath, frameworkRoot, sourcePath, projectTitle, flagExtensions, onPhase } = options
  spinosaLogInfo("onboard", `prepareOnboarding workspacePath=${options.workspacePath} sourcePath=${options.sourcePath}`)
  const phase = onPhase ?? (() => {})

  const batches = new ImportBatchManager()

  phase("scan", "Scanning source directory...")
  if (!existsSync(sourcePath)) {
    return { success: false, blockedPhase: "scan", blockerReason: `Source directory does not exist: ${sourcePath}` }
  }
  const scanCounts = await scanSource(sourcePath, batches)
  if (scanCounts.total === 0) {
    return { success: false, blockedPhase: "scan", blockerReason: "No importable files found in source directory" }
  }

  phase("batch_selection", "Selecting import batches...")
  if (flagExtensions) batches.parseExtensionsFromFlag(flagExtensions)
  if (!batches.validateExtensionsAgainstScan("")) batches.selectAll()
  const copyableCount = batches.selectedCount()
  if (copyableCount === 0 && !options.allowEmptySelection) {
    return { success: false, blockedPhase: "batch_selection", blockerReason: "No file types selected for import" }
  }

  phase("tool_validation", "Validating document conversion tools...")
  const toolStatus = await detectDocumentTools()

  const rawDir = path.join(workspacePath, "raw")
  mkdirSync(rawDir, { recursive: true })

  return { workspacePath, frameworkRoot, sourcePath, projectTitle, scanCounts, toolStatus, batches, rawDir, copyableCount }
}

// ── Phase C: Finalize (verification, CLI, prompt, summary) ────────────────

export async function completeOnboarding(
  ctx: OnboardingContext,
  acc: PhaseAccumulator,
  options: OnboardingOptions,
): Promise<OnboardingResult> {
  const { flagCli, flagLaunch, onPhase } = options
  const phase = onPhase ?? (() => {})

  phase("verification", "Verifying import delivery...")
  const { verifyAndRecoverImport } = await import("../import/pipeline")
  const verifyResult = await verifyAndRecoverImport(
    ctx.sourcePath, ctx.rawDir, ctx.batches,
    true, true,
    (msg: string) => onPhase?.("import", msg),
    options.shouldAbort,
    ctx.rawDir,
    undefined,
    undefined,
    options.ocrModelId,
  )

  const verify: OnboardingVerifyStats = {
    missing: verifyResult.missing,
    recovered: verifyResult.recovered,
    stillMissing: verifyResult.stillMissing,
    missingFiles: verifyResult.missingFiles,
    recoveredFiles: verifyResult.recoveredFiles,
    stillMissingFiles: verifyResult.stillMissingFiles,
  }
  const imported = countDeliveredImportFiles(
    acc,
    verifyResult.recovered + (options.additionalRecovered ?? 0),
  )
  if (imported === 0) {
    return {
      success: false,
      scanCounts: ctx.scanCounts,
      toolStatus: ctx.toolStatus,
      verify,
      blockedPhase: "verification",
      blockerReason: "No files were delivered to raw/",
    }
  }

  throwIfSpinosaCancelled(options.shouldAbort)
  phase("cli_selection", "Setting preferred CLI...")
  const cli = flagCli ?? "opencode"
  const cliLabel = preferredCliName(cli)

  throwIfSpinosaCancelled(options.shouldAbort)
  phase("cli_selection", `Writing setup files (CLI: ${cliLabel})...`)
  await writeSetupFiles(ctx.workspacePath, ctx.projectTitle, ctx.sourcePath, cliLabel)
  await writeWorkspaceStatus(ctx.workspacePath, "cli_started")

  phase("prompt", "Generating startup prompt...")
  const startupPrompt = await generateStartupPrompt(ctx.projectTitle, ctx.workspacePath, ctx.sourcePath, cliLabel, ctx.frameworkRoot)
  const startupPromptPath = path.join(ctx.workspacePath, "startup-prompt.md")
  try {
    await Bun.write(startupPromptPath, startupPrompt)
  } catch (error) {
    throw new Error(`Failed to write startup prompt at ${startupPromptPath}`, { cause: error })
  }
  const launchCommand = buildLaunchCommand(ctx.workspacePath, cli, startupPrompt)
  const copiedPrompt = copyToClipboard(startupPrompt)

  let handoffResult: OnboardingHandoffResult = copiedPrompt ? "prompt_copied" : "prompt_ready"
  if (flagLaunch === "run" && cli !== "other") {
    if (runCliWithPrompt(ctx.workspacePath, cli, startupPrompt)) {
      handoffResult = "run_requested"
    } else {
      handoffResult = copyToClipboard(launchCommand) ? "run_failed_command_copied" : "run_failed_command_ready"
    }
  } else {
    handoffResult = copyToClipboard(launchCommand) ? "launch_command_copied" : "launch_command_ready"
  }

  phase("complete", "Writing onboarding summary...")
  await writeOnboardingSummary({
    projectTitle: ctx.projectTitle,
    workspacePath: ctx.workspacePath,
    scanCounts: ctx.scanCounts,
    copyResult: {
      total: ctx.copyableCount,
      imported,
      copied: acc.direct.converted,
      skipped: acc.direct.skipped + acc.markitdown.skipped + (acc.vision?.skipped ?? 0) + acc.ocr.skipped,
      mdConverted: acc.markitdown.converted,
      ocrConverted: acc.ocr.converted,
      visionConverted: acc.vision?.converted ?? 0,
    } as never,
    cli: cliLabel,
    handoffAction: flagLaunch === "run" ? "Run launch command now" : "Copy launch command",
    handoffResult,
    toolStatus: ctx.toolStatus,
  })

  return {
    success: true,
    scanCounts: ctx.scanCounts,
    toolStatus: ctx.toolStatus,
    cli,
    handoffResult,
    verify,
  }
}

// ── Legacy wrapper: scans once, dispatches all 3 phase runners, then finalizes ─

export async function runOnboarding(
  options: OnboardingOptions,
): Promise<OnboardingResult> {
  const prepared = await prepareOnboarding(options)
  if ("success" in prepared && !prepared.success) return prepared
  const ctx = prepared as OnboardingContext

  const { onPhase, onCopyProgress } = options

  const { copySource } = await import("../import/pipeline")
  const result = await copySource(ctx.sourcePath, ctx.rawDir, {
    batchManager: ctx.batches,
    // Selected files must be reported as failed when a tool is unavailable;
    // passing false would silently omit them from copySource's attempt set.
    markitdownChoice: true,
    ocrChoice: true,
    verifyAfter: false,
    shouldAbort: options.shouldAbort,
    onProgress: onCopyProgress,
    onLog: (msg) => onPhase?.("import", msg),
    onPhaseChange: (phase) => {
      switch (phase) {
        case "direct":
          onPhase?.("direct", "Copying files...")
          spinosaLogInfo("onboard", "phase=direct running")
          break
        case "markitdown":
          onPhase?.("markitdown", "Converting with MarkItDown...")
          spinosaLogInfo("onboard", "phase=markitdown running")
          break
        case "ocr":
          onPhase?.("ocr", "Processing OCR...")
          spinosaLogInfo("onboard", "phase=ocr running")
          break
      }
    },
    onClassified: (classified) => {
      const classifyMsg = `Classified: ${classified.directFiles.length} direct, ${classified.markitdownFiles.length} markitdown, ${classified.ocrFiles.length} ocr`
      onPhase?.("import", classifyMsg)
      spinosaLogInfo("onboard", classifyMsg)
      if (classified.markitdownFiles.length > 0) {
        spinosaLogInfo("onboard", `markitdown files (${classified.markitdownFiles.length}): ${classified.markitdownFiles.map(f => f.rel).join(", ")}`)
      }
      if (classified.ocrFiles.length > 0) {
        spinosaLogInfo("onboard", `ocr files (${classified.ocrFiles.length}): ${classified.ocrFiles.map(f => f.rel).join(", ")}`)
      }
    },
  })

  return completeOnboarding(ctx, {
    direct: { converted: result.copied, skipped: result.skipped, failed: result.failed, renamed: 0, recoverable: [] },
    markitdown: { converted: result.mdConverted, skipped: result.mdSkipped, failed: result.mdFailed, renamed: 0, recoverable: [] },
    vision: { converted: 0, skipped: 0, failed: 0, renamed: 0, recoverable: [] },
    ocr: { converted: result.ocrConverted, skipped: result.ocrSkipped, failed: result.ocrFailed, renamed: 0, recoverable: [] },
  }, options)
}

async function writeOnboardingSummary(summary: OnboardingSummary): Promise<void> {
  const {
    projectTitle,
    workspacePath,
    scanCounts,
    copyResult,
    cli,
    handoffAction,
    handoffResult,
    toolStatus,
  } = summary

  const ocrMode = scanCounts.ocrConvertible > 0
    ? (copyResult.ocrConverted > 0 ? "tesseract_converted" : toolStatus.ocr ? "tesseract_available" : "tesseract_not_available")
    : "not_applicable"

  const markitdownMode = scanCounts.markitdown > 0
    ? (copyResult.mdConverted > 0 ? "markitdown_converted" : toolStatus.markitdown ? "markitdown_available" : "markitdown_not_bundled")
    : "not_applicable"

  const summaryPath = path.join(workspacePath, ".spinosa", "onboarding-summary.md")
  const content = `---
type: onboarding_summary
created: ${today()}
updated: ${today()}
---

# Onboarding Summary

## Workspace
- Initial workspace label: ${projectTitle}
- Workspace: ${workspacePath}
- Active corpus: raw/

## Scan Summary
- Text-based files to rename to Markdown: ${scanCounts.markdown}
- Office docs/HTML/EPUB via MarkItDown: ${scanCounts.markitdown}
- Native-readable files to copy unchanged: ${scanCounts.native}
- OCR candidates (PDFs → pdf.js text census, scanned → tesseract 300dpi ita+eng+fra; images → copy as-is): ${scanCounts.ocrConvertible}
- Videos (optional): ${scanCounts.video}
- Audio (optional): ${scanCounts.audio}
- Unsupported or unknown files: ${scanCounts.unknown}
- Ignored files: ${scanCounts.ignored}

## Workspace Import Result
- Selected import candidates: ${copyResult.total}
- Files imported into workspace: ${copyResult.imported}
- Files copied directly (incl. images kept as-is): ${copyResult.copied}
- Files skipped during direct copy: ${copyResult.skipped}
- MarkItDown converted: ${copyResult.mdConverted}
- MarkItDown mode: ${markitdownMode}
- OCR (tesseract ita+eng+fra) converted: ${copyResult.ocrConverted}
- OCR mode: ${ocrMode}

## Handoff
- Preferred CLI: ${cli}
- Handoff action: ${handoffAction}
- Handoff result: ${handoffResult}
`

  try {
    await Bun.write(summaryPath, content)
  } catch (error) {
    throw new Error(`Failed to write onboarding summary at ${summaryPath}`, { cause: error })
  }
}
