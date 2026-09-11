import { createSignal } from "solid-js"
import { createSimpleContext } from "../context/helper"
import { createImportJob, type ImportJobHandle } from "./job-events"
import { logAction } from "./log"
import type { ImportProcessorId } from "@spinosa/core/import/processors"
import type { FileProgressStatus } from "@spinosa/core/progress/progress"
import type { ImportFileProgressItem } from "./import-progress-ui"

export type BgVisionAction = "retry" | "skip" | "abort"
export type BgRunKind = "onboarding" | "add-files"
export type BgPhase = ImportProcessorId | "setup" | "verification" | "idle" | "done"

export type BgRunSummary = {
  converted: number
  skipped: number
  failed: number
  renamed: number
  recovered: number
  stillMissing: number
  text: string
  success: boolean
}

export type BgPendingGate = {
  id: ImportProcessorId
  count: number
  label: string
} | undefined

export type BgVisionPause = {
  rel: string
  modelId: string
  error: string
  isAuth: boolean
} | undefined

const MAX_BG_LOG_LINES = 300

const EMPTY_VISION_RESULT = /vision model returned no text|empty response|empty image data/i
const VISION_AUTH_ERROR =
  /401|403|Incorrect API key|invalid_api_key|authentication|No valid API key|missing.*API key|insufficient permissions|Missing scopes|api\.responses\.write/i

export type BackgroundImportService = ReturnType<typeof createBackgroundImportService>

/**
 * App-scope owner of one import run (onboarding or add-files). Survives
 * wizard unmount so the run can continue in the background while the user
 * works in the workspace home. Both the wizard (foreground) and the home
 * monitor dialog (background) are thin views over this state; queue
 * promises (phase gates, vision pauses) resolve from either UI.
 */
