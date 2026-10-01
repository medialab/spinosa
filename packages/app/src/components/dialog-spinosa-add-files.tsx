import { useDirectoryPicker } from "@/components/directory-picker"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { sdkResponseData } from "@/utils/sdk-response"
import type {
  OnboardingJobGetResponse,
  OnboardingPreviewResponse,
  OnboardingScanGetResponse,
  ProviderListResponse,
} from "@spinosa/sdk/v2/client"
import { Button } from "@spinosa/ui/button"
import { useDialog } from "@spinosa/ui/context/dialog"
import { Dialog } from "@spinosa/ui/dialog"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"

type Step = "source" | "extensions" | "vision" | "progress"
type VisionModel = { id: string; label: string }
type PreviewBatch = OnboardingPreviewResponse["batches"][number]

const excludedByDefault = new Set([
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff",
  "mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv",
])

const number = (value: number | "NaN" | "Infinity" | "-Infinity" | undefined) =>
  typeof value === "number" ? value : 0

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const isFinalStatus = (status: OnboardingJobGetResponse["status"] | undefined) =>
  status === "completed" || status === "failed" || status === "cancelled"

export function defaultSpinosaAddFilesExtensions(batches: readonly Pick<PreviewBatch, "ext">[]) {
  return batches.filter((batch) => !excludedByDefault.has(batch.ext)).map((batch) => batch.ext)
}

