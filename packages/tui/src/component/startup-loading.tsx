import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import type { SpinosaBootOperation } from "@spinosa/core/system/boot"
import { WaveSpinner } from "./wave-spinner"

const MINIMUM_BOOT_DISPLAY_MS = 3_000

export type StartupOverlayAction = "track-boot" | "complete" | "hold" | "defer-show" | "stay"

/** Decide overlay vs first paint. Instant-ready boot must complete without a splash. */
export function nextStartupOverlayAction(input: {
  ready: boolean
  showing: boolean
  bootInProgress: boolean
}): StartupOverlayAction {
  if (input.bootInProgress) return "track-boot"
  if (input.ready) return input.showing ? "hold" : "complete"
  if (input.showing) return "stay"
  return "defer-show"
}

export function StartupLoading(props: {
  ready: () => boolean
  operations?: () => SpinosaBootOperation[]
  onComplete?: () => void
}) {
  const theme = useTheme().theme
  const [show, setShow] = createSignal(false)
  const bootInProgress = createMemo(() =>
    props.operations?.().some((operation) => operation.status === "running" || operation.status === "pending") ?? false,
  )
  const text = createMemo(() => {
    if (bootInProgress()) {
      return "Preparing Spinosa..."
    }
    return props.ready() ? "Finishing startup..." : "Loading plugins..."
  })
  let wait: NodeJS.Timeout | undefined
  let hold: NodeJS.Timeout | undefined
  let stamp = 0
  let completed = false

  const finish = () => {
    if (completed) return
    completed = true
    setShow(false)
    props.onComplete?.()
  }

  createEffect(() => {
    const action = nextStartupOverlayAction({
      ready: props.ready(),
      showing: show(),
      bootInProgress: bootInProgress(),
    })

    if (action === "track-boot") {
      if (wait) {
        clearTimeout(wait)
        wait = undefined
      }
      if (!show()) {
        stamp = Date.now()
        setShow(true)
      }
      return
    }

    if (action === "complete") {
      if (wait) {
        clearTimeout(wait)
        wait = undefined
      }
      finish()
      return
    }

    if (action === "hold") {
      if (wait) {
        clearTimeout(wait)
        wait = undefined
      }
      if (hold) return

      const left = MINIMUM_BOOT_DISPLAY_MS - (Date.now() - stamp)
      if (left <= 0) {
        finish()
        return
      }

      hold = setTimeout(() => {
        hold = undefined
        finish()
      }, left).unref()
      return
    }

    if (action === "stay") {
      if (hold) {
        clearTimeout(hold)
        hold = undefined
      }
      return
    }

    if (hold) {
      clearTimeout(hold)
      hold = undefined
    }
    if (wait) return

    wait = setTimeout(() => {
      wait = undefined
      stamp = Date.now()
      setShow(true)
    }, 500).unref()
  })

  onCleanup(() => {
    if (wait) clearTimeout(wait)
    if (hold) clearTimeout(hold)
  })

  return (
    <Show when={show()}>
      <box position="absolute" zIndex={5000} left={0} right={0} top={0} bottom={0} justifyContent="center" alignItems="center">
        <box backgroundColor={theme.backgroundPanel} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
          <WaveSpinner color={theme.textMuted}>{text()}</WaveSpinner>
          <For each={props.operations?.().filter((operation) => operation.status !== "pending") ?? []}>
            {(operation) => (
              <text fg={operation.status === "error" ? theme.error : operation.status === "warning" ? theme.warning : theme.textMuted}>
                {operation.status === "complete" ? "✓" : operation.status === "error" ? "!" : operation.status === "warning" ? "!" : "·"} {operation.label}{operation.detail ? ` — ${operation.detail}` : ""}
              </text>
            )}
          </For>
        </box>
      </box>
    </Show>
  )
}
