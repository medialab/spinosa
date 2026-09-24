import { useDirectoryPicker } from "@/components/directory-picker"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { sdkResponseData } from "@/utils/sdk-response"
import { activeOnboardingJob } from "@/utils/active-onboarding-job"
import type {
  OnboardingJobGetResponse,
  OnboardingPreviewResponse,
  OnboardingScanGetResponse,
  OnboardingToolsGetResponse,
  ProviderListResponse,
} from "@spinosa/sdk/v2/client"
import { Button } from "@spinosa/ui/button"
import { useDialog } from "@spinosa/ui/context/dialog"
import { Dialog } from "@spinosa/ui/dialog"
import { TextField } from "@spinosa/ui/text-field"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"

type Step = "sources" | "name" | "tools" | "scan" | "extensions" | "vision" | "progress" | "launch" | "result"
type VisionModel = { id: string; label: string }

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const number = (value: number | "NaN" | "Infinity" | "-Infinity") => (typeof value === "number" ? value : 0)
const excludedByDefault = new Set([
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff",
  "mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv",
])

function formatBytes(value: number | "NaN" | "Infinity" | "-Infinity") {
  const bytes = number(value)
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

function suggestedName(path: string) {
  return path.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "workspace"
}

export function DialogSpinosaOnboarding(props: {
  resume?: { workspacePath: string; sourcePath: string; workspaceName: string }
  onOpenWorkspace: (path: string, startStartup: boolean) => void | Promise<void>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const pickDirectory = useDirectoryPicker()
  const [step, setStep] = createSignal<Step>("sources")
  const [sourcePaths, setSourcePaths] = createSignal(props.resume ? [props.resume.sourcePath] : [])
  const [manualPath, setManualPath] = createSignal("")
  const [workspaceName, setWorkspaceName] = createSignal(props.resume?.workspaceName ?? "")
  const [preview, setPreview] = createSignal<OnboardingPreviewResponse>()
  const [scanProgress, setScanProgress] = createSignal<OnboardingScanGetResponse>()
  const [tools, setTools] = createSignal<OnboardingToolsGetResponse>()
  const [repairingTools, setRepairingTools] = createSignal(false)
  const [toolRepairOutput, setToolRepairOutput] = createSignal<string[]>([])
  const [extensions, setExtensions] = createSignal<string[]>([])
  const [visionModelId, setVisionModelId] = createSignal("none")
  const [visionModels, setVisionModels] = createSignal<VisionModel[]>([])
  const [jobID, setJobID] = createSignal<string>()
  const [scanID, setScanID] = createSignal<string>()
  const [scanCancelled, setScanCancelled] = createSignal(false)
  const [job, setJob] = createSignal<OnboardingJobGetResponse>()
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [confirmCancel, setConfirmCancel] = createSignal(false)

  const record = (
    event: string,
    fields: Record<string, unknown> = {},
    level: "debug" | "info" | "warn" | "error" = "info",
    startedAt?: number,
  ) => {
    const record = platform.recordRendererDiagnostic
    if (!record) return
    void record({
      event,
      level,
      rendererID: platform.rendererID,
      ...(startedAt === undefined ? {} : { durationMs: Date.now() - startedAt }),
      fields,
    }).catch(() => undefined)
  }

  const directory = () => sourcePaths()[0]
  const client = () => {
    const path = directory()
    return path ? serverSDK().ensureDirSdkContext(path).client : undefined
  }
  const selectedCount = createMemo(() => new Set(extensions()).size)
  const canContinue = createMemo(() => sourcePaths().length > 0)
  const isFinal = createMemo(() => ["completed", "failed", "cancelled"].includes(job()?.status ?? ""))
  const phaseGate = createMemo(() => {
    const gate = job()?.gate
    return gate?.kind === "phase" ? gate : undefined
  })
  const visionGate = createMemo(() => {
    const gate = job()?.gate
    return gate?.kind === "vision" ? gate : undefined
  })

  createEffect(() => {
    const resume = props.resume
    const sdk = client()
    if (!resume || !sdk || jobID()) return
    let disposed = false
    void activeOnboardingJob(() => sdk.onboarding.active.get({ directory: resume.sourcePath }))
      .then((active) => {
        if (disposed || !active) return
        setJobID(active.id)
        setJob(active)
        setStep("progress")
      })
      .catch((cause) => {
        record("onboarding.active.error", { error: cause }, "error")
      })
    onCleanup(() => { disposed = true })
  })

  createEffect(() => {
    const id = jobID()
    const sdk = client()
    if (!id || !sdk || isFinal()) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastState = ""
    let loggedError = false
    const startedAt = Date.now()
    const poll = async () => {
      try {
        const result = await sdk.onboarding.job.get({ directory: directory(), jobID: id })
        if (disposed) return
        loggedError = false
        if (result.data) {
          setJob(result.data)
          const state = `${result.data.status}:${result.data.phase}:${result.data.current}:${result.data.total}`
          if (state !== lastState) {
            lastState = state
            record("onboarding.job.state", {
              jobID: id,
              status: result.data.status,
              phase: result.data.phase,
              current: result.data.current,
              total: result.data.total,
            })
          }
          if (result.data.status === "completed") setStep("launch")
          else if (["failed", "cancelled"].includes(result.data.status)) setStep("result")
        }
      } catch (cause) {
        if (!disposed) {
          setError(errorMessage(cause))
          if (!loggedError) {
            loggedError = true
            record("onboarding.job.poll.error", { jobID: id, error: cause }, "error", startedAt)
          }
        }
      }
      if (!disposed) timer = setTimeout(poll, 800)
    }
    void poll()
    onCleanup(() => {
      disposed = true
      if (timer) clearTimeout(timer)
    })
  })

  function addManualPath() {
    const path = manualPath().trim()
    if (!path || sourcePaths().includes(path)) return
    setSourcePaths((paths) => [...paths, path])
    setManualPath("")
  }

  function chooseSources() {
    const current = server.current
    if (!current) return
    pickDirectory({
      server: current,
      title: language.t("dialog.spinosaOnboarding.pickSources"),
      multiple: true,
      onSelect: (result) => {
        const paths = Array.isArray(result) ? result : result ? [result] : []
        setSourcePaths((existing) => Array.from(new Set([...existing, ...paths])))
      },
    })
  }

  async function loadPreview() {
    const sdk = client()
    if (!sdk) return
    const startedAt = Date.now()
    setBusy(true)
    setError(undefined)
    setPreview(undefined)
    setScanProgress(undefined)
    setStep("scan")
    const id = crypto.randomUUID()
    setScanID(id)
    record("onboarding.scan.request", { scanID: id, sourceCount: sourcePaths().length })
    setScanCancelled(false)
    let polling = true
    const poll = async () => {
      while (polling) {
        try {
          const status = await sdk.onboarding.scan.get({ directory: directory(), scanID: id })
          if (status.data) {
            setScanProgress(status.data)
            if (status.data.status !== "running") return
          }
        } catch {
          // The preview request creates the scan record before walking files.
        }
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
    const progress = poll()
    try {
      const result = await sdk.onboarding.preview({ directory: directory(), sourcePaths: sourcePaths(), scanID: id })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      setPreview(result.data)
      setExtensions(result.data.batches.filter((batch) => !excludedByDefault.has(batch.ext)).map((batch) => batch.ext))
      record("onboarding.scan.result", { scanID: id, sourceCount: result.data.sources.length, batchCount: result.data.batches.length }, "info", startedAt)
    } catch (cause) {
      if (!scanCancelled()) {
        setError(errorMessage(cause))
        record("onboarding.scan.error", { scanID: id, error: cause }, "error", startedAt)
      }
    } finally {
      polling = false
      await progress
      setBusy(false)
    }
  }

  async function cancelScan() {
    const sdk = client()
    const id = scanID()
    if (!sdk || !id) return
    setScanCancelled(true)
    setError(undefined)
    record("onboarding.scan.cancel.request", { scanID: id })
    try {
      const result = await sdk.onboarding.scan.cancel({ directory: directory(), scanID: id })
      if (result.data) setScanProgress(result.data)
      setStep("tools")
    } catch (cause) {
      setError(errorMessage(cause))
      record("onboarding.scan.cancel.error", { scanID: id, error: cause }, "error")
    }
  }

  async function checkTools() {
    const sdk = client()
    if (!sdk) return
    const startedAt = Date.now()
    setBusy(true)
    setError(undefined)
    setStep("tools")
    record("onboarding.tools.request")
    if (!workspaceName().trim()) setWorkspaceName(suggestedName(sourcePaths()[0] ?? ""))
    try {
      const result = await sdk.onboarding.tools.get({ directory: directory() })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      setTools(result.data)
      record("onboarding.tools.result", { markitdown: result.data.markitdown, pdfjs: result.data.pdfjs, canvas: result.data.canvas }, "info", startedAt)
    } catch (cause) {
      setError(errorMessage(cause))
      record("onboarding.tools.error", { error: cause }, "error", startedAt)
    } finally {
      setBusy(false)
    }
  }

  async function repairTools() {
    const sdk = client()
    if (!sdk || busy()) return
    const startedAt = Date.now()
    setBusy(true)
    setRepairingTools(true)
    setError(undefined)
    setToolRepairOutput([])
    record("onboarding.tools.repair.request")
    try {
      const result = await sdk.onboarding.tools.repair({ directory: directory() })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      setTools(result.data.tools)
      setToolRepairOutput(result.data.output)
      record("onboarding.tools.repair.result", { exitCode: result.data.exitCode }, result.data.exitCode === 0 ? "info" : "warn", startedAt)
      if (result.data.exitCode !== 0) {
        setError(result.data.output.slice(-8).join("\n") || language.t("dialog.spinosaOnboarding.repairFailed"))
      }
    } catch (cause) {
      setError(errorMessage(cause))
      record("onboarding.tools.repair.error", { error: cause }, "error", startedAt)
    } finally {
      setRepairingTools(false)
      setBusy(false)
    }
  }

  async function loadVisionModels() {
    const sdk = client()
    if (!sdk) return
    const startedAt = Date.now()
    setBusy(true)
    setError(undefined)
    record("onboarding.vision.request")
    try {
      const result = await sdk.provider.list({ directory: directory() })
      const providers = sdkResponseData<ProviderListResponse>(result)
      if (
        !providers ||
        !Array.isArray(providers.all) ||
        !Array.isArray(providers.connected) ||
        !providers.default ||
        typeof providers.default !== "object"
      )
        throw new Error(language.t("common.requestFailed"))
      const connected = new Set(providers.connected)
      const models = providers.all.flatMap((provider) =>
        connected.has(provider.id)
          ? Object.values(provider.models)
              .filter((model) => model.capabilities.input.image)
              .map((model) => ({ id: `${provider.id}/${model.id}`, label: `${provider.name} · ${model.name}` }))
          : [],
      )
      setVisionModels(models)
      setStep("vision")
      record("onboarding.vision.result", { modelCount: models.length }, "info", startedAt)
    } catch (cause) {
      setError(errorMessage(cause))
      record("onboarding.vision.error", { error: cause }, "error", startedAt)
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    const sdk = client()
    if (!sdk || selectedCount() === 0) return
    const startedAt = Date.now()
    setBusy(true)
    setError(undefined)
    record("onboarding.job.request", { sourceCount: sourcePaths().length, extensionCount: selectedCount() })
    try {
      const result = await sdk.onboarding.start({
        directory: directory(),
        sourcePaths: sourcePaths(),
        workspaceName: workspaceName().trim(),
        resumeWorkspacePath: props.resume?.workspacePath,
        extensions: extensions(),
        visionModelId: visionModelId(),
        preferredCli: "opencode_desktop",
      })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      setJobID(result.data.id)
      setStep("progress")
      record("onboarding.job.accepted", { jobID: result.data.id }, "info", startedAt)
    } catch (cause) {
      setError(errorMessage(cause))
      record("onboarding.job.request.error", { error: cause }, "error", startedAt)
    } finally {
      setBusy(false)
    }
  }

  async function action(action: "continue" | "retry" | "changeModel" | "skip" | "abort") {
    const sdk = client()
    const id = jobID()
    if (!sdk || !id) return
    const startedAt = Date.now()
    setBusy(true)
    record("onboarding.job.action.request", { jobID: id, action })
    try {
      const result = await sdk.onboarding.job.action({
        directory: directory(),
        jobID: id,
        action,
        visionModelId: action === "changeModel" ? visionModelId() : undefined,
      })
      if (result.data) setJob(result.data)
      record("onboarding.job.action.result", { jobID: id, action, status: result.data?.status }, "info", startedAt)
    } catch (cause) {
      setError(errorMessage(cause))
      record("onboarding.job.action.error", { jobID: id, action, error: cause }, "error", startedAt)
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    const sdk = client()
    const id = jobID()
    if (!sdk || !id || isFinal()) return
    const startedAt = Date.now()
    setBusy(true)
    record("onboarding.job.cancel.request", { jobID: id })
    try {
      const result = await sdk.onboarding.job.cancel({ directory: directory(), jobID: id })
      if (result.data) setJob(result.data)
      record("onboarding.job.cancel.result", { jobID: id, status: result.data?.status }, "info", startedAt)
    } catch (cause) {
      setError(errorMessage(cause))
      record("onboarding.job.cancel.error", { jobID: id, error: cause }, "error", startedAt)
    } finally {
      setBusy(false)
    }
  }

  async function openWorkspace(startStartup: boolean) {
    const path = job()?.workspacePath
    if (!path) return
    await props.onOpenWorkspace(path, startStartup)
    dialog.close()
  }

  async function continueInBackground() {
    const sdk = client()
    const id = jobID()
    if (!sdk || !id || !job()?.workspacePath || visionGate()) return
    const startedAt = Date.now()
    setBusy(true)
    setError(undefined)
    record("onboarding.job.background.request", { jobID: id })
    try {
      const result = await sdk.onboarding.job.action({ directory: directory(), jobID: id, action: "background" })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      setJob(result.data)
      record("onboarding.job.background.result", { jobID: id }, "info", startedAt)
      await openWorkspace(false)
    } catch (cause) {
      setError(errorMessage(cause))
      record("onboarding.job.background.error", { jobID: id, error: cause }, "error", startedAt)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={language.t("dialog.spinosaOnboarding.title")}
      size="large"
      action={
        <Button
          variant="ghost"
          disabled={busy()}
          onClick={() => (jobID() && !isFinal() ? setConfirmCancel(true) : dialog.close())}
        >
          {jobID() && !isFinal()
            ? language.t("dialog.spinosaOnboarding.cancelImport")
            : language.t("common.close")}
        </Button>
      }
    >
      <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-4 py-3">
        <Switch>
          <Match when={step() === "sources"}>
            <p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.sourcesDescription")}</p>
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={chooseSources}>{language.t("dialog.spinosaOnboarding.pickSources")}</Button>
            </div>
            <div class="flex gap-2">
              <TextField
                class="flex-1"
                value={manualPath()}
                onChange={setManualPath}
                onKeyDown={(event: KeyboardEvent) => event.key === "Enter" && (event.preventDefault(), addManualPath())}
                placeholder={language.t("dialog.spinosaOnboarding.manualPathPlaceholder")}
                hideLabel
                label={language.t("dialog.spinosaOnboarding.manualPath")}
              />
              <Button variant="secondary" onClick={addManualPath}>{language.t("dialog.spinosaOnboarding.addPath")}</Button>
            </div>
            <For each={sourcePaths()}>{(path) => <div class="flex items-center justify-between rounded border border-border-base px-3 py-2 text-sm"><span class="truncate">{path}</span><Button variant="ghost" onClick={() => setSourcePaths((paths) => paths.filter((item) => item !== path))}>{language.t("common.remove")}</Button></div>}</For>
            <div class="flex justify-end"><Button disabled={!canContinue() || busy()} onClick={() => setStep("name")}>{language.t("common.continue")}</Button></div>
          </Match>

          <Match when={step() === "name"}>
            <p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.nameDescription")}</p>
            <TextField label={language.t("dialog.spinosaOnboarding.nameLabel")} value={workspaceName()} onChange={setWorkspaceName} autofocus />
            <div class="flex justify-between"><Button variant="ghost" onClick={() => setStep("sources")}>{language.t("dialog.spinosaOnboarding.back")}</Button><Button disabled={sourcePaths().length === 0 || busy()} onClick={() => void checkTools()}>{busy() ? language.t("common.loading") : language.t("common.continue")}</Button></div>
          </Match>

          <Match when={step() === "tools"}>
            <p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.toolsDescription")}</p>
            <For each={[
              ["MarkItDown", tools()?.markitdown],
              ["PDF.js", tools()?.pdfjs],
              ["Canvas", tools()?.canvas],
            ] as const}>{([label, available]) => <div class="flex justify-between rounded border border-border-base px-3 py-2"><span>{label}</span><span class={available === undefined ? "text-text-weak" : available ? "text-success" : "text-danger"}>{available === undefined ? language.t("common.loading") : available ? language.t("dialog.spinosaOnboarding.available") : language.t("dialog.spinosaOnboarding.missing")}</span></div>}</For>
            <Show when={busy()}><p class="text-sm text-text-weak">{language.t(repairingTools() ? "dialog.spinosaOnboarding.repairingTools" : "dialog.spinosaOnboarding.checkingTools")}</p></Show>
            <Show when={toolRepairOutput().length > 0}><details><summary class="cursor-pointer text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.toolRepairLog")}</summary><pre class="max-h-32 overflow-auto rounded bg-black/5 p-2 text-xs whitespace-pre-wrap dark:bg-white/5">{toolRepairOutput().join("\n")}</pre></details></Show>
            <div class="flex justify-between">
              <Button variant="ghost" disabled={busy()} onClick={() => setStep("name")}>{language.t("dialog.spinosaOnboarding.back")}</Button>
              <div class="flex gap-2">
                <Show when={!busy() && [tools()?.markitdown, tools()?.pdfjs, tools()?.canvas].some((available) => available === false)}>
                  <Button variant="secondary" onClick={() => void repairTools()}>{language.t("dialog.spinosaOnboarding.repairTools")}</Button>
                </Show>
                <Button disabled={busy()} onClick={() => void loadPreview()}>{busy() ? language.t("common.loading") : language.t("common.continue")}</Button>
              </div>
            </div>
          </Match>

          <Match when={step() === "scan"}>
            <p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.scanDescription")}</p>
            <Show when={busy()}><p class="text-sm text-text-weak">{scanProgress()
              ? language.t("dialog.spinosaOnboarding.scanProgress", { source: scanProgress()!.sourceIndex, sources: scanProgress()!.sourceCount, current: scanProgress()!.current, total: scanProgress()!.total })
              : language.t("dialog.spinosaOnboarding.scanning")}</p></Show>
            <Show when={scanProgress()?.activeFile}><p class="truncate text-xs text-text-weak">{scanProgress()?.activeFile}</p></Show>
            <Show when={busy()}><div class="flex justify-end"><Button variant="ghost" onClick={() => void cancelScan()}>{language.t("dialog.spinosaOnboarding.cancelScan")}</Button></div></Show>
            <For each={preview()?.sources ?? []}>{(source) => <div class="rounded border border-border-base p-3 text-sm"><div class="truncate font-medium">{source.path}</div><div class="mt-1 text-text-weak">{language.t("dialog.spinosaOnboarding.scanFiles", { count: number(source.counts.total) })}</div></div>}</For>
            <Show when={!busy() && preview()?.batches.length === 0}><p class="text-sm text-danger">{language.t("dialog.spinosaOnboarding.scanEmpty")}</p></Show>
            <div class="flex justify-between"><Button variant="ghost" disabled={busy()} onClick={() => setStep("tools")}>{language.t("dialog.spinosaOnboarding.back")}</Button><Button disabled={busy() || !preview() || preview()!.batches.length === 0} onClick={() => setStep("extensions")}>{language.t("common.continue")}</Button></div>
          </Match>

          <Match when={step() === "extensions"}>
            <p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.extensionsDescription")}</p>
            <div class="flex justify-end"><Button variant="ghost" onClick={() => setExtensions(selectedCount() === (preview()?.batches.length ?? 0) ? [] : (preview()?.batches ?? []).map((batch) => batch.ext))}>{selectedCount() === (preview()?.batches.length ?? 0) ? language.t("dialog.spinosaOnboarding.deselectAll") : language.t("dialog.spinosaOnboarding.selectAll")}</Button></div>
            <For each={preview()?.batches ?? []}>{(batch) => <label class="flex cursor-pointer items-center justify-between rounded border border-border-base px-3 py-2"><span class="flex items-center gap-2"><input type="checkbox" checked={extensions().includes(batch.ext)} onChange={() => setExtensions((items) => items.includes(batch.ext) ? items.filter((item) => item !== batch.ext) : [...items, batch.ext])} />{batch.ext}</span><span class="text-sm text-text-weak">{number(batch.count)} · {formatBytes(batch.bytes)}</span></label>}</For>
            <div class="flex justify-between"><Button variant="ghost" onClick={() => setStep("scan")}>{language.t("dialog.spinosaOnboarding.back")}</Button><Button disabled={!selectedCount() || busy()} onClick={() => void loadVisionModels()}>{busy() ? language.t("common.loading") : language.t("common.continue")}</Button></div>
          </Match>

          <Match when={step() === "vision"}>
            <p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.visionDescription")}</p>
            <label class="flex cursor-pointer items-center gap-2 rounded border border-border-base px-3 py-2"><input type="radio" name="vision-model" checked={visionModelId() === "none"} onChange={() => setVisionModelId("none")} />{language.t("dialog.spinosaOnboarding.copyAsIs")}</label>
            <For each={visionModels()}>{(model) => <label class="flex cursor-pointer items-center gap-2 rounded border border-border-base px-3 py-2"><input type="radio" name="vision-model" checked={visionModelId() === model.id} onChange={() => setVisionModelId(model.id)} />{model.label}</label>}</For>
            <Show when={visionModels().length === 0}><p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.noVisionModels")}</p></Show>
            <div class="flex justify-between"><Button variant="ghost" onClick={() => setStep("extensions")}>{language.t("dialog.spinosaOnboarding.back")}</Button><Button disabled={busy()} onClick={() => void start()}>{language.t("dialog.spinosaOnboarding.start")}</Button></div>
          </Match>

          <Match when={step() === "progress" || step() === "result"}>
            <div class="flex items-center justify-between"><span class="font-medium">{job()?.message ?? language.t("common.loading")}</span><span class="text-sm text-text-weak">{job()?.phase}</span></div>
            <Show when={number(job()?.total ?? 0) > 0}><progress class="w-full" value={number(job()!.current)} max={number(job()!.total)} /></Show>
            <Show when={job()?.activeFile}><p class="truncate text-sm text-text-weak">{job()?.activeFile}</p></Show>
            <Show when={job()?.status === "waiting" && phaseGate()}>{(gate) => <div class="flex justify-end"><Button disabled={busy()} onClick={() => void action("continue")}>{language.t("dialog.spinosaOnboarding.importPhase", { phase: gate().phase })}</Button></div>}</Show>
            <Show when={job()?.status === "waiting" && visionGate()}>{(gate) => <div class="rounded border border-danger-base p-3 text-sm"><p>{gate().message}</p><Show when={visionModels().length > 0}><label class="mt-3 flex items-center gap-2">{language.t("dialog.spinosaOnboarding.changeVisionModel")}<select class="min-w-0 flex-1 rounded border border-border-base bg-background-base px-2 py-1" value={visionModelId()} onChange={(event) => setVisionModelId(event.currentTarget.value)}><For each={visionModels()}>{(model) => <option value={model.id}>{model.label}</option>}</For></select></label></Show><div class="mt-3 flex justify-end gap-2"><Button variant="secondary" disabled={busy()} onClick={() => void action("skip")}>{language.t("dialog.spinosaOnboarding.skip")}</Button><Show when={visionModels().length > 0 && visionModelId() !== "none"}><Button variant="secondary" disabled={busy()} onClick={() => void action("changeModel")}>{language.t("dialog.spinosaOnboarding.useModel")}</Button></Show><Button disabled={busy()} onClick={() => void action("retry")}>{language.t("dialog.spinosaOnboarding.retry")}</Button></div></div>}</Show>
            <Show when={jobID() && !isFinal() && job()?.workspacePath && !visionGate()}><div class="flex justify-end"><Button variant="ghost" disabled={busy()} onClick={() => void continueInBackground()}>{language.t("dialog.spinosaOnboarding.continueInBackground")}</Button></div></Show>
            <Show when={isFinal()}><div class="rounded border border-border-base p-3"><p class="text-danger">{job()?.message}</p><Show when={job()?.result}>{(result) => <p class="mt-2 text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.verification", { imported: number(result().imported), recovered: number(result().recovered), failed: number(result().failed), missing: number(result().stillMissing) })}</p>}</Show></div><div class="flex justify-end gap-2"><Show when={job()?.workspacePath}><Button variant="secondary" onClick={() => void openWorkspace(false)}>{language.t("dialog.spinosaOnboarding.openWorkspace")}</Button></Show><Button variant="secondary" onClick={() => dialog.close()}>{language.t("common.close")}</Button></div></Show>
            <Show when={job()?.logs.length}><details><summary class="cursor-pointer text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.logs")}</summary><pre class="mt-2 max-h-40 overflow-auto rounded bg-black/5 p-2 text-xs whitespace-pre-wrap dark:bg-white/5">{job()?.logs.join("\n")}</pre></details></Show>
            <Show when={(job()?.files.length ?? 0) > 0}><details><summary class="cursor-pointer text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.files", { count: job()?.files.length ?? 0 })}</summary><ul class="mt-2 max-h-40 overflow-auto rounded border border-border-base px-3 py-2 text-xs"><For each={job()?.files ?? []}>{(file) => <li class="flex justify-between gap-3 py-1"><span class="min-w-0 truncate">{file.relPath}</span><span class="shrink-0 text-text-weak">{file.status}</span></li>}</For></ul></details></Show>
            <Show when={confirmCancel()}><div role="alert" class="rounded border border-border-base p-3 text-sm"><p>{language.t("dialog.spinosaOnboarding.cancelConfirm")}</p><div class="mt-3 flex justify-end gap-2"><Button variant="ghost" disabled={busy()} onClick={() => setConfirmCancel(false)}>{language.t("dialog.spinosaOnboarding.keepImporting")}</Button><Button variant="secondary" disabled={busy()} onClick={() => { setConfirmCancel(false); void cancel() }}>{language.t("dialog.spinosaOnboarding.cancelImport")}</Button></div></div></Show>
          </Match>

          <Match when={step() === "launch"}>
            <div class="rounded border border-border-base p-3">
              <p class="font-medium text-success">{job()?.message}</p>
              <Show when={job()?.result}>{(result) => <p class="mt-2 text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.verification", { imported: number(result().imported), recovered: number(result().recovered), failed: number(result().failed), missing: number(result().stillMissing) })}</p>}</Show>
            </div>
            <p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.launchDescription")}</p>
            <div class="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => void openWorkspace(false)}>{language.t("dialog.spinosaOnboarding.openWorkspace")}</Button>
              <Button onClick={() => void openWorkspace(true)}>{language.t("dialog.spinosaOnboarding.openAndStart")}</Button>
            </div>
            <Show when={job()?.logs.length}><details><summary class="cursor-pointer text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.logs")}</summary><pre class="mt-2 max-h-40 overflow-auto rounded bg-black/5 p-2 text-xs whitespace-pre-wrap dark:bg-white/5">{job()?.logs.join("\n")}</pre></details></Show>
          </Match>
        </Switch>
        <Show when={error()}><p class="text-sm text-danger">{error()}</p></Show>
      </div>
    </Dialog>
  )
}
