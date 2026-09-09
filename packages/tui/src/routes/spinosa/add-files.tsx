import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { useRoute } from "../../context/route"
import { useSpinosaWorkspace } from "../../context/spinosa-workspace"
import { useToast } from "../../ui/toast"
import {
  preserveFailedImportFiles,
  scanAndClassifySource,
  type ClassifiedEntry,
} from "@spinosa/core/import/pipeline"
import { isSpinosaCancellationError } from "@spinosa/core/import/cancellation"
import { ImportBatchManager } from "@spinosa/core/import/batch"
import { useSDK } from "../../context/sdk"
import { createImportJob, type ImportJobHandle } from "../../spinosa/job-events"
import { runImportWorkflow } from "@spinosa/core/import/import-workflow"
import { logStep, logAction, logTool, logGate, logError, setToastError, persistImportWizardLogLines } from "../../spinosa/log"
import { CenteredColumn } from "../../component/centered-column"
import { SPINOSA_BASE_MODE, useOpencodeKeymap, useOpencodeModeStack } from "../../keymap"
import { useExit } from "../../context/exit"
import { useDialog } from "../../ui/dialog"
import { buttonBackground, buttonText } from "../../util/button"
import {
  buildImportScanPreview,
  detectDocumentTools,
  resolveUserPath,
} from "../../spinosa/onboarding-preview"
import { runReinstall } from "../../spinosa/reinstall"
import { readBundledFrameworkVersion, isPrereleaseFrameworkVersion } from "../../spinosa/service"
import { normalizePathInput, resolveExistingUserPaths, isCloudStoragePath } from "@spinosa/core/utils/path"
import {
  blurIfFocused,
  confirmSpinosaBack,
  createActiveWorkTracker,
  createWorkflowGuard,
  deferPress,
  delay,
  generateScanLines,
  ImportOptionsSelector,
  nextFocusedSourceIndexForAppend,
  runGuardedBackNavigation,
  shouldActivateWizardToolAction,
  shouldCancelSpinosaWorkOnCtrlC,
  shouldConfirmSpinosaBack,
  STOP_SCREEN_DEFAULT_HINT,
  STOP_SCREEN_MIN_DWELL_MS,
  STOP_SCREEN_STILL_HINT,
  STOP_WAIT_SOFT_MS,
  type ImportOption,
  LogScrollbox,
  ProgressBar,
  stripAnsi,
  WizardActionButton,
  WizardActionRow,
  WizardGateButton,
  WizardPanel,
  yieldToEventLoop,
} from "./wizard-ui"
import {
  applyImportProgressStatus,
  countImportProgress,
  formatImportDetailLogHint,
  importOutcomeAccentKey,
  importOutcomeHeading,
  seedImportQueue,
  shouldShowImportDetailLogHint,
  type ImportFileProgressItem,
} from "../../spinosa/import-progress-ui"
import { AddFilesView } from "./add-files-view"

type WizardStep = "path" | "tools" | "scan" | "direct" | "markitdown" | "ocr" | "done" | "error"

type ToolCheckResult = {
  label: string
  status: "checking" | "available" | "missing" | "unsupported"
  detail?: string
}

type SourcePathEntry = {
  id: number
}

const CANCELABLE_STEPS = ["tools", "direct", "markitdown", "ocr"] as const

let nextSourceId = 1

