import path from "node:path"
import { existsSync, statSync } from "node:fs"
import { createWorkspace } from "@spinosa/core/commands/create"
import {
  completeOnboarding,
  countDeliveredImportFiles,
  prepareOnboarding,
  type OnboardingContext,
  type PhaseAccumulator,
} from "@spinosa/core/commands/onboard"
import {
  frameworkRootFailureDiagnostics,
  readFrameworkVersionFromRoot,
  resolveFrameworkRoot,
} from "@spinosa/core/framework/discovery"
import { applyResumeFilter, scanAndClassifySource, verifyAndRecoverImport, type PhaseResult } from "@spinosa/core/import/pipeline"
import { runImportWorkflow } from "@spinosa/core/import/import-workflow"
import { ImportBatchManager } from "@spinosa/core/import/batch"
import type { VisionTranscribe } from "@spinosa/core/import/vision-transcribe"
import { isSpinosaCancellationError } from "@spinosa/core/import/cancellation"
import { scanSource, detectDocumentTools } from "@spinosa/core/scan/scanner"
import { writeWorkspaceStatus } from "@spinosa/core/workspace/meta"
import { resolveWorkspacePath } from "@spinosa/core/commands/create"
import { ProgressEmitter } from "@spinosa/core/progress/progress"
import { bootLog, bootLogError } from "@spinosa/kernel-core/observability/boot-log"
import { sanitizeLogText } from "@spinosa/kernel-core/observability/sanitize-log"
import { EffectBridge } from "@/effect/bridge"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@spinosa/kernel-core/provider"
import { ModelV2 } from "@spinosa/kernel-core/model"

export type OnboardingPreview = {
  sources: Array<{
    path: string
    counts: {
      markdown: number
      markitdown: number
      native: number
      binaryCopyable: number
      ocrConvertible: number
      video: number
      audio: number
      unknown: number
      ignored: number
      total: number
    }
    batches: Array<{ ext: string; count: number; bytes: number }>
  }>
  batches: Array<{ ext: string; count: number; bytes: number }>
  suggestedWorkspacePath: string
}

export type OnboardingScanProgress = {
  status: "running" | "completed" | "failed" | "cancelled"
  sourceIndex: number
  sourceCount: number
  activeSource: string
  activeFile?: string
  current: number
  total: number
  error?: string
}

const previewScans = new Map<string, {
  directory: string
  progress: OnboardingScanProgress
  controller: AbortController
}>()
const MAX_PREVIEW_SCANS = 40

function updatePreviewScan(scanID: string | undefined, update: Partial<OnboardingScanProgress>) {
  if (!scanID) return
  const entry = previewScans.get(scanID)
  if (entry) entry.progress = { ...entry.progress, ...update }
}

export function getOnboardingScanProgress(scanID: string, directory?: string): OnboardingScanProgress | undefined {
  const entry = previewScans.get(scanID)
  if (!directory || !entry || path.resolve(entry.directory) !== path.resolve(directory)) return
  return { ...entry.progress }
}

export function cancelOnboardingScan(scanID: string, directory?: string): OnboardingScanProgress | undefined {
  const entry = previewScans.get(scanID)
  if (!directory || !entry || path.resolve(entry.directory) !== path.resolve(directory)) return
  if (entry.progress.status === "running") {
    entry.controller.abort()
    entry.progress = { ...entry.progress, status: "cancelled" }
  }
  return { ...entry.progress }
}

export type OnboardingToolStatus = Awaited<ReturnType<typeof detectDocumentTools>>

export async function checkOnboardingTools(): Promise<OnboardingToolStatus> {
  return detectDocumentTools()
}

