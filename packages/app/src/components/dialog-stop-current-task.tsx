import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { useDialog } from "@spinosa/ui/context/dialog"
import { Spinner } from "@spinosa/ui/spinner"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"
import { createStore } from "solid-js/store"
import { onCleanup, onMount, Show } from "solid-js"

type Stop = () => Promise<void>

function errorMessage(cause: unknown, translate: ReturnType<typeof useLanguage>["t"]) {
  const findMessage = (value: unknown, seen = new Set<object>()): string | undefined => {
    if (value instanceof Error) return value.message || undefined
    if (typeof value === "string") return value || undefined
    if (!value || typeof value !== "object" || seen.has(value)) return
    seen.add(value)
    const object = value as Record<string, unknown>
    if (typeof object.message === "string" && object.message) return object.message
    for (const key of ["error", "data", "body", "cause"]) {
      const message = findMessage(object[key], seen)
      if (message) return message
    }
  }

  return findMessage(cause) ?? formatServerError(cause, translate)
}

export function DialogStopCurrentTask(props: {
  check: () => Promise<Stop | undefined>
  isActive: () => boolean
  onHome: () => void
  beforeLeave?: () => void
  onStopFailed?: () => void
  message?: string
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [state, setState] = createStore<{
    phase: "checking" | "confirm" | "stopping" | "error"
    stop?: Stop
    retry?: "check" | "stop"
    error?: string
  }>({ phase: "checking" })
  let attempt = 0

  const check = async () => {
    const current = ++attempt
    setState({ phase: "checking", stop: undefined, retry: undefined, error: undefined })
    try {
      const stop = await props.check()
      if (current !== attempt || !props.isActive()) return
      if (!stop) {
        props.beforeLeave?.()
        props.onHome()
        dialog.close()
        return
      }
      setState({ phase: "confirm", stop, retry: undefined, error: undefined })
    } catch (cause) {
      if (current !== attempt || !props.isActive()) return
      setState({
        phase: "error",
        stop: undefined,
        retry: "check",
        error: errorMessage(cause, language.t),
      })
    }
  }

  const stop = async () => {
    if (!state.stop || state.phase === "stopping") return
    const action = state.stop
    setState({ phase: "stopping", stop: action, retry: undefined, error: undefined })
    try {
      props.beforeLeave?.()
      await action()
      if (!props.isActive()) return
      props.onHome()
      dialog.close()
    } catch (cause) {
      if (!props.isActive()) return
      props.onStopFailed?.()
      setState({
        phase: "error",
        stop: action,
        retry: "stop",
        error: errorMessage(cause, language.t),
      })
    }
  }

  onMount(() => void check())
  onCleanup(() => {
    attempt += 1
  })

  const busy = () => state.phase === "checking" || state.phase === "stopping"
  const retry = () => (state.retry === "stop" ? void stop() : void check())

  return (
    <Dialog
      title={
        state.phase === "checking" || (state.phase === "error" && state.retry === "check")
          ? language.t(state.phase === "checking" ? "common.loading" : "common.requestFailed")
          : language.t("home.leaveTask.title")
      }
    >
      <div class="flex flex-col gap-4 px-4 py-3">
        <Show when={state.phase === "checking"}>
          <div
            data-component="home-task-check-loading"
            class="flex items-center gap-2 text-sm text-text-weak"
            role="status"
            aria-live="polite"
          >
            <Spinner class="size-4" />
            {language.t("common.loading")}
          </div>
        </Show>
        <Show when={state.phase === "confirm" || (state.phase === "error" && state.retry === "stop")}>
          <p class="text-sm opacity-80">{props.message ?? language.t("home.leaveTask.message")}</p>
        </Show>
        <Show when={state.phase === "stopping"}>
          <div
            data-component="home-task-stopping"
            class="flex items-center gap-2 text-sm text-text-weak"
            role="status"
            aria-live="polite"
          >
            <Spinner class="size-4" />
            {language.t("home.leaveTask.stopping")}
          </div>
        </Show>
        <Show when={state.phase === "error"}>
          <p class="text-sm text-text-danger" role="alert">
            {state.retry === "check" ? state.error : `${language.t("common.requestFailed")}: ${state.error}`}
          </p>
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy()} onClick={() => dialog.close()}>
            {state.phase === "checking" || (state.phase === "error" && state.retry === "check")
              ? language.t("common.cancel")
              : language.t("home.leaveTask.no")}
          </Button>
          <Show when={state.phase === "confirm"}>
            <Button variant="secondary" disabled={busy()} onClick={() => void stop()}>
              {language.t("home.leaveTask.yes")}
            </Button>
          </Show>
          <Show when={state.phase === "error"}>
            <Button variant="secondary" disabled={busy()} onClick={retry}>
              {language.t("common.continue")}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
