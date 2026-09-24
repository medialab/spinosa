import { useServerSDK } from "@/context/server-sdk"
import { activeOnboardingJob } from "@/utils/active-onboarding-job"
import type { OnboardingJobGetResponse } from "@spinosa/sdk/v2/client"
import { createSignal, onCleanup, Show } from "solid-js"

const FINAL_STATUSES = new Set(["completed", "failed", "cancelled"])
const progressNumber = (value: number | "NaN" | "Infinity" | "-Infinity" | undefined) =>
  typeof value === "number" ? value : 0

export function SpinosaBackgroundImport(props: { directory: string }) {
  const serverSDK = useServerSDK()
  const [job, setJob] = createSignal<OnboardingJobGetResponse>()

  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const client = () => serverSDK().ensureDirSdkContext(props.directory).client

  const scheduleClear = () => {
    timer = setTimeout(() => setJob(undefined), 5_000)
  }

  const pollJob = async (jobID: string) => {
    try {
      const result = await client().onboarding.job.get({ directory: props.directory, jobID })
      if (disposed || !result.data) return
      setJob(result.data)
      if (FINAL_STATUSES.has(result.data.status)) {
        scheduleClear()
        return
      }
      timer = setTimeout(() => void pollJob(jobID), 1_000)
    } catch {
      if (!disposed) setJob(undefined)
    }
  }

  void activeOnboardingJob(() => client().onboarding.active.get({ directory: props.directory })).then((active) => {
    if (disposed || !active) return
    setJob(active)
    timer = setTimeout(() => void pollJob(active.id), 1_000)
  }).catch(() => undefined)

  onCleanup(() => {
    disposed = true
    if (timer) clearTimeout(timer)
  })

  return (
    <Show when={job()}>
      {(snapshot) => (
        <div class="flex min-w-0 items-center gap-2 pl-3 pr-2 text-12-regular text-text-weak" aria-live="polite">
          <span class="min-w-0 flex-1 truncate">{snapshot().message || snapshot().phase}</span>
          <Show when={progressNumber(snapshot().total) > 0}>
            <progress
              class="h-1 w-20 shrink-0 accent-icon-base"
              value={progressNumber(snapshot().current)}
              max={progressNumber(snapshot().total)}
              aria-label={snapshot().phase}
            />
          </Show>
        </div>
      )}
    </Show>
  )
}
