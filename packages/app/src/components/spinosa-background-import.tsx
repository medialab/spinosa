import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { activeOnboardingJob } from "@/utils/active-onboarding-job"
import type { OnboardingJobGetResponse } from "@spinosa/sdk/v2/client"
import { createSignal, For, onCleanup, Show } from "solid-js"

const FINAL_STATUSES = new Set(["completed", "failed", "cancelled"])
const progressNumber = (value: number | "NaN" | "Infinity" | "-Infinity" | undefined) =>
  typeof value === "number" ? value : 0

export function createBackgroundImportStatus(
  fetchActive: () => Promise<OnboardingJobGetResponse | undefined>,
  fetchJob: (jobID: string) => Promise<OnboardingJobGetResponse | undefined>,
) {
  const [job, setJob] = createSignal<OnboardingJobGetResponse>()
  const [pollError, setPollError] = createSignal<string>()

  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const pollJob = async (jobID: string) => {
    try {
      const result = await fetchJob(jobID)
      if (disposed) return
      if (result) {
        setJob(result)
        setPollError(undefined)
        if (FINAL_STATUSES.has(result.status)) return
      }
    } catch (cause) {
      if (disposed) return
      setPollError(cause instanceof Error ? cause.message : String(cause))
    }
    timer = setTimeout(() => void pollJob(jobID), 1_000)
  }

  void fetchActive().then((active) => {
    if (disposed || !active) return
    setJob(active)
    if (!FINAL_STATUSES.has(active.status)) timer = setTimeout(() => void pollJob(active.id), 1_000)
  }).catch((cause) => {
    if (!disposed) setPollError(cause instanceof Error ? cause.message : String(cause))
  })

  onCleanup(() => {
    disposed = true
    if (timer) clearTimeout(timer)
  })

  return { job, pollError, dismiss: () => { setJob(undefined); setPollError(undefined) } }
}

export function SpinosaBackgroundImport(props: { directory: string }) {
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const client = () => serverSDK().ensureDirSdkContext(props.directory).client
  const { job, pollError, dismiss } = createBackgroundImportStatus(
    () => activeOnboardingJob(() => client().onboarding.active.get({ directory: props.directory })),
    async (jobID) => (await client().onboarding.job.get({ directory: props.directory, jobID })).data,
  )

  return (
    <div class="min-w-0 pl-3 pr-2 text-12-regular text-text-weak">
      <Show when={job()}>
        {(snapshot) => (
          <>
            <div class="flex min-w-0 items-center gap-2" aria-live="polite">
              <span class="min-w-0 flex-1 truncate" title={snapshot().message || snapshot().phase}>{snapshot().message || snapshot().phase}</span>
              <Show when={progressNumber(snapshot().total) > 0}>
                <progress class="h-1 w-20 shrink-0 accent-icon-base" value={progressNumber(snapshot().current)} max={progressNumber(snapshot().total)} aria-label={snapshot().phase} />
              </Show>
              <Show when={FINAL_STATUSES.has(snapshot().status)}>
                <button type="button" class="shrink-0 text-text-base underline underline-offset-2" onClick={dismiss}>
                  {language.t("common.dismiss")}
                </button>
              </Show>
            </div>
            <details class="text-xs">
              <summary class="cursor-pointer">{language.t("dialog.spinosaOnboarding.files", { count: snapshot().files?.length ?? 0 })}</summary>
              <div class="max-h-48 overflow-auto rounded border border-border-base p-2">
                <Show when={snapshot().workspacePath}><p class="break-all">{snapshot().workspacePath}</p></Show>
                <Show when={snapshot().activeFile}><p class="break-all">{snapshot().activeFile}</p></Show>
                <Show when={snapshot().result}>{(result) => <p>{language.t("dialog.spinosaOnboarding.verification", { imported: progressNumber(result().imported), recovered: progressNumber(result().recovered), failed: progressNumber(result().failed), missing: progressNumber(result().stillMissing) })}</p>}</Show>
                <For each={snapshot().files ?? []}>{(file) => <p class="break-all">{file.relPath} · {file.status}</p>}</For>
              </div>
            </details>
            <Show when={(snapshot().logs?.length ?? 0) > 0}><details class="text-xs"><summary class="cursor-pointer">{language.t("dialog.spinosaOnboarding.logs")}</summary><pre class="max-h-48 overflow-auto rounded border border-border-base p-2 whitespace-pre-wrap break-all">{snapshot().logs?.join("\n")}</pre></details></Show>
          </>
        )}
      </Show>
      <Show when={pollError()}><p class="break-all text-danger" role="status">{pollError()}</p></Show>
    </div>
  )
}