function formatBytes(value: number | "NaN" | "Infinity" | "-Infinity") {
  const bytes = number(value)
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

export function DialogSpinosaAddFiles(props: { workspacePath: string; onComplete?: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const server = useServer()
  const serverSDK = useServerSDK()
  const pickDirectory = useDirectoryPicker()
  const [state, setState] = createStore({
    step: "source" as Step,
    sourcePath: undefined as string | undefined,
    scanID: undefined as string | undefined,
    scanProgress: undefined as OnboardingScanGetResponse | undefined,
    preview: undefined as OnboardingPreviewResponse | undefined,
    extensions: [] as string[],
    visionModelId: "none",
    visionModels: [] as VisionModel[],
    jobID: undefined as string | undefined,
    job: undefined as OnboardingJobGetResponse | undefined,
    busy: false,
    error: undefined as string | undefined,
    confirmCancel: false,
  })

  const selectedCount = createMemo(() => new Set(state.extensions).size)
  const allSelected = createMemo(() => selectedCount() === (state.preview?.batches.length ?? 0))
  const isFinal = createMemo(() => isFinalStatus(state.job?.status))
  const visionGate = createMemo(() => (state.job?.gate?.kind === "vision" ? state.job.gate : undefined))
  const phaseGate = createMemo(() => (state.job?.gate?.kind === "phase" ? state.job.gate : undefined))
  const client = (directory: string) => serverSDK().ensureDirSdkContext(directory).client

  let completedJobID: string | undefined
  createEffect(() => {
    const job = state.job
    if (job?.status !== "completed" || completedJobID === job.id) return
    completedJobID = job.id
    props.onComplete?.()
  })

  createEffect(() => {
    const id = state.jobID
    if (!id) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const result = await client(props.workspacePath).onboarding.job.get({
          directory: props.workspacePath,
          jobID: id,
        })
        if (disposed) return
        if (!result.data) throw new Error(language.t("common.requestFailed"))
        setState("job", result.data)
        setState("error", undefined)
        if (isFinalStatus(result.data.status)) return
      } catch (cause) {
        if (disposed) return
        setState("error", errorMessage(cause))
      }
      if (!disposed) timer = setTimeout(poll, 800)
    }

    void poll()
    onCleanup(() => {
      disposed = true
      if (timer) clearTimeout(timer)
    })
  })

  function chooseSource() {
    const connection = server.current
    if (!connection) return
    pickDirectory({
      server: connection,
      title: language.t("dialog.spinosaOnboarding.pickSources"),
      onSelect: (result) => {
        const path = Array.isArray(result) ? result[0] : result
        if (!path) return
        setState({
          sourcePath: path,
          preview: undefined,
          scanProgress: undefined,
          scanID: undefined,
          extensions: [],
          error: undefined,
          step: "source",
        })
      },
    })
  }

  async function previewSource() {
    const sourcePath = state.sourcePath
    if (!sourcePath || state.busy) return
    const scanID = crypto.randomUUID()
    setState({ busy: true, error: undefined, scanProgress: undefined, scanID })

    let scanning = false
    let progress = Promise.resolve()
    try {
      const sdk = client(sourcePath)
      scanning = true
      progress = (async () => {
        while (scanning && state.scanID === scanID) {
          try {
            const result = await sdk.onboarding.scan.get({ directory: sourcePath, scanID })
            if (state.scanID !== scanID) return
            if (result.data) {
              setState("scanProgress", result.data)
              if (result.data.status !== "running") return
            }
          } catch {
            // The preview request creates the scan record; its result remains authoritative.
          }
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      })()

      const result = await sdk.onboarding.preview({ directory: sourcePath, sourcePaths: [sourcePath], scanID })
      if (state.scanID !== scanID) return
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      setState({
        preview: result.data,
        extensions: defaultSpinosaAddFilesExtensions(result.data.batches),
        step: "extensions",
      })
    } catch (cause) {
      if (state.scanID === scanID) setState("error", errorMessage(cause))
    } finally {
      scanning = false
      await progress
      if (state.scanID === scanID) setState({ busy: false, scanID: undefined })
    }
  }

  async function cancelScan() {
    const sourcePath = state.sourcePath
    const scanID = state.scanID
    if (!sourcePath || !scanID) return
    setState({ scanID: undefined, scanProgress: undefined, busy: false })
    try {
      await client(sourcePath).onboarding.scan.cancel({ directory: sourcePath, scanID })
    } catch (cause) {
      setState("error", errorMessage(cause))
    }
  }

  async function loadVisionModels() {
    setState({ busy: true, error: undefined })
    try {
      const sdk = client(props.workspacePath)
      const result = await sdk.provider.list({ directory: props.workspacePath })
      const providers = sdkResponseData<ProviderListResponse>(result)
      if (!providers || !Array.isArray(providers.all) || !Array.isArray(providers.connected))
        throw new Error(language.t("common.requestFailed"))
      const connected = new Set(providers.connected)
      const models = providers.all.flatMap((provider) =>
        connected.has(provider.id)
          ? Object.values(provider.models)
              .filter((model) => model.capabilities.input.image)
              .map((model) => ({ id: `${provider.id}/${model.id}`, label: `${provider.name} · ${model.name}` }))
          : [],
      )
      setState({ visionModels: models, step: "vision" })
    } catch (cause) {
      setState("error", errorMessage(cause))
    } finally {
      setState("busy", false)
    }
  }

  async function start() {
    const sourcePath = state.sourcePath
    if (!sourcePath || !selectedCount() || state.busy) return
    setState({ busy: true, error: undefined })
    try {
      const result = await client(props.workspacePath).onboarding.addFiles({
        directory: props.workspacePath,
        sourcePath,
        extensions: state.extensions,
        visionModelId: state.visionModelId,
      })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      setState({ jobID: result.data.id, job: undefined, step: "progress" })
    } catch (cause) {
      setState("error", errorMessage(cause))
    } finally {
      setState("busy", false)
    }
  }

  async function action(action: "continue" | "retry" | "changeModel" | "skip") {
    const id = state.jobID
    if (!id || state.busy) return
    setState({ busy: true, error: undefined })
    try {
      const result = await client(props.workspacePath).onboarding.job.action({
        directory: props.workspacePath,
        jobID: id,
        action,
        visionModelId: action === "changeModel" ? state.visionModelId : undefined,
      })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      setState("job", result.data)
    } catch (cause) {
      setState("error", errorMessage(cause))
    } finally {
      setState("busy", false)
    }
  }

  async function cancelImport() {
    const id = state.jobID
    if (!id || isFinal() || state.busy) return
    setState({ busy: true, error: undefined, confirmCancel: false })
    try {
      const result = await client(props.workspacePath).onboarding.job.cancel({
        directory: props.workspacePath,
        jobID: id,
      })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      setState("job", result.data)
    } catch (cause) {
      setState("error", errorMessage(cause))
    } finally {
      setState("busy", false)
    }
  }

  async function continueInBackground() {
    const id = state.jobID
    if (!id || isFinal() || visionGate() || state.busy) return
    setState({ busy: true, error: undefined })
    try {
      const result = await client(props.workspacePath).onboarding.job.action({
        directory: props.workspacePath,
        jobID: id,
        action: "background",
      })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      setState("job", result.data)
      dialog.close()
    } catch (cause) {
      setState("error", errorMessage(cause))
    } finally {
      setState("busy", false)
    }
  }

  return (
    <Dialog
      title={language.t("prompt.action.attachFile")}
      size="large"
      action={
        <Button
          variant="ghost"
          disabled={state.busy && !state.jobID}
          onClick={() => (state.jobID && !isFinal() ? setState("confirmCancel", true) : dialog.close())}
        >
          {state.jobID && !isFinal()
            ? language.t("dialog.spinosaOnboarding.cancelImport")
            : language.t("common.close")}
        </Button>
      }
    >
      <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-4 py-3">
        <Show when={state.step === "source"}>
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={state.busy} onClick={chooseSource}>
              {language.t("dialog.spinosaOnboarding.pickSources")}
            </Button>
            <Show when={state.sourcePath}><span class="min-w-0 truncate text-sm text-text-weak">{state.sourcePath}</span></Show>
          </div>
          <Show when={state.busy}>
            <p class="text-sm text-text-weak">
              {state.scanProgress
                ? language.t("dialog.spinosaOnboarding.scanProgress", {
                    source: state.scanProgress.sourceIndex,
                    sources: state.scanProgress.sourceCount,
                    current: state.scanProgress.current,
                    total: state.scanProgress.total,
                  })
                : language.t("dialog.spinosaOnboarding.scanning")}
            </p>
            <Show when={state.scanProgress?.activeFile}>
              <p class="truncate text-xs text-text-weak">{state.scanProgress?.activeFile}</p>
            </Show>
            <div class="flex justify-end">
              <Button variant="ghost" onClick={() => void cancelScan()}>
                {language.t("dialog.spinosaOnboarding.cancelScan")}
              </Button>
            </div>
          </Show>
          <Show when={state.preview?.sources[0]}>
            {(source) => (
              <div class="rounded border border-border-base p-3 text-sm">
                <div class="truncate font-medium">{source().path}</div>
                <div class="mt-1 text-text-weak">
                  {language.t("dialog.spinosaOnboarding.scanFiles", { count: number(source().counts.total) })}
                </div>
              </div>
            )}
          </Show>
          <Show when={state.preview && state.preview.batches.length === 0}>
            <p class="text-sm text-danger">{language.t("dialog.spinosaOnboarding.scanEmpty")}</p>
          </Show>
          <div class="flex justify-end">
            <Button disabled={!state.sourcePath || state.busy} onClick={() => void previewSource()}>
              {state.busy ? language.t("common.loading") : language.t("common.continue")}
            </Button>
          </div>
        </Show>

        <Show when={state.step === "extensions"}>
          <p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.extensionsDescription")}</p>
          <Show when={state.preview?.sources[0]}>
            {(source) => (
              <div class="rounded border border-border-base p-3 text-sm">
                <div class="truncate font-medium">{source().path}</div>
                <div class="mt-1 text-text-weak">
                  {language.t("dialog.spinosaOnboarding.scanFiles", { count: number(source().counts.total) })}
                </div>
              </div>
            )}
          </Show>
          <Show when={(state.preview?.batches.length ?? 0) === 0}>
            <p class="text-sm text-danger">{language.t("dialog.spinosaOnboarding.scanEmpty")}</p>
          </Show>
          <Show when={(state.preview?.batches.length ?? 0) > 0}>
            <div class="flex justify-end">
              <Button
                variant="ghost"
                disabled={state.busy}
                onClick={() =>
                  setState(
                    "extensions",
                    allSelected() ? [] : (state.preview?.batches ?? []).map((batch) => batch.ext),
                  )
                }
              >
                {allSelected()
                  ? language.t("dialog.spinosaOnboarding.deselectAll")
                  : language.t("dialog.spinosaOnboarding.selectAll")}
              </Button>
            </div>
          </Show>
          <For each={state.preview?.batches ?? []}>
            {(batch) => (
              <label class="flex cursor-pointer items-center justify-between rounded border border-border-base px-3 py-2">
                <span class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={state.extensions.includes(batch.ext)}
                    onChange={() =>
                      setState(
                        "extensions",
                        state.extensions.includes(batch.ext)
                          ? state.extensions.filter((item) => item !== batch.ext)
                          : [...state.extensions, batch.ext],
                      )
                    }
                  />
                  {batch.ext}
                </span>
                <span class="text-sm text-text-weak">
                  {number(batch.count)} · {formatBytes(batch.bytes)}
                </span>
              </label>
            )}
          </For>
          <div class="flex justify-between">
            <Button variant="ghost" onClick={() => setState("step", "source")}>
              {language.t("dialog.spinosaOnboarding.back")}
            </Button>
            <Button disabled={!selectedCount() || state.busy} onClick={() => void loadVisionModels()}>
              {state.busy ? language.t("common.loading") : language.t("common.continue")}
            </Button>
          </div>
        </Show>

        <Show when={state.step === "vision"}>
          <p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.visionDescription")}</p>
          <label class="flex cursor-pointer items-center gap-2 rounded border border-border-base px-3 py-2">
            <input
              type="radio"
              name="spinosa-add-files-vision-model"
              checked={state.visionModelId === "none"}
              onChange={() => setState("visionModelId", "none")}
            />
            {language.t("dialog.spinosaOnboarding.copyAsIs")}
          </label>
          <For each={state.visionModels}>
            {(model) => (
              <label class="flex cursor-pointer items-center gap-2 rounded border border-border-base px-3 py-2">
                <input
                  type="radio"
                  name="spinosa-add-files-vision-model"
                  checked={state.visionModelId === model.id}
                  onChange={() => setState("visionModelId", model.id)}
                />
                {model.label}
              </label>
            )}
          </For>
          <Show when={state.visionModels.length === 0}>
            <p class="text-sm text-text-weak">{language.t("dialog.spinosaOnboarding.noVisionModels")}</p>
          </Show>
          <div class="flex justify-between">
            <Button variant="ghost" onClick={() => setState("step", "extensions")}>
              {language.t("dialog.spinosaOnboarding.back")}
            </Button>
            <Button disabled={state.busy} onClick={() => void start()}>
              {state.busy ? language.t("common.loading") : language.t("prompt.action.attachFile")}
            </Button>
          </div>
        </Show>

        <Show when={state.step === "progress"}>
          <Show when={state.job} fallback={<p class="text-sm text-text-weak">{language.t("common.loading")}</p>}>
            {(job) => (
              <>
                <div class="flex items-center justify-between gap-3">
                  <span class="font-medium">{job().message}</span>
                  <span class="shrink-0 text-sm text-text-weak">{job().phase}</span>
                </div>
                <Show when={number(job().total) > 0}>
                  <progress class="w-full" value={number(job().current)} max={number(job().total)} />
                </Show>
                <Show when={job().activeFile}>
                  <p class="truncate text-sm text-text-weak">{job().activeFile}</p>
                </Show>
                <Show when={job().status === "waiting" && phaseGate()}>
                  {(gate) => (
                    <div class="flex justify-end">
                      <Button disabled={state.busy} onClick={() => void action("continue")}>
                        {language.t("dialog.spinosaOnboarding.importPhase", { phase: gate().phase })}
                      </Button>
                    </div>
                  )}
                </Show>
                <Show when={job().status === "waiting" && visionGate()}>
                  {(gate) => (
                    <div class="rounded border border-danger-base p-3 text-sm">
                      <p>{gate().message}</p>
                      <Show when={state.visionModels.length > 0}>
                        <label class="mt-3 flex items-center gap-2">
                          {language.t("dialog.spinosaOnboarding.changeVisionModel")}
                          <select
                            class="min-w-0 flex-1 rounded border border-border-base bg-background-base px-2 py-1"
                            value={state.visionModelId}
                            onChange={(event) => setState("visionModelId", event.currentTarget.value)}
                          >
                            <For each={state.visionModels}>
                              {(model) => <option value={model.id}>{model.label}</option>}
                            </For>
                          </select>
                        </label>
                      </Show>
                      <div class="mt-3 flex justify-end gap-2">
                        <Button variant="secondary" disabled={state.busy} onClick={() => void action("skip")}>
                          {language.t("dialog.spinosaOnboarding.skip")}
                        </Button>
                        <Show when={state.visionModels.length > 0 && state.visionModelId !== "none"}>
                          <Button
                            variant="secondary"
                            disabled={state.busy}
                            onClick={() => void action("changeModel")}
                          >
                            {language.t("dialog.spinosaOnboarding.useModel")}
                          </Button>
                        </Show>
                        <Button disabled={state.busy} onClick={() => void action("retry")}>
                          {language.t("dialog.spinosaOnboarding.retry")}
                        </Button>
                      </div>
                    </div>
                  )}
                </Show>
                <Show when={!isFinal() && !visionGate()}>
                  <div class="flex justify-end">
                    <Button variant="ghost" disabled={state.busy} onClick={() => void continueInBackground()}>
                      {language.t("dialog.spinosaOnboarding.continueInBackground")}
                    </Button>
                  </div>
                </Show>
                <Show when={isFinal()}>
                  <div class="rounded border border-border-base p-3">
                    <p class={job().status === "completed" ? "text-success" : "text-danger"}>{job().message}</p>
                    <Show when={job().result}>
                      {(result) => (
                        <p class="mt-2 text-sm text-text-weak">
                          {language.t("dialog.spinosaOnboarding.verification", {
                            imported: number(result().imported),
                            recovered: number(result().recovered),
                            failed: number(result().failed),
                            missing: number(result().stillMissing),
                          })}
                        </p>
                      )}
                    </Show>
                  </div>
                  <div class="flex justify-end">
                    <Button variant="secondary" onClick={() => dialog.close()}>
                      {language.t("common.close")}
                    </Button>
                  </div>
                </Show>
                <Show when={job().logs.length > 0}>
                  <details>
                    <summary class="cursor-pointer text-sm text-text-weak">
                      {language.t("dialog.spinosaOnboarding.logs")}
                    </summary>
                    <pre class="mt-2 max-h-40 overflow-auto rounded bg-black/5 p-2 text-xs whitespace-pre-wrap dark:bg-white/5">
                      {job().logs.join("\n")}
                    </pre>
                  </details>
                </Show>
                <Show when={job().files.length > 0}>
                  <details>
                    <summary class="cursor-pointer text-sm text-text-weak">
                      {language.t("dialog.spinosaOnboarding.files", { count: job().files.length })}
                    </summary>
                    <ul class="mt-2 max-h-40 overflow-auto rounded border border-border-base px-3 py-2 text-xs">
                      <For each={job().files}>
                        {(file) => (
                          <li class="flex justify-between gap-3 py-1">
                            <span class="min-w-0 truncate">{file.relPath}</span>
                            <span class="shrink-0 text-text-weak">{file.status}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </details>
                </Show>
              </>
            )}
          </Show>
          <Show when={state.confirmCancel}>
            <div role="alert" class="rounded border border-border-base p-3 text-sm">
              <p>{language.t("dialog.spinosaOnboarding.cancelConfirm")}</p>
              <div class="mt-3 flex justify-end gap-2">
                <Button variant="ghost" disabled={state.busy} onClick={() => setState("confirmCancel", false)}>
                  {language.t("dialog.spinosaOnboarding.keepImporting")}
                </Button>
                <Button variant="secondary" disabled={state.busy} onClick={() => void cancelImport()}>
                  {language.t("dialog.spinosaOnboarding.cancelImport")}
                </Button>
              </div>
            </div>
          </Show>
        </Show>
        <Show when={state.error}>
          <p class="text-sm text-danger">{state.error}</p>
        </Show>
      </div>
    </Dialog>
  )
}