export async function repairOnboardingTools(): Promise<{
  tools: OnboardingToolStatus
  output: string[]
  exitCode: number
}> {
  const frameworkRoot = resolveFrameworkRoot()
  if (!frameworkRoot) {
    const diagnostics = frameworkRootFailureDiagnostics()
    bootLog("onboarding.tools.framework.failure", "Onboarding tool repair could not resolve the framework root", { diagnostics })
    throw new Error("Spinosa framework root not found.", { cause: new Error(diagnostics) })
  }
  const installer = path.join(frameworkRoot, "install.sh")
  if (!existsSync(installer)) {
    bootLog("onboarding.tools.framework.failure", "Onboarding tool repair installer is missing", { frameworkRoot })
    throw new Error("install.sh not found in the framework root.")
  }
  const version = readFrameworkVersionFromRoot(frameworkRoot)
  if (!version || version === "dev") {
    bootLog("onboarding.tools.framework.failure", "Onboarding tool repair could not read the framework version", { frameworkRoot })
    throw new Error("Could not read the bundled Spinosa framework version.")
  }

  const child = Bun.spawn([
    "bash",
    installer,
    "--reinstall",
    "--version",
    version,
    "--yes",
    "--no-launch",
    "--no-bundled-tools",
  ], { stdout: "pipe", stderr: "pipe" })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
  }, 900_000)
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const output = [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)]
      .map((line) => sanitizeLogText(line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim()))
      .filter(Boolean)
      .slice(-MAX_LOGS)
    if (timedOut) output.push("Tool repair timed out after 15 minutes.")
    return {
      tools: await detectDocumentTools(),
      output,
      exitCode: timedOut ? 124 : status,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export type OnboardingStartInput = {
  sourcePaths: string[]
  workspaceName: string
  resumeWorkspacePath?: string
  extensions: string[]
  visionModelId: string
  preferredCli: string
}

export type OnboardingJobSnapshot = {
  id: string
  status: "running" | "waiting" | "completed" | "failed" | "cancelled"
  phase: string
  message: string
  workspacePath?: string
  current: number
  total: number
  activeFile?: string
  logs: string[]
  files: Array<{ relPath: string; status: string }>
  gate?:
    | { kind: "phase"; phase: string; count: number }
    | { kind: "vision"; relPath: string; message: string }
  error?: string
  result?: { success: boolean; imported: number; recovered: number; stillMissing: number; failed: number }
}

type OnboardingJobOptions = { requestID?: string }

type InternalJob = {
  snapshot: OnboardingJobSnapshot
  input: OnboardingStartInput
  sourceDirectory: string
  controller: AbortController
  background: boolean
  requestID: string
  startedAt: number
  phaseStartedAt: number
  progressEvents: number
  resolveAction?: (action: string) => void
  transcribeVision: VisionTranscribe
}

const jobs = new Map<string, InternalJob>()
const MAX_LOGS = 240
const MAX_FILES = 160
const MAX_JOBS = 40
const MAX_LOG_LENGTH = 4_000
const PROGRESS_LOG_INTERVAL = 25
const FINAL_STATUSES = new Set<OnboardingJobSnapshot["status"]>(["completed", "failed", "cancelled"])

const emptyPhase = (): PhaseResult => ({
  converted: 0,
  skipped: 0,
  failed: 0,
  renamed: 0,
  recoverable: [],
})

export function createProviderVisionTranscriber(provider: Provider.Interface, bridge: EffectBridge.Shape): VisionTranscribe {
  return async (request) => {
    if (request.signal?.aborted) throw new DOMException("Vision cancelled", "AbortError")
    const model = await bridge.promise(
      provider.getModel(request.providerID as ProviderV2.ID, request.modelID as ModelV2.ID),
    )
    const language = await bridge.promise(provider.getLanguage(model))
    const controller = new AbortController()
    const abort = () => controller.abort()
    let abortRequest: (() => void) | undefined
    request.signal?.addEventListener("abort", abort, { once: true })
    const timeoutPromise = new Promise<never>((_, reject) => {
      abortRequest = () => reject(new Error("Vision transcription cancelled"))
      request.signal?.addEventListener("abort", abortRequest, { once: true })
    })
    let timeoutID: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timeoutID = setTimeout(() => {
        controller.abort()
        reject(new Error("Vision provider timed out after 120 seconds"))
      }, 120_000)
    })
    try {
      const { generateText } = await import("ai")
      const result = await Promise.race([
        (generateText as unknown as (options: unknown) => Promise<{ text?: string }>)({
          model: language as unknown,
          abortSignal: controller.signal,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: request.prompt },
              { type: "image", image: `data:${request.image.mime};base64,${request.image.data}` },
            ],
          }],
        }),
        timeout,
        timeoutPromise,
      ])
      const text = result.text?.trim()
      if (!text) throw new Error("Vision model returned no text")
      return text
    } finally {
      if (timeoutID) clearTimeout(timeoutID)
      request.signal?.removeEventListener("abort", abort)
      if (abortRequest) request.signal?.removeEventListener("abort", abortRequest)
    }
  }
}