export function createBackgroundImportService() {
  const [active, setActive] = createSignal(false)
  const [background, setBackground] = createSignal(false)
  const [kind, setKind] = createSignal<BgRunKind>("onboarding")
  const [runWorkspacePath, setRunWorkspacePath] = createSignal<string | undefined>(undefined)
  const [phase, setPhase] = createSignal<BgPhase>("idle")
  const [phaseLabel, setPhaseLabel] = createSignal("")
  const [currentFile, setCurrentFile] = createSignal("")
  const [progCurrent, setProgCurrent] = createSignal(0)
  const [progTotal, setProgTotal] = createSignal(1)
  const [files, setFiles] = createSignal<ImportFileProgressItem[]>([])
  const [logLines, setLogLines] = createSignal<string[]>([])
  const [modelId, setModelIdSignal] = createSignal("tesseract-local")
  const [visionError, setVisionError] = createSignal<string | undefined>(undefined)
  const [visionPause, setVisionPause] = createSignal<BgVisionPause>(undefined)
  const [pendingGate, setPendingGate] = createSignal<BgPendingGate>(undefined)
  const [lastAuthFailedProvider, setLastAuthFailedProvider] = createSignal<string | undefined>(undefined)
  const [done, setDone] = createSignal(false)
  const [success, setSuccess] = createSignal(false)
  const [summary, setSummary] = createSignal<BgRunSummary | undefined>(undefined)
  const [cancelled, setCancelled] = createSignal(false)
  // Monotonic run counter so UI caches (toast dedup) can key per run.
  const [runSeq, setRunSeq] = createSignal(0)

  let job: ImportJobHandle | undefined
  let aborted = false
  let pauseResolve: ((action: BgVisionAction) => void) | undefined
  let pauseAbortTimer: ReturnType<typeof setInterval> | undefined
  let gateResolve: ((proceed: boolean) => void) | undefined
  let credentialNote: ((providerId: string) => string) | undefined

  const appendLog = (msg: string) =>
    setLogLines((prev) => [...prev.slice(-MAX_BG_LOG_LINES + 1), msg])

  const clearPauseTimer = () => {
    if (pauseAbortTimer) {
      clearInterval(pauseAbortTimer)
      pauseAbortTimer = undefined
    }
  }

  function resetRunState() {
    aborted = false
    pauseResolve = undefined
    gateResolve = undefined
    clearPauseTimer()
    setPhase("idle")
    setPhaseLabel("")
    setCurrentFile("")
    setProgCurrent(0)
    setProgTotal(1)
    setFiles([])
    setLogLines([])
    setVisionError(undefined)
    setVisionPause(undefined)
    setPendingGate(undefined)
    setLastAuthFailedProvider(undefined)
    setDone(false)
    setSuccess(false)
    setSummary(undefined)
    setCancelled(false)
    setBackground(false)
  }

  /**
   * Begin ownership of a run. Returns undefined when a run is already
   * active (single-flight) — callers must surface that instead of
   * overlapping imports.
   */
  function start(input: {
    kind: BgRunKind
    title: string
    directory?: string
    workspacePath?: string
    modelId: string
    publish?: Parameters<typeof createImportJob>[0]["publish"]
    localEmit?: Parameters<typeof createImportJob>[0]["localEmit"]
    credentialNote?: (providerId: string) => string
  }):
    | {
        job: ImportJobHandle
        shouldAbort: () => boolean
      }
    | undefined {
    if (active()) return undefined
    resetRunState()
    setRunSeq((n) => n + 1)
    logAction("import-bg", `Run started (${input.kind}, model=${input.modelId}, workspace=${input.workspacePath ?? "?"})`)
    credentialNote = input.credentialNote
    setActive(true)
    setKind(input.kind)
    setRunWorkspacePath(input.workspacePath)
    setModelIdSignal(input.modelId)
    job = createImportJob({
      kind: "import",
      title: input.title,
      directory: input.workspacePath ?? input.directory,
      publish: input.publish,
      localEmit: input.localEmit,
    })
    job.start()
    return { job, shouldAbort }
  }

  function shouldAbort(): boolean {
    return aborted || (job?.shouldAbort() ?? false)
  }

  function registerChild(child: import("node:child_process").ChildProcess) {
    job?.registerChild(child)
  }

  function reportProgress(e: { relPath?: string; status?: FileProgressStatus; phase?: string; current?: number; total?: number }) {
    if (e.relPath && e.status === "processing") setCurrentFile(e.relPath)
    else if (e.relPath && (e.status === "done" || e.status === "failed" || e.status === "error")) {
      if (e.relPath === currentFile()) setCurrentFile("")
    }
    if (e.status && e.relPath) {
      const key = e.relPath
      setFiles((prev) => {
        const idx = prev.findIndex((i) => i.rel === key)
        if (idx >= 0) {
          const next = prev.slice()
          next[idx] = { ...next[idx]!, status: e.status! }
          return next
        }
        return [...prev, { rel: key, status: e.status! }]
      })
    } else if (e.phase === "setup" && e.total !== undefined && e.current !== undefined) {
      setProgTotal(e.total > 0 ? e.total : 1)
      setProgCurrent(Math.max(0, e.current))
    }
  }

  function seedQueue(rels: string[]) {
    setFiles((prev) => {
      const known = new Set(prev.map((i) => i.rel))
      return [...prev, ...rels.filter((r) => !known.has(r)).map((rel) => ({ rel, status: "queued" as const }))]
    })
  }

  function reportStatus(label: string) {
    setPhaseLabel(label)
  }

  /**
   * Phase-log sink: mirrors the wizard's log parsing — `  `-indented lines
   * become the live status (formatted by the caller), vision errors surface
   * during transcription phases, everything lands in the bounded log.
   */
  function reportPhaseLog(msg: string, formatStatus: (label: string) => string) {
    if (msg.startsWith("  ")) {
      const label = msg.trim()
      const transcribing = phase() === "markitdown" || phase() === "vision"
      if (label.includes("Vision ") && label.includes(" error ") && transcribing) {
        setVisionError(label.replace(/^.*Vision /, "Vision ").slice(0, 160))
      }
      setPhaseLabel(formatStatus(label))
      return
    }
    const transcribing = phase() === "markitdown" || phase() === "vision"
    if (msg.includes("Vision model") && msg.includes("unavailable") && transcribing) {
      setVisionError(msg.slice(0, 160))
    }
    appendLog(msg)
  }

  function reportVerifyStatus(_label: string) {
    // Verify sub-status merges into the phase label; kept separate for
    // wizard compat (wizard maps it onto its own verify signal).
  }

  /**
   * Shared vision-failure policy (was duplicated per wizard): empty results
   * skip without pausing; auth/other errors pause the queue until a UI
   * (wizard red button or home monitor) resolves retry/skip/abort.
   */
  function onVisionFailure(rel: string, failureModelId: string, error: string): Promise<BgVisionAction> {
    if (EMPTY_VISION_RESULT.test(error)) {
      logAction("vision", `Vision empty result for ${rel} (${failureModelId}) — marked failed, continuing`)
      return Promise.resolve("skip")
    }
    const isAuth = VISION_AUTH_ERROR.test(error)
    const prov = failureModelId.includes("/") ? failureModelId.slice(0, failureModelId.indexOf("/")) : failureModelId
    if (isAuth) {
      setLastAuthFailedProvider(prov)
      setVisionError(
        `Authentication failed for ${prov} (${failureModelId}) — ${error.slice(0, 150)}${credentialNote?.(prov) ?? ""} — Please re-authenticate the provider, then retry. Queue paused.`,
      )
    } else {
      setLastAuthFailedProvider(undefined)
      setVisionError(
        `Vision ${failureModelId} error for ${rel} — ${error.slice(0, 180)} — queue paused — Pick a new model to retry, skip the file, or cancel the run.`,
      )
    }
    setVisionPause({ rel, modelId: failureModelId, error, isAuth })
    logAction("import-bg", `Vision queue paused for ${rel} (${isAuth ? "auth" : "error"})`)
    return new Promise<BgVisionAction>((resolve) => {
      pauseResolve = resolve
      pauseAbortTimer = setInterval(() => {
        if (shouldAbort()) {
          clearPauseTimer()
          pauseResolve = undefined
          setVisionPause(undefined)
          resolve("abort")
        }
      }, 200)
    })
  }

  function resolvePause(action: BgVisionAction) {
    const r = pauseResolve
    pauseResolve = undefined
    clearPauseTimer()
    setVisionPause(undefined)
    if (action === "retry") {
      setVisionError(undefined)
    }
    logAction("import-bg", `Vision pause resolved: ${action}`)
    // skip/abort keep the error visible (auth marker stays for next file).
    r?.(action)
  }

  /**
   * Phase gate. Foreground: the wizard shows its Continue UI and resolves
   * via resolveGate. Background (or detached mid-wait): auto-pass so the
   * queue never strands waiting for a dead screen.
   */
  function requestGate(id: ImportProcessorId, count: number, label: string): Promise<boolean> {
    if (background()) {
      appendLog(`Gate auto-passed in background: ${label}`)
      return Promise.resolve(true)
    }
    return new Promise<boolean>((resolve) => {
      gateResolve = resolve
      setPendingGate({ id, count, label })
    })
  }

  function resolveGate(proceed: boolean) {
    const r = gateResolve
    gateResolve = undefined
    setPendingGate(undefined)
    logAction("import-bg", `Phase gate resolved: ${proceed ? "continue" : "skip phase"}`)
    r?.(proceed)
  }

  function setModel(id: string) {
    setModelIdSignal(id)
    setLastAuthFailedProvider(undefined)
    logAction("vision", `Vision model set to ${id} — applies at next file`)
  }

  function getModel(): string {
    return modelId()
  }

  /**
   * Detach the run from the wizard UI: gates auto-pass from now on, vision
   * pauses resolve from the home monitor. The caller navigates home.
   */
  function detach() {
    if (!active() || done()) return
    setBackground(true)
    appendLog("Continuing in background — open the import chip on home to watch or intervene.")
    logAction("import-bg", "Run detached to background")
    // Never strand on a gate shown on a dead screen.
    if (gateResolve) resolveGate(true)
  }

  function cancel() {
    if (!active()) return
    aborted = true
    setCancelled(true)
    if (pauseResolve) resolvePause("abort")
    if (gateResolve) resolveGate(false)
    try {
      job?.cancel()
    } catch {}
    job?.finish("error", "Import cancelled")
    setActive(false)
    setDone(true)
    setSuccess(false)
    logAction("import-bg", "Run cancelled")
  }

  function finish(result: Omit<BgRunSummary, "text" | "success"> & { text: string; success: boolean }) {
    // Terminal state is single-writer: a cancel followed by a tail finish
    // must not overwrite the cancelled outcome (or vice versa).
    if (done()) return
    try {
      job?.finish(result.success ? "completed" : "error", result.text)
    } catch {}
    logAction("import-bg", `Run finished (success=${result.success}): ${result.text.slice(0, 160)}`)
    setSummary({ ...result })
    setSuccess(result.success)
    setDone(true)
    setActive(false)
    setPhase("done")
  }

  function dismiss() {
    if (active() && !done()) return
    resetRunState()
    job = undefined
  }

  function snapshot() {
    const list = files()
    const failed = list.filter((i) => i.status === "failed" || i.status === "error").length
    const finished = list.filter((i) => i.status === "done" || i.status === "failed" || i.status === "error").length
    return {
      runSeq: runSeq(),
      active: active(),
      background: background(),
      kind: kind(),
      workspacePath: runWorkspacePath(),
      phase: phase(),
      phaseLabel: phaseLabel(),
      currentFile: currentFile(),
      progCurrent: progCurrent(),
      progTotal: progTotal(),
      files: list,
      failed,
      finished,
      total: list.length,
      logs: logLines(),
      modelId: modelId(),
      visionError: visionError(),
      visionPause: visionPause(),
      pendingGate: pendingGate(),
      lastAuthFailedProvider: lastAuthFailedProvider(),
      done: done(),
      success: success(),
      summary: summary(),
      cancelled: cancelled(),
    }
  }

  return {
    // state readers
    active,
    runSeq,
    background,
    kind,
    workspacePath: runWorkspacePath,
    phase,
    setPhase,
    phaseLabel,
    currentFile,
    progCurrent,
    progTotal,
    setProgCurrent,
    setProgTotal,
    files,
    logLines,
    modelId,
    visionError,
    setVisionError,
    visionPause,
    pendingGate,
    lastAuthFailedProvider,
    done,
    success,
    summary,
    cancelled,
    snapshot,
    // control
    start,
    shouldAbort,
    registerChild,
    reportProgress,
    seedQueue,
    reportStatus,
    reportPhaseLog,
    reportVerifyStatus,
    appendLog,
    onVisionFailure,
    resolvePause,
    requestGate,
    resolveGate,
    setModel,
    getModel,
    detach,
    cancel,
    finish,
    dismiss,
  }
}

export const { provider: BackgroundImportProvider, use: useBackgroundImport } = createSimpleContext({
  name: "BackgroundImport",
  init: () => createBackgroundImportService(),
})

/** Slow phases only: the detach button must not appear mid-copy/verify. */
export function isBackgroundAvailable(bg: BackgroundImportService): boolean {
  if (!bg.active() || bg.done() || bg.background()) return false
  const ph = bg.phase()
  return ph === "vision" || ph === "ocr"
}

/**
 * Shared detach flow (both wizards): guard slow phases, log, toast, detach,
 * then let the caller navigate home. Returns false when detach refused.
 */
export function detachImportToBackground(
  bg: BackgroundImportService,
  opts: {
    from: string
    notify: (message: string) => void
    navigateHome: (workspacePath: string | undefined) => void
  },
): boolean {
  if (!isBackgroundAvailable(bg)) return false
  logAction("import-bg", `Continuing import in background from ${opts.from}`)
  bg.appendLog("Continuing in background — workspace home opens, import keeps running.")
  opts.notify("Import continues in the background — open the chip on home to watch.")
  bg.detach()
  opts.navigateHome(bg.workspacePath())
  return true
}