export function AddFiles() {
  const { theme } = useTheme()
  const toast = useToast()
  const { navigate } = useRoute()
  const spinosa = useSpinosaWorkspace()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const keymap = useOpencodeKeymap()
  const modeStack = useOpencodeModeStack()
  const exit = useExit()
  const dialog = useDialog()
  // ── Core state ────────────────────────────────────────────────────────────
  const [step, setStep] = createSignal<WizardStep>("path")
  const [sourcePaths, setSourcePaths] = createSignal<SourcePathEntry[]>([{ id: 0 }])
  const [logLines, setLogLines] = createSignal<string[]>([])
  const [busy, setBusy] = createSignal(false)
  const [importOptions, setImportOptions] = createSignal<ImportOption[]>([])
  const [selectedImport, setSelectedImport] = createSignal(0)
  const [focusedSource, setFocusedSource] = createSignal(0)
  const [hoveredButton, setHoveredButton] = createSignal<string | null>(null)
  const [processingDone, setProcessingDone] = createSignal(false)
  const [gateLabel, setGateLabel] = createSignal("")
  const [gateAction, setGateAction] = createSignal<() => void>(() => {})
  const [waitingForGate, setWaitingForGate] = createSignal(false)
  const [toolChecks, setToolChecks] = createSignal<ToolCheckResult[]>([])
  const [scanDone, setScanDone] = createSignal(false)
  const [scanningFile, setScanningFile] = createSignal("")
  const [scanCount, setScanCount] = createSignal(0)
  const [scanTotal, setScanTotal] = createSignal(0)
  const [progCurrent, setProgCurrent] = createSignal(0)
  const [progTotal, setProgTotal] = createSignal(1)
  const [processingStatus, setProcessingStatus] = createSignal("")
  const [sourceIsCloud, setSourceIsCloud] = createSignal(false)
  const [processingFile, setProcessingFile] = createSignal("")
  const [progressFiles, setProgressFiles] = createSignal<ImportFileProgressItem[]>([])
  const [failedCount, setFailedCount] = createSignal(0)
  const [importSummary, setImportSummary] = createSignal("")
  const [pathValidities, setPathValidities] = createStore<Record<number, "unchecked" | "valid" | "invalid">>({})
  const importOutcome = createMemo(() => ({ failedCount: failedCount(), stillMissing: 0 }))
  const importOutcomeFg = createMemo(() => {
    const key = importOutcomeAccentKey(importOutcome())
    if (key === "error") return theme.error
    if (key === "warning") return theme.warning
    return theme.success
  })
  const updateProgressFileStatus = (
    relPath: string,
    status: ImportFileProgressItem["status"],
  ) => {
    setProgressFiles((previous) => {
      const next = applyImportProgressStatus(previous, relPath, status)
      const counts = countImportProgress(next)
      setProgTotal(next.length > 0 ? next.length : 1)
      setProgCurrent(counts.succeeded + counts.failed)
      return next
    })
  }
  const appendProgressQueue = (rels: string[]) => {
    if (rels.length === 0) return
    setProgressFiles((previous) => {
      const known = new Set(previous.map((item) => item.rel))
      const next = [
        ...previous,
        ...seedImportQueue(rels).filter((item) => !known.has(item.rel)),
      ]
      const counts = countImportProgress(next)
      setProgTotal(next.length > 0 ? next.length : 1)
      setProgCurrent(counts.succeeded + counts.failed)
      return next
    })
  }

  const WAVE_UNICODE = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const
  const WAVE_ASCII = ["_", "-", "~", "=", "#", "=", "~", "-"] as const
  const WAVE = (() => {
    try {
      const term = (process.env.TERM ?? "").toLowerCase()
      if (term === "dumb" || term === "linux" || process.env.NO_COLOR !== undefined) return WAVE_ASCII as unknown as string[]
      const lang = (process.env.LANG ?? process.env.LC_ALL ?? "").toLowerCase()
      if (lang === "c" || lang === "posix") return WAVE_ASCII as unknown as string[]
      return WAVE_UNICODE as unknown as string[]
    } catch {
      return WAVE_UNICODE as unknown as string[]
    }
  })()
  const waveString = (f: number) => { let r = ""; for (let i = 0; i < 6; i++) { const p = (i + f) % 14, l = p <= 6 ? p : 13 - p; r += WAVE[l] }; return r }
  const wavePulse = (f: number) => { const p = f % 14; return WAVE[p <= 6 ? p : 13 - p] }
  const waveRow = (f: number, width: number) => { let r = ""; for (let i = 0; i < width; i++) { const angle = (i * Math.PI) / 7 + f * Math.PI / 7; const l = Math.max(0, Math.min(7, Math.round(3.5 + 3.5 * Math.sin(angle)))); r += WAVE[l] }; return r }
  const [spinIdx, setSpinIdx] = createSignal(0)
  const [stopping, setStopping] = createSignal(false)
  const [stopHint, setStopHint] = createSignal(STOP_SCREEN_DEFAULT_HINT)
  let forceLeaveResolve: (() => void) | undefined
  let spinTimer: ReturnType<typeof setInterval> | undefined
  const spinOn = () => { if (!spinTimer) spinTimer = setInterval(() => setSpinIdx((i) => (i + 1) % 14), 200) }
  // Don't freeze the stop overlay wave — abort paths call spinOff() while stopping is still shown.
  const spinOff = () => {
    if (stopping()) return
    if (spinTimer) { clearInterval(spinTimer); spinTimer = undefined; setSpinIdx(0) }
  }

  const workflow = createWorkflowGuard()
  const activeWork = createActiveWorkTracker()
  let activeJob: ImportJobHandle | undefined
  let sourceInput: TextareaRenderable | undefined
  const sourceInputs = new Map<number, TextareaRenderable>()
  const pathSnapshot = new Map<number, string>()
  let gateResolve: (() => void) | undefined
  let abortProcessing = false

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedExtensions = createMemo(() =>
    importOptions()
      .filter((item) => item.selected)
      .map((item) => item.ext),
  )

  const toolActionLabel = createMemo(() => {
    const checks = toolChecks()
    if (checks.length === 0) return ""
    if (checks.some((t) => t.status === "checking")) return "Checking..."
    if (checks.some((t) => t.status === "missing")) return "Reinstall missing tools"
    return "Scan source folders"
  })

  const toolAllReady = createMemo(() => {
    const checks = toolChecks()
    return checks.length > 0 && checks.every((t) => t.status === "available" || t.status === "unsupported")
  })

  function formatBytes(bytes: number): string {
    if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
    if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
    return `${bytes} B`
  }

  const totalSteps = 7
  const stepIndex = createMemo(() => {
    if (step() === "path") return 1
    if (step() === "tools") return 2
    if (step() === "scan") return 3
    if (step() === "direct") return 4
    if (step() === "markitdown") return 5
    if (step() === "ocr") return 6
    if (step() === "done") return 7
    return 7
  })

  const hasValidPaths = createMemo(() => {
    const entries = sourcePaths()
    return entries.some((e) => pathValidities[e.id] === "valid")
  })

  // ── Log helpers ───────────────────────────────────────────────────────────
  const appendLogLine = (...lines: string[]) =>
    setLogLines((prev) => {
      const result = [...prev]
      for (const line of lines) {
        if (line.startsWith("\r")) {
          const clean = line.replace(/^\r+/, "").trimEnd()
          if (result.length > 0 && clean) result[result.length - 1] = clean
          else if (clean) result.push(clean)
        } else {
          result.push(line.trimEnd())
        }
      }
      return result.slice(-200)
    })

  const clearLog = () => setLogLines([])

  // ── Path input management ─────────────────────────────────────────────────
  const readPathText = (id: number) => {
    const input = sourceInputs.get(id)
    const live = input && !input.isDestroyed ? input.plainText?.trim() : undefined
    if (live) return live
    return pathSnapshot.get(id)?.trim() ?? ""
  }

  const snapshotSourcePaths = () => {
    for (const entry of sourcePaths()) {
      const input = sourceInputs.get(entry.id)
      const text = input && !input.isDestroyed ? input.plainText : pathSnapshot.get(entry.id) ?? ""
      pathSnapshot.set(entry.id, text)
    }
  }

  const blurSourceInputs = () => {
    for (const input of sourceInputs.values()) blurIfFocused(input)
    blurIfFocused(sourceInput)
  }

  const focusSourceInput = () => {
    queueMicrotask(() => {
      if (!sourceInput || sourceInput.isDestroyed) return
      sourceInput.focus()
      sourceInput.gotoLineEnd()
    })
  }

  const focusSourceEntry = (id: number) => {
    queueMicrotask(() => {
      const input = sourceInputs.get(id)
      if (!input || input.isDestroyed) return
      input.focus()
      input.gotoLineEnd()
    })
  }

  const sourceInputFocused = () => focusedSourceIndex() >= 0

  const focusedSourceIndex = () => {
    const paths = sourcePaths()
    for (let i = 0; i < paths.length; i++) {
      const input = sourceInputs.get(paths[i]!.id)
      if (input && !input.isDestroyed && input.focused) return i
    }
    return -1
  }

  const cycleFocusedSource = (offset: number) => {
    const paths = sourcePaths()
    const current = focusedSourceIndex()
    if (current < 0 || paths.length === 0) return
    const next = (current + offset + paths.length) % paths.length
    setFocusedSource(next)
    const entry = paths[next]
    if (entry) focusSourceEntry(entry.id)
  }

  const addSourcePath = (options?: { focusNewInput?: boolean }) => {
    const id = nextSourceId++
    const nextIndex = sourcePaths().length
    setSourcePaths((prev) => [...prev, { id }])
    setFocusedSource((current) => nextFocusedSourceIndexForAppend(current, nextIndex, options))
    if (options?.focusNewInput === false) return
    focusSourceEntry(id)
  }

  const removeSourcePath = (id: number) => {
    setSourcePaths((prev) => {
      if (prev.length <= 1) return prev
      pathSnapshot.delete(id)
      sourceInputs.delete(id)
      return prev.filter((e) => e.id !== id)
    })
  }

  const allPathsResolved = () =>
    resolveExistingUserPaths(sourcePaths().map((entry) => readPathText(entry.id)))

  const validateSinglePath = (p: string): "valid" | "invalid" => {
    try {
      if (!existsSync(p)) return "invalid"
      const st = statSync(p)
      if (st.isFile()) return "valid"
      if (st.isDirectory()) return readdirSync(p).length > 0 ? "valid" : "invalid"
      return "invalid"
    } catch {
      return "invalid"
    }
  }

  // ── Navigation & lifecycle ────────────────────────────────────────────────
  const stopActiveWork = () => {
    setStopping(true)
    spinOn()
    if (gateResolve) { gateResolve(); gateResolve = undefined }
    abortProcessing = true
    workflow.bump()
    activeJob?.cancel()
    activeJob = undefined
    setBusy(false)
    setWaitingForGate(false)
  }

  const goToWorkspace = () => navigate({ type: "global" })
  const navigateBackFrom = (from: WizardStep) => {
    if (from === "path") { goToWorkspace(); return }
    if (from === "done") { spinosa.refresh(); goToWorkspace(); return }
    if (from === "tools") { logAction("back", "tools to path"); setStep("path"); return }
    if (from === "scan") { logAction("back", "scan to tools"); setStep("tools"); return }
    if (from === "direct" || from === "markitdown" || from === "ocr") { logAction("back", `${from} to scan`); setStep("scan"); return }
    if (from === "error") {
      setStep(importOptions().length > 0 ? "scan" : "path")
    }
  }

  let backNavigationPending = false
  const requestForceLeave = () => {
    if (!forceLeaveResolve) return false
    const resolve = forceLeaveResolve
    forceLeaveResolve = undefined
    resolve()
    return true
  }
  const requestBack = (confirmIfActive = true) => {
    if (backNavigationPending) return
    const from = step()
    backNavigationPending = true
    setStopHint(STOP_SCREEN_DEFAULT_HINT)
    const cancelPath = shouldConfirmSpinosaBack({
      step: from,
      busy: busy(),
      waitingForGate: waitingForGate(),
      cancellableSteps: CANCELABLE_STEPS,
    })
    void runGuardedBackNavigation({
      shouldConfirm: confirmIfActive && cancelPath,
      confirm: () => confirmSpinosaBack(dialog, from),
      stop: stopActiveWork,
      waitForStop: () => activeWork.wait(STOP_WAIT_SOFT_MS),
      waitUntilSettled: () => activeWork.wait(0).then(() => undefined),
      onStillStopping: () => setStopHint(STOP_SCREEN_STILL_HINT),
      waitForForceLeave: () => new Promise<void>((resolve) => { forceLeaveResolve = resolve }),
      // Keep the "Stopping process..." overlay readable even when cancel is instant.
      minStopDisplayMs: cancelPath ? STOP_SCREEN_MIN_DWELL_MS : 0,
      navigate: () => navigateBackFrom(from),
    }).finally(() => {
      forceLeaveResolve = undefined
      backNavigationPending = false
      setStopping(false)
      setStopHint(STOP_SCREEN_DEFAULT_HINT)
      spinOff()
    })
  }

  const handleBackPress = () => requestBack(true)
  const leavePathStep = handleBackPress

  const handleInterrupt = () => {
    if (stopping()) {
      requestForceLeave()
      return
    }
    if (!shouldCancelSpinosaWorkOnCtrlC({
      step: step(),
      busy: busy(),
      waitingForGate: waitingForGate(),
      cancellableSteps: CANCELABLE_STEPS,
    })) {
      exit()
      return
    }

    appendLogLine("Cancellation requested. Stopping current Spinosa operation...")
    requestBack(false)
  }

  // ── Gate helper ───────────────────────────────────────────────────────────
  const gate = (label = "Continue") => new Promise<void>((resolve) => {
    gateResolve = resolve
    logGate(label)
    setGateLabel(label)
    setGateAction(() => () => { logAction("gate-click", label); setWaitingForGate(false); gateResolve = undefined; resolve() })
    setWaitingForGate(true)
  })

  // ── Tools check ───────────────────────────────────────────────────────────
  const runToolCheck = async () => {
    logStep("tools", "Checking document processing tools")
    const checks: ToolCheckResult[] = [
      { label: "Tesseract OCR", status: "checking", detail: "Scanned PDFs (ita+eng+fra, 300dpi)" },
      { label: "MarkItDown", status: "checking", detail: "Office docs, EPUB, HTML, text PDFs" },
      { label: "PDF.js", status: "checking", detail: "PDF text extraction and page rendering" },
    ]
    setToolChecks(checks)
    setStep("tools")
    spinOn()

    await delay(80)
    const toolStatus = await detectDocumentTools()
    const ocrStatus = toolStatus.ocr
      ? "available"
      : toolStatus.ocrUnsupportedReason
        ? "unsupported"
        : "missing"
    const ocrDetail = toolStatus.ocrUnsupportedReason ?? "Scanned PDFs (ita+eng+fra, 300dpi via pdftoppm)"
    const results: ToolCheckResult[] = [
      { label: "Tesseract OCR", status: ocrStatus, detail: ocrDetail },
      { label: "MarkItDown", status: toolStatus.markitdown ? "available" : "missing", detail: "Office docs, EPUB, HTML, text PDFs" },
      { label: "PDF.js", status: toolStatus.pdfjs ? "available" : "missing", detail: "PDF text extraction and page rendering" },
    ]
    setToolChecks(results)
    for (const r of results) logTool(r.label, r.status, r.detail)
    spinOff()
  }
  const handleToolAction = () => {
    if (busy()) return
    try { blurSourceInputs() } catch (error) { logError("blurSourceInputs", error) }
    const checks = toolChecks()
    const needsRepair = checks.some((t) => t.status === "missing")
    const toolsReady = checks.every((t) => t.status === "available" || t.status === "unsupported")
    if (needsRepair) {
      logAction("repair-tools", `${checks.filter(t => t.status === "missing").length} tools missing`)
      void activeWork.run(async () => {
        setBusy(true)
        try {
          await runToolRepair()
        } finally {
          setBusy(false)
        }
      })
    } else if (toolsReady) {
      logAction("start-scan", "All tools ready")
      startScan().catch((err) => {
        logError("startScan-top", err)
        appendLogLine(`Fatal: ${err instanceof Error ? err.message : String(err)}`)
        setStep("error")
      })
    } else {
      logError("handleToolAction", `Unexpected tool states: ${checks.map((check) => check.status).join(",")}`)
    }
  }

  const runToolRepair = async () => {
    logAction("repair", "Tools missing — repairing")
    setToolChecks((prev) => prev.map((t) => t.status === "missing" ? { ...t, status: "checking" as const } : t))
    spinOn()
    try {
      await delay(80)
      const bv = await readBundledFrameworkVersion()
      const channel = bv && isPrereleaseFrameworkVersion(bv) ? "beta" : "stable"
      const reinstallResult = await runReinstall({
        channel,
        onStdout: (chunk) => {
          const clean = stripAnsi(chunk)
          if (clean) appendLogLine(clean)
        },
        onStderr: (chunk) => {
          const clean = stripAnsi(chunk)
          if (clean) appendLogLine(clean)
        },
      })
      if (reinstallResult.exitCode !== 0) {
        const detail = reinstallResult.stderr?.trim() || `exit ${reinstallResult.exitCode}`
        logError("runToolRepair", `Reinstall failed: ${detail}`)
        appendLogLine(`Tool repair failed: ${detail}`)
      }
      await delay(200)
      const toolStatus = await detectDocumentTools()
      const ocrStatus = toolStatus.ocr
        ? "available"
        : toolStatus.ocrUnsupportedReason
          ? "unsupported"
          : "missing"
      const ocrDetail = toolStatus.ocrUnsupportedReason ?? "Scanned PDFs (ita+eng+fra, 300dpi via pdftoppm)"
      const results: ToolCheckResult[] = [
        { label: "Tesseract OCR", status: ocrStatus, detail: ocrDetail },
        { label: "MarkItDown", status: toolStatus.markitdown ? "available" : "missing", detail: "Office docs, EPUB, HTML, text PDFs" },
        { label: "PDF.js", status: toolStatus.pdfjs ? "available" : "missing", detail: "PDF text extraction and page rendering" },
      ]
      setToolChecks(results)
      for (const r of results) logTool(r.label, r.status, r.detail)
      if (reinstallResult.exitCode === 0) {
        appendLogLine("Tool repair complete.")
      } else {
        appendLogLine(`Tool repair finished with errors (exit ${reinstallResult.exitCode}) — retry or check logs.`)
      }
    } catch (err) {
      logError("runToolRepair", err)
      appendLogLine(`Tool repair failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      spinOff()
    }
  }
  // ── Scan ──────────────────────────────────────────────────────────────────
  let pendingPaths: string[] | undefined
  const startScan = async () => {
    abortProcessing = false
    workflow.bump()
    const resolved = pendingPaths
    if (!resolved || resolved.length === 0) { logError("startScan", "No pending paths"); setStep("error"); return }
    setSourceIsCloud(resolved.some((p) => isCloudStoragePath(p)))
    const shouldAbort = () => abortProcessing
    setScanDone(false)
    setScanningFile("")
    setScanCount(0)
    setStep("scan")
    await delay(100)
    spinOn()
    clearLog()
    try {
      let mergedOptions: ImportOption[] = []
      for (const src of resolved) {
        appendLogLine(`Scanning: ${src}`)
        const scanPreview = await buildImportScanPreview(src, {
          onFile: (rel, isFile, discovered) => { setScanningFile(rel); setScanTotal((t) => t + discovered); if (isFile) setScanCount((c) => c + 1) },
          shouldAbort,
        })
        for (const opt of scanPreview.importOptions) {
          const existing = mergedOptions.find((m) => m.ext === opt.ext)
          if (existing) existing.count += opt.count
          else mergedOptions.push({ ...opt })
        }
      }
      setImportOptions(mergedOptions)
      clearLog()
      spinOff()
      setScanDone(true)
      logAction("scan-done", `${mergedOptions.length} file types found`)
    } catch (err) {
      logError("startScan", err)
      appendLogLine(`Scan failed: ${err instanceof Error ? err.message : String(err)}`)
      setStep("error")
    }
  }

  // ── Processing ────────────────────────────────────────────────────────────
  const startProcessing = async () => {
    if (busy()) return
    const resolved = pendingPaths
    if (!resolved || resolved.length === 0) {
      appendLogLine("At least one valid source path is required.")
      setStep("error")
      return
    }

    const workspacePath = spinosa.activePath
    if (!workspacePath) {
      appendLogLine("No active workspace selected.")
      setStep("error")
      return
    }

    setBusy(true)
    clearLog()
    setFailedCount(0)
    setImportSummary("")
    setProcessingDone(false)
    setProgCurrent(0)
    setProgTotal(1)
    setProcessingStatus("Starting...")
    setProcessingFile("")
    setProgressFiles([])
    abortProcessing = false
    const generation = workflow.bump()
    gateResolve = undefined
    spinOn()
    await delay(200)

    const rawDir = path.join(workspacePath, "raw")
    mkdirSync(rawDir, { recursive: true })

    const batchManager = new ImportBatchManager()
    batchManager.parseExtensionsFromFlag(selectedExtensions().join(","))

    let totalRenamed = 0
    let totalDirect = 0
    let totalMd = 0
    let totalOcr = 0
    let dirConverted = 0
    let mdConverted = 0
    let ocrConverted = 0
    const attemptedEntries: ClassifiedEntry[] = []

    const job = createImportJob({
      kind: "import",
      title: "Add files import",
      directory: workspacePath,
      publish: sdk.publishJobEvent,
      localEmit: (event) => sdk.event.emit("event", event),
    })
    activeJob = job
    const shouldAbort = () => abortProcessing || !workflow.active(generation) || job.shouldAbort()
    job.start()
    const sharedProg = job.prog
    sharedProg.on((e) => {
      if (e.relPath && e.status === "processing") setProcessingFile(e.relPath)
      else if (e.relPath && (e.status === "done" || e.status === "failed" || e.status === "error")) {
        if (e.relPath === processingFile()) setProcessingFile("")
      }
      if (e.status && e.relPath) {
        updateProgressFileStatus(e.relPath, e.status)
      }
    })
    const onPhaseLog = job.wrapLog((msg: string) => {
      if (msg.startsWith("  ")) {
        setProcessingStatus(msg.trim())
        return
      }
      appendLogLine(msg)
    })

    try {
      for (let sourceIndex = 0; sourceIndex < resolved.length; sourceIndex++) {
        const src = resolved[sourceIndex]!
        const sourceFolder = sourceIndex === 0 ? undefined : `source-${sourceIndex + 1}`
        if (shouldAbort()) break
        appendLogLine(`Processing: ${src}${sourceFolder ? ` → ${sourceFolder}/` : ""}`)

        const classified = await scanAndClassifySource(src, rawDir, batchManager, sourceFolder, shouldAbort)
        if (!classified) {
          appendLogLine(`No importable files in: ${src}`)
          continue
        }
        attemptedEntries.push(
          ...classified.directFiles,
          ...classified.markitdownFiles,
          ...classified.ocrFiles,
        )
        appendProgressQueue([
          ...classified.directFiles,
          ...classified.markitdownFiles,
          ...classified.ocrFiles,
        ].map((file) => file.rel))

        // ── Shared import workflow (direct → MarkItDown → OCR) ────────────
        const phases = await runImportWorkflow(classified, {
          prog: sharedProg,
          onLog: onPhaseLog,
          shouldAbort,
          signal: job.registered.signal,
          onChild: job.registerChild,
          onRename: (original, renamed) => {
            appendLogLine(`  renamed (name too long): ${original} → ${renamed}`)
          },
          beforePhase: async (id, count) => {
            if (id === "direct") {
              setStep("direct")
              setProcessingStatus(`Copying text-based files to raw — ${count} files`)
              totalDirect += count
              await delay(500)
              return true
            }
            if (id === "markitdown") {
              setBusy(false)
              await gate("Process text files")
              setBusy(true)
              if (shouldAbort()) return false
              setStep("markitdown")
              setProcessingStatus("Converting office docs & text PDFs via MarkItDown...")
              totalMd += count
              await delay(500)
              return true
            }
            setBusy(false)
            await gate("Process images and PDFs")
            setBusy(true)
            if (shouldAbort()) return false
            setStep("ocr")
            setProcessingStatus("Running Tesseract on scanned PDFs (images → copy, pending network)...")
            totalOcr += count
            await delay(500)
            return true
          },
          afterPhase: async (id, result) => {
            if (result.renamed > 0) totalRenamed += result.renamed
            if (id === "direct") {
              dirConverted += result.converted
              setProcessingStatus(`Text-based files copied — ${result.converted} files`)
              await delay(500)
            }
            if (id === "markitdown") {
              mdConverted += result.converted
              setProcessingStatus(`Office docs & text PDFs converted — ${result.converted} files`)
              await delay(500)
            }
            if (id === "ocr") {
              ocrConverted += result.converted
              setProcessingStatus(
                result.failed > 0
                  ? `Scanned PDFs via Tesseract — ${result.converted} ok, ${result.failed} failed (images kept as copy)`
                  : `Scanned PDFs via Tesseract — ${result.converted} files (images kept as copy)`,
              )
              // Dwell so failure-first 100% results are readable before done.
              await delay(1500)
            }
          },
        })
        if (classified.markitdownFiles.length === 0) {
          appendLogLine("No files require MarkItDown conversion.")
        }
        if (classified.ocrFiles.length === 0) {
          appendLogLine("No files require OCR.")
        }
        void phases
        if (shouldAbort()) { spinOff(); setBusy(false); return }
      }

      if (attemptedEntries.length === 0) {
        appendLogLine("No selected files could be imported.")
        setImportSummary("No selected files could be imported.")
        setProcessingDone(true)
        setStep("error")
        job.finish("error", "No selected files could be imported.")
        return
      }

      const preserved = await preserveFailedImportFiles(attemptedEntries, rawDir, appendLogLine)
      for (const rel of preserved.failedFilePaths) {
        // Close any protocol gap (for example a worker crash) in the same
        // list used by the renderer; never leave a missing file queued.
        updateProgressFileStatus(rel, "failed")
      }
      const counts = countImportProgress(progressFiles())
      setFailedCount(counts.failed)
      const summary =
        `${dirConverted}/${totalDirect} copied · ${mdConverted}/${totalMd} markitdown · ${ocrConverted}/${totalOcr} ocr` +
        (totalRenamed > 0 ? ` · ${totalRenamed} renamed` : "") +
        (counts.failed > 0 ? ` · ${counts.failed} failed` : "")
      setImportSummary(summary)
      setProcessingDone(true)
      // Keep progressFiles + last phase bar counters so the results panel
      // remains visible on the done step.
      setStep("done")
      if (counts.failed > 0 || preserved.failedFilePaths.length > 0) {
        persistImportWizardLogLines(logLines(), "add-files-import")
        job.finish("error", summary)
      } else {
        job.finish("completed", summary)
      }
    } catch (err) {
      if (isSpinosaCancellationError(err) || shouldAbort()) {
        appendLogLine("Spinosa import cancelled.")
        setProcessingStatus("Cancelled.")
        job.cancel()
        return
      }
      logError("startProcessing", err)
      appendLogLine(`Error: ${err instanceof Error ? err.message : String(err)}`)
      job.finish("error", err instanceof Error ? err.message : String(err))
      setStep("error")
    } finally {
      if (shouldAbort() && !processingDone()) job.cancel()
      if (activeJob === job) activeJob = undefined
      spinOff()
      setBusy(false)
    }
  }

  // ── Finish ────────────────────────────────────────────────────────────────
  const finish = () => {
    spinosa.refresh()
    goToWorkspace()
  }

  // ── Toggle helpers ────────────────────────────────────────────────────────
  const toggleImport = (index: number) =>
    setImportOptions((items) =>
      items.map((item, itemIndex) => (itemIndex === index ? { ...item, selected: !item.selected } : item)),
    )

  const toggleAllImports = () => {
    const shouldEnableAll = importOptions().some((item) => !item.selected)
    setImportOptions((items) => items.map((item) => ({ ...item, selected: shouldEnableAll })))
  }

  // ── Path step navigation ──────────────────────────────────────────────────
  const continueFromPath = async () => {
    if (busy()) return
    blurSourceInputs()
    logAction("continue", "Path step → Tools step")
    snapshotSourcePaths()
    const resolved = allPathsResolved()
    if (resolved.length === 0) {
      appendLogLine("At least one valid source path is required.")
      setStep("error")
      return
    }
    for (const p of resolved) {
      if (!existsSync(p)) {
        appendLogLine(`Source folder does not exist: ${p}`)
        setStep("error")
        return
      }
    }
    pendingPaths = resolved
    await runToolCheck()
  }

  const continueFromScan = () => {
    if (selectedExtensions().length === 0) {
      appendLogLine("Select at least one file type to continue.")
      logError("continueFromScan", "No file types selected")
      setStep("error")
      return
    }
    logAction("continue", `Scan → Processing (${selectedExtensions().length} types: ${selectedExtensions().join(",")})`)
    void activeWork.run(startProcessing)
  }

  // ── Mount (keymap + timers) ──────────────────────────────────────────────
  onMount(() => {
    const onUnhandled = (ev: PromiseRejectionEvent) => {
      logError("unhandledrejection", ev.reason)
    }
    window.addEventListener?.("unhandledrejection", onUnhandled)
    setToastError((err) => toast.error(err))
    focusSourceInput()

    // Auto-add new path input when last input has content
    const autoAddTimer = setInterval(() => {
      if (step() !== "path") return
      const entries = sourcePaths()
      if (entries.length === 0) return
      const last = entries[entries.length - 1]
      const input = sourceInputs.get(last.id)
      if (!input || input.isDestroyed) return
      if (input.plainText?.trim()?.length > 0) {
        addSourcePath({ focusNewInput: false })
      }
    }, 300)

    // Path validation: periodically re-validate all path inputs
    const validateTimer = setInterval(() => {
      if (step() !== "path") return
      for (const entry of sourcePaths()) {
        const text = normalizePathInput(readPathText(entry.id))
        if (!text) {
          setPathValidities(entry.id, "unchecked")
          continue
        }
        const resolved = resolveUserPath(text)
        if (!resolved) {
          setPathValidities(entry.id, "invalid")
          continue
        }
        setPathValidities(entry.id, validateSinglePath(resolved))
      }
    }, 400)

    const off = keymap.intercept("key", ({ event, consume }) => {
      if (modeStack.current() !== SPINOSA_BASE_MODE) return
      setHoveredButton(null)

      if (event.ctrl && event.name === "c") {
        handleInterrupt()
        consume(); return
      }
      if (event.name === "escape") {
        if (stopping() && requestForceLeave()) {
          consume(); return
        }
        handleBackPress()
        consume(); return
      }

      if (busy()) return

      if (waitingForGate() && (step() === "direct" || step() === "markitdown" || step() === "ocr") && event.name === "return") {
        gateAction()()
        consume(); return
      }

      if (step() === "path") {
        const pathsLen = sourcePaths().length
        const editingIndex = focusedSourceIndex()

        if (editingIndex >= 0) {
          if (event.name === "up" || event.name === "k") {
            cycleFocusedSource(-1)
            consume(); return
          }
          if (event.name === "down" || event.name === "j") {
            cycleFocusedSource(1)
            consume(); return
          }
        }

        if (!sourceInputFocused()) {
          if (event.name === "up" || event.name === "k") {
            setFocusedSource((v) => Math.max(0, v - 1))
            consume(); return
          }
          if (event.name === "down" || event.name === "j") {
            setFocusedSource((v) => Math.min(pathsLen + 1, v + 1))
            consume(); return
          }
          if (event.name === "return") {
            const focus = focusedSource()
            if (focus < pathsLen) {
              const entry = sourcePaths()[focus]
              if (entry) focusSourceEntry(entry.id)
            } else if (focus === pathsLen) {
              leavePathStep()
            } else {
              void continueFromPath()
            }
            consume(); return
          }
        }
      }

      if (step() === "scan" && scanDone()) {
        const listLength = importOptions().length + 1
        if (event.name === "up" || event.name === "k") {
          setSelectedImport((value) => Math.max(0, value - 1))
          consume(); return
        }
        if (event.name === "down" || event.name === "j") {
          setSelectedImport((value) => Math.min(listLength - 1, value + 1))
          consume(); return
        }
        if (event.name === "space") {
          if (selectedImport() === 0) toggleAllImports()
          else toggleImport(selectedImport() - 1)
          consume(); return
        }
        if (event.name === "a") {
          toggleAllImports()
          consume(); return
        }
        if (event.name === "return") {
          continueFromScan()
          consume(); return
        }
      }

      if (shouldActivateWizardToolAction({
        step: step(),
        keyName: event.name,
        busy: busy(),
        toolChecks: toolChecks(),
      })) {
        handleToolAction()
        consume(); return
      }

      if (step() === "done" && event.name === "return") {
        finish()
        consume(); return
      }

      if (step() === "error" && event.name === "return") {
        handleBackPress()
        consume(); return
      }
    })

    onCleanup(() => {
      clearInterval(autoAddTimer)
      clearInterval(validateTimer)
      clearInterval(spinTimer)
      stopActiveWork()
      off()
    })
  })

  // ── Step-transition effects ───────────────────────────────────────────────
  createEffect(
    on(
      step,
      (current, previous) => {
        if (current === "path" && current !== previous) focusSourceInput()
        if (current !== "path") {
          sourceInputs.clear()
          sourceInput = undefined
        }
      },
      { defer: true },
    ),
  )
  // ── Render ────────────────────────────────────────────────────────────────

  const registerSourceInput = (id: number, value: TextareaRenderable, first: boolean) => {
    sourceInputs.set(id, value)
    if (first) sourceInput = value
    value.traits = { status: "PATH" }
  }

  const viewProps = {
    theme, dimensions, stopping, waveString, wavePulse, spinIdx, stopHint, hoveredButton, setHoveredButton,
    busy, step, stepIndex, totalSteps, sourceIsCloud, sourcePaths, focusedSource, setFocusedSource, registerSourceInput,
    pathSnapshot, pathValidities, blurSourceInputs, focusSourceEntry, removeSourcePath, hasValidPaths, leavePathStep,
    continueFromPath, toolChecks, logLines, scanDone, scanningFile, scanCount, scanTotal, importOptions, selectedImport,
    formatBytes, setSelectedImport, toggleAllImports, toggleImport, processingDone, progCurrent, progTotal, processingStatus,
    processingFile, progressFiles, toolActionLabel, toolAllReady, handleBackPress, handleToolAction, continueFromScan,
    waitingForGate, gateLabel, gateAction, importOutcomeFg, importOutcome, importOutcomeHeading, importSummary, failedCount,
    shouldShowImportDetailLogHint, formatImportDetailLogHint, finish,
  }

  return <AddFilesView {...viewProps} />

}