export async function previewOnboarding(
  sourcePaths: readonly string[],
  scanID?: string,
  requestID: string = crypto.randomUUID(),
): Promise<OnboardingPreview> {
  if (sourcePaths.length === 0 || sourcePaths.length > 24) throw new Error("Choose between 1 and 24 source folders.")
  const startedAt = Date.now()
  bootLog("onboarding.scan.start", "Onboarding source scan started", {
    requestID,
    scanID,
    sourceCount: sourcePaths.length,
  })
  if (scanID) {
    const controller = new AbortController()
    previewScans.set(scanID, {
      directory: path.resolve(sourcePaths[0]!),
      progress: {
        status: "running",
        sourceIndex: 1,
        sourceCount: sourcePaths.length,
        activeSource: path.resolve(sourcePaths[0]!),
        current: 0,
        total: 0,
      },
      controller,
    })
    while (previewScans.size > MAX_PREVIEW_SCANS) previewScans.delete(previewScans.keys().next().value!)
  }
  const controller = scanID ? previewScans.get(scanID)?.controller : undefined
  const shouldAbort = () => controller?.signal.aborted ?? false
  try {
    const sources: OnboardingPreview["sources"] = []
    const combined = new Map<string, { ext: string; count: number; bytes: number }>()
    for (let index = 0; index < sourcePaths.length; index++) {
      const sourcePath = path.resolve(sourcePaths[index]!)
      if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
        throw new Error(`Source folder does not exist: ${sourcePath}`)
      }
      const batches = new ImportBatchManager()
       updatePreviewScan(scanID, {
         sourceIndex: index + 1,
         activeSource: sourcePath,
         activeFile: undefined,
         current: 0,
         total: 0,
       })
       bootLog("onboarding.scan.source", "Onboarding source scan phase started", {
         requestID,
         scanID,
         sourceIndex: index + 1,
         sourceCount: sourcePaths.length,
       })
       const scan = await scanSource(

        sourcePath,
        batches,
        (event) => updatePreviewScan(scanID, {
          activeFile: path.relative(sourcePath, event.filePath),
          current: event.current,
          total: event.total,
        }),
        shouldAbort,
      )
      if (shouldAbort()) throw new DOMException("Source scan cancelled", "AbortError")
      const sourceBatches = batches.batches.map((batch) => ({ ...batch }))
      for (const batch of sourceBatches) {
        const existing = combined.get(batch.ext)
        if (existing) {
          existing.count += batch.count
          existing.bytes += batch.bytes
        } else {
          combined.set(batch.ext, { ...batch })
        }
      }
      const { files: _files, ...counts } = scan
      sources.push({ path: sourcePath, counts, batches: sourceBatches })
    }
    const primary = sources[0]!.path
    const result = {
      sources,
      batches: [...combined.values()].sort((a, b) => a.ext.localeCompare(b.ext)),
      suggestedWorkspacePath: resolveWorkspacePath(primary),
    }
    if (shouldAbort()) throw new DOMException("Source scan cancelled", "AbortError")
    updatePreviewScan(scanID, { status: "completed", activeFile: undefined })
    bootLog("onboarding.scan.complete", "Onboarding source scan completed", {
      requestID,
      scanID,
      sourceCount: sourcePaths.length,
      batchCount: result.batches.length,
      durationMs: Date.now() - startedAt,
    })
    return result
  } catch (cause) {
    const status = shouldAbort() ? "cancelled" : "failed"
    updatePreviewScan(scanID, {
      status,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    bootLogError(`onboarding.scan.error.${requestID}`, cause)
    bootLog("onboarding.scan.failed", "Onboarding source scan failed", {
      requestID,
      scanID,
      status,
      durationMs: Date.now() - startedAt,
    })
    throw cause
  }
}

function snapshot(job: InternalJob): OnboardingJobSnapshot {
  return {
    ...job.snapshot,
    logs: [...job.snapshot.logs],
    files: job.snapshot.files.map((file) => ({ ...file })),
    ...(job.snapshot.gate ? { gate: { ...job.snapshot.gate } } : {}),
    ...(job.snapshot.result ? { result: { ...job.snapshot.result } } : {}),
  }
}

function errorLogText(error: unknown, depth = 0, seen = new Set<unknown>()): string {
  if (depth > 8) return "[error chain truncated]"
  if (!(error instanceof Error)) return String(error)
  if (seen.has(error)) return "[Circular]"
  seen.add(error)
  const lines = [`${error.name}: ${error.message}`]
  if (error.stack) lines.push(error.stack)
  if (error.cause !== undefined) lines.push(`Caused by:\n${errorLogText(error.cause, depth + 1, seen)}`)
  return sanitizeLogText(lines.join("\n")).slice(0, MAX_LOG_LENGTH)
}

function appendLog(job: InternalJob, message: string) {
  const clean = sanitizeLogText(message.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trimEnd()).slice(0, MAX_LOG_LENGTH)
  if (!clean) return
  job.snapshot.logs.push(clean)
  if (job.snapshot.logs.length > MAX_LOGS) job.snapshot.logs.splice(0, job.snapshot.logs.length - MAX_LOGS)
}

function setPhase(job: InternalJob, phase: string, message: string) {
  const now = Date.now()
  const previous = job.snapshot.phase
  const previousPhaseStartedAt = job.phaseStartedAt
  job.snapshot.status = "running"
  job.snapshot.phase = phase
  job.snapshot.message = message
  job.snapshot.gate = undefined
  job.phaseStartedAt = now
  if (previous !== phase) {
    bootLog("onboarding.job.phase", "Onboarding job phase changed", {
      jobID: job.snapshot.id,
      requestID: job.requestID,
      from: previous,
      to: phase,
      phaseDurationMs: now - previousPhaseStartedAt,
      totalDurationMs: now - job.startedAt,
    })
  }
}

function waitForAction(
  job: InternalJob,
  gate: NonNullable<OnboardingJobSnapshot["gate"]>,
): Promise<string> {
  const now = Date.now()
  job.snapshot.status = "waiting"
  job.snapshot.gate = gate
  job.snapshot.phase = gate.kind === "phase" ? gate.phase : "vision"
  job.snapshot.message = gate.kind === "phase"
    ? `${gate.phase}: ${gate.count} files are ready for this step.`
    : gate.message
  bootLog("onboarding.job.waiting", "Onboarding job is waiting for an action", {
    jobID: job.snapshot.id,
    requestID: job.requestID,
    phase: job.snapshot.phase,
    gate: gate.kind,
    totalDurationMs: now - job.startedAt,
  })
  return new Promise((resolve) => {
    job.resolveAction = (action) => {
      const decidedAt = Date.now()
      job.resolveAction = undefined
      job.snapshot.gate = undefined
      if (!job.controller.signal.aborted) job.snapshot.status = "running"
      bootLog("onboarding.job.action", "Onboarding job action received", {
        jobID: job.snapshot.id,
        requestID: job.requestID,
        action,
        phase: job.snapshot.phase,
        waitDurationMs: decidedAt - now,
        totalDurationMs: decidedAt - job.startedAt,
      })
      resolve(action)
    }
  })
}

function updateProgress(job: InternalJob, event: { phase: string; current: number; total: number; relPath: string; status?: string }) {
  job.snapshot.phase = event.phase
  job.snapshot.current = event.current
  job.snapshot.total = event.total
  job.progressEvents++
  if (event.relPath) {
    job.snapshot.activeFile = event.relPath
    const existing = job.snapshot.files.find((file) => file.relPath === event.relPath)
    if (existing) existing.status = event.status ?? "processing"
    else job.snapshot.files.push({ relPath: event.relPath, status: event.status ?? "processing" })
    if (job.snapshot.files.length > MAX_FILES) job.snapshot.files.splice(0, job.snapshot.files.length - MAX_FILES)
  }
  if (job.progressEvents === 1 || job.progressEvents % PROGRESS_LOG_INTERVAL === 0) {
    bootLog("onboarding.job.progress", "Onboarding job progress checkpoint", {
      jobID: job.snapshot.id,
      requestID: job.requestID,
      phase: event.phase,
      current: event.current,
      total: event.total,
      eventCount: job.progressEvents,
      durationMs: Date.now() - job.startedAt,
    })
  }
}

function mergePhase(target: PhaseResult, addition: PhaseResult) {
  target.converted += addition.converted
  target.skipped += addition.skipped
  target.failed += addition.failed
  target.renamed += addition.renamed
  target.recoverable.push(...addition.recoverable)
}

function deliveredCount(acc: PhaseAccumulator) {
  return countDeliveredImportFiles(acc)
}

function selectedFiles(classified: NonNullable<Awaited<ReturnType<typeof scanAndClassifySource>>>) {
  return classified.directFiles.length
    + classified.copyFiles.length
    + classified.markitdownFiles.length
    + classified.visionFiles.length
    + classified.ocrFiles.length
}

export async function startOnboardingJob(
  input: OnboardingStartInput,
  sourceDirectory: string,
  transcribeVision: VisionTranscribe,
  options?: OnboardingJobOptions,
): Promise<{ id: string; workspacePath: string }> {
  for (const job of jobs.values()) {
    if (!FINAL_STATUSES.has(job.snapshot.status)) throw new Error("A Spinosa onboarding job is already running.")
  }
  while (jobs.size >= MAX_JOBS) {
    const oldestFinal = [...jobs].find(([, job]) => FINAL_STATUSES.has(job.snapshot.status))?.[0]
    if (!oldestFinal) break
    jobs.delete(oldestFinal)
  }
  if (input.sourcePaths.length === 0 || input.sourcePaths.length > 24) throw new Error("Choose between 1 and 24 source folders.")
  if (path.resolve(sourceDirectory) !== path.resolve(input.sourcePaths[0]!)) {
    throw new Error("The routed directory must match the first source folder.")
  }
  if (input.extensions.length === 0) throw new Error("Select at least one file type to import.")

  const id = crypto.randomUUID()
  const requestID = options?.requestID ?? crypto.randomUUID()
  const startedAt = Date.now()
  const workspacePath = input.resumeWorkspacePath
    ? path.resolve(input.resumeWorkspacePath)
    : resolveWorkspacePath(input.sourcePaths[0]!, input.workspaceName)
  const job: InternalJob = {
    snapshot: {
      id,
      status: "running",
      phase: "queued",
      message: "Preparing workspace…",
      workspacePath,
      current: 0,
      total: 0,
      logs: [],
      files: [],
    },
    input: { ...input, sourcePaths: input.sourcePaths.map((source) => path.resolve(source)) },
    sourceDirectory,
    controller: new AbortController(),
    background: false,
    requestID,
    startedAt,
    phaseStartedAt: startedAt,
    progressEvents: 0,
    transcribeVision,
  }

  jobs.set(id, job)
  bootLog("onboarding.job.start", "Onboarding job started", {
    jobID: id,
    requestID,
    sourceCount: input.sourcePaths.length,
    extensionCount: input.extensions.length,
    resumed: Boolean(input.resumeWorkspacePath),
  })
  void executeOnboardingJob(job)
  return { id, workspacePath }
}

async function executeSource(
  job: InternalJob,
  ctx: OnboardingContext,
  sourcePath: string,
  subfolder: string | undefined,
  acc: PhaseAccumulator,
  confirmed: boolean,
): Promise<number> {
  const shouldAbort = () => job.controller.signal.aborted
  const classified = await scanAndClassifySource(
    sourcePath,
    ctx.rawDir,
    ctx.batches,
    subfolder,
    shouldAbort,
    job.input.visionModelId,
    sourcePath === ctx.sourcePath ? ctx.scannedFiles : undefined,
  )
  if (!classified) {
    appendLog(job, `No importable files found in ${sourcePath}`)
    return 0
  }

  const resume = applyResumeFilter(classified, classified.logsDir, {
    modelId: job.input.visionModelId,
    onLog: (message) => appendLog(job, message),
  })
  for (const relPath of resume.skippedUnchanged) {
    updateProgress(job, { phase: "resume", current: 0, total: 0, relPath, status: "done" })
  }

  const prog = new ProgressEmitter()
  prog.on((event) => updateProgress(job, event))
  const result = await runImportWorkflow(classified, {
    prog,
    shouldAbort,
    signal: job.controller.signal,
    ocrModelId: () => job.input.visionModelId,
    transcribeVision: job.transcribeVision,
    onLog: (message) => appendLog(job, message),
    onRetry: (attempt, reason) => appendLog(job, `Retry ${attempt}: ${reason}`),
    onRename: (original, renamed) => appendLog(job, `Renamed ${original} → ${renamed}`),
    beforePhase: async (phase, count) => {
      if (shouldAbort()) return false
      setPhase(job, phase, `${subfolder ? `${subfolder}: ` : ""}${phase} · ${count} files`)
      if (!confirmed || phase === "direct" || phase === "copy" || job.background) return true
      return (await waitForAction(job, { kind: "phase", phase, count })) === "continue" && !shouldAbort()
    },
    afterPhase: (phase, phaseResult) => {
      appendLog(job, `${subfolder ? `${subfolder}: ` : ""}${phase} complete · ${phaseResult.converted} imported, ${phaseResult.failed} failed`)
    },
    onVisionFailure: async (relPath, modelId, error) => {
      if (shouldAbort()) return "abort"
      const action = await waitForAction(job, {
        kind: "vision",
        relPath,
        message: `${relPath}: ${error}`,
      })
      return action === "retry" || action === "skip" ? action : "abort"
    },
  })
  mergePhase(acc.direct, result.direct)
  mergePhase(acc.direct, result.copy)
  mergePhase(acc.markitdown, result.markitdown)
  mergePhase(acc.pdf, result.pdf)
  mergePhase(acc.vision, result.vision)
  mergePhase(acc.ocr, result.ocr)
  return selectedFiles(classified)
}

async function executeOnboardingJob(job: InternalJob): Promise<void> {
  const shouldAbort = () => job.controller.signal.aborted
  const primarySource = job.input.sourcePaths[0]!
  try {
    const frameworkStartedAt = Date.now()
    const frameworkRoot = resolveFrameworkRoot()
    if (!frameworkRoot) {
      const diagnostics = frameworkRootFailureDiagnostics()
      appendLog(job, diagnostics)
      bootLog("onboarding.framework.failure", "Onboarding framework discovery failed", {
        jobID: job.snapshot.id,
        requestID: job.requestID,
        durationMs: Date.now() - frameworkStartedAt,
        diagnostics,
      })
      throw new Error("Spinosa framework root not found.", { cause: new Error(diagnostics) })
    }
    bootLog("onboarding.framework.resolved", "Onboarding framework root resolved", {
      jobID: job.snapshot.id,
      requestID: job.requestID,
      frameworkRoot,
      frameworkVersion: readFrameworkVersionFromRoot(frameworkRoot),
      durationMs: Date.now() - frameworkStartedAt,
    })
    setPhase(job, "setup", "Creating workspace from the Spinosa template…")
    const created = await createWorkspace({
      corpusPath: primarySource,
      frameworkRoot,
      workspaceName: job.input.workspaceName,
      resumeWorkspacePath: job.input.resumeWorkspacePath,
      onProgress: (message) => {
        job.snapshot.message = message
        appendLog(job, message)
      },
      shouldAbort,
    })
    if (!created.success) {
      bootLog("onboarding.workspace.failure", "Onboarding workspace creation failed", {
        jobID: job.snapshot.id,
        requestID: job.requestID,
        frameworkRoot,
      })
      throw new Error("Workspace template could not be created.")
    }
    job.snapshot.workspacePath = created.workspacePath
    await writeWorkspaceStatus(created.workspacePath, "importing")

    setPhase(job, "scan", "Preparing the selected source files…")
    const prepared = await prepareOnboarding({
      workspacePath: created.workspacePath,
      frameworkRoot,
      sourcePath: primarySource,
      projectTitle: job.input.workspaceName || created.projectName,
      flagExtensions: job.input.extensions.join(","),
      allowEmptySelection: job.input.sourcePaths.length > 1,
      onPhase: (phase, message) => {
        setPhase(job, phase, message)
        appendLog(job, message)
      },
      shouldAbort,
    })
    if ("success" in prepared) throw new Error(prepared.blockerReason ?? "Workspace import could not be prepared.")
    const ctx = prepared
    ctx.batches.parseExtensionsFromFlag(job.input.extensions.join(","))

    const acc: PhaseAccumulator = {
      direct: emptyPhase(),
      markitdown: emptyPhase(),
      pdf: emptyPhase(),
      vision: emptyPhase(),
      ocr: emptyPhase(),
    }
    let selectedCount = 0
    let additionalRecovered = 0
    let totalStillMissing = 0

    selectedCount += await executeSource(job, ctx, primarySource, undefined, acc, true)
    for (let index = 1; index < job.input.sourcePaths.length; index++) {
      if (shouldAbort()) break
      const sourcePath = job.input.sourcePaths[index]!
      const subfolder = `source-${index + 1}`
      appendLog(job, `Processing additional source as ${subfolder}/`)
      selectedCount += await executeSource(job, ctx, sourcePath, subfolder, acc, false)
      const verify = await verifyAndRecoverImport(
        sourcePath,
        ctx.rawDir,
        ctx.batches,
        true,
        true,
        (message) => appendLog(job, message),
        shouldAbort,
        ctx.rawDir,
        subfolder,
        undefined,
        job.input.visionModelId,
      )
      additionalRecovered += verify.recovered
      totalStillMissing += verify.stillMissing
    }
    if (shouldAbort()) throw new DOMException("Onboarding cancelled", "AbortError")

    ctx.copyableCount = selectedCount
    setPhase(job, "verification", "Verifying every imported file…")
    const completed = await completeOnboarding(ctx, acc, {
      workspacePath: created.workspacePath,
      frameworkRoot,
      sourcePath: primarySource,
      projectTitle: job.input.workspaceName || created.projectName,
      flagCli: job.input.preferredCli,
      handoffMode: "none",
      ocrModelId: job.input.visionModelId,
      additionalRecovered,
      onPhase: (phase, message) => {
        setPhase(job, phase, message)
        appendLog(job, message)
      },
      shouldAbort,
    })
    if (shouldAbort()) throw new DOMException("Onboarding cancelled", "AbortError")

    const verify = completed.verify
    totalStillMissing += verify?.stillMissing ?? 0
    const failed = acc.direct.failed + acc.markitdown.failed + acc.pdf.failed + acc.vision.failed + acc.ocr.failed
    job.snapshot.result = {
      success: completed.success,
      imported: deliveredCount(acc) + (verify?.recovered ?? 0) + additionalRecovered,
      recovered: (verify?.recovered ?? 0) + additionalRecovered,
      stillMissing: totalStillMissing,
      failed,
    }
    job.snapshot.status = completed.success ? "completed" : "failed"
    job.snapshot.phase = completed.success ? "done" : "error"
    job.snapshot.message = completed.success
      ? "Workspace onboarding is complete."
      : completed.blockerReason ?? "Onboarding completed with no delivered files."
    appendLog(job, job.snapshot.message)
    bootLog("onboarding.job.complete", "Onboarding job completed", {
      jobID: job.snapshot.id,
      requestID: job.requestID,
      status: job.snapshot.status,
      phase: job.snapshot.phase,
      durationMs: Date.now() - job.startedAt,
      phaseDurationMs: Date.now() - job.phaseStartedAt,
      result: job.snapshot.result,
    })
  } catch (error) {
    const cancelled = shouldAbort() || isSpinosaCancellationError(error) || (error instanceof DOMException && error.name === "AbortError")
    job.snapshot.status = cancelled ? "cancelled" : "failed"
    job.snapshot.phase = cancelled ? "cancelled" : "error"
    job.snapshot.error = error instanceof Error ? error.message : String(error)
    appendLog(job, errorLogText(error))
    job.snapshot.message = cancelled ? "Onboarding cancelled. This workspace can be resumed later." : job.snapshot.error
    if (cancelled) appendLog(job, job.snapshot.message)
    bootLogError(`onboarding.job.error.${job.snapshot.id}`, error)
    bootLog("onboarding.job.finished", "Onboarding job finished", {
      jobID: job.snapshot.id,
      requestID: job.requestID,
      status: job.snapshot.status,
      phase: job.snapshot.phase,
      durationMs: Date.now() - job.startedAt,
      phaseDurationMs: Date.now() - job.phaseStartedAt,
      error: job.snapshot.error,
    })

  } finally {
    job.snapshot.gate = undefined
    job.resolveAction = undefined
  }
}

function scopedJob(id: string, directory?: string): InternalJob | undefined {
  if (!directory) return
  const job = jobs.get(id)
  if (!job || path.resolve(job.sourceDirectory) !== path.resolve(directory)) return
  return job
}

export function getOnboardingJob(id: string, directory?: string): OnboardingJobSnapshot | undefined {
  const job = scopedJob(id, directory)
  return job ? snapshot(job) : undefined
}

export function getActiveOnboardingJob(directory?: string): OnboardingJobSnapshot | undefined {
  if (!directory) return
  const resolved = path.resolve(directory)
  const job = [...jobs.values()].find((candidate) =>
    !FINAL_STATUSES.has(candidate.snapshot.status)
    && path.resolve(candidate.sourceDirectory) === resolved,
  )
  return job ? snapshot(job) : undefined
}

export function resolveOnboardingJobAction(
  id: string,
  action: string,
  directory?: string,
  visionModelId?: string,
  requestID?: string,
): OnboardingJobSnapshot | undefined {
  const job = scopedJob(id, directory)
  if (!job) return
  const correlationID = requestID ?? job.requestID
  if (action === "background") {
    job.background = true
    if (job.snapshot.gate?.kind === "phase") job.resolveAction?.("continue")
    bootLog("onboarding.job.action", "Onboarding job action accepted", {
      jobID: job.snapshot.id,
      requestID: correlationID,
      action,
      phase: job.snapshot.phase,
    })
    return snapshot(job)
  }
  const gate = job.snapshot.gate
  if (!gate || !job.resolveAction) {
    bootLog("onboarding.job.action.ignored", "Onboarding job action ignored", {
      jobID: job.snapshot.id,
      requestID: correlationID,
      action,
      phase: job.snapshot.phase,
      reason: !gate ? "no-gate" : "not-waiting",
    })
    return snapshot(job)
  }
  if (gate.kind === "phase" && action !== "continue" && action !== "abort") {
    bootLog("onboarding.job.action.ignored", "Onboarding job action ignored", {
      jobID: job.snapshot.id,
      requestID: correlationID,
      action,
      phase: job.snapshot.phase,
      reason: "invalid-phase-action",
    })
    return snapshot(job)
  }
  if (gate.kind === "vision" && action !== "retry" && action !== "changeModel" && action !== "skip" && action !== "abort") {
    bootLog("onboarding.job.action.ignored", "Onboarding job action ignored", {
      jobID: job.snapshot.id,
      requestID: correlationID,
      action,
      phase: job.snapshot.phase,
      reason: "invalid-vision-action",
    })
    return snapshot(job)
  }
  if (action === "changeModel") {
    if (!visionModelId || !visionModelId.includes("/")) return snapshot(job)
    job.input.visionModelId = visionModelId
  }
  if (action === "abort") job.controller.abort()
  job.resolveAction(action === "changeModel" ? "retry" : action)
  return snapshot(job)
}

export function cancelOnboardingJob(id: string, directory?: string, requestID?: string): OnboardingJobSnapshot | undefined {
  const job = scopedJob(id, directory)
  if (!job) return
  if (!FINAL_STATUSES.has(job.snapshot.status)) {
    job.controller.abort()
    job.resolveAction?.("abort")
    bootLog("onboarding.job.cancel", "Onboarding job cancellation requested", {
      jobID: job.snapshot.id,
      requestID: requestID ?? job.requestID,
      phase: job.snapshot.phase,
    })
  }
  return snapshot(job)
}
