import { createMemo, Show, Suspense, type JSX, type ParentProps } from "solid-js"
import { useTheme } from "./theme"
import { useWait } from "./wait"
import { WaveSpinner } from "../component/wave-spinner"

export function WaitFallback(props: { children?: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <box flexGrow={1} minHeight={3} justifyContent="center" alignItems="center" paddingTop={1} paddingBottom={1}>
      <WaveSpinner color={theme.primary}>{props.children ?? "Working…"}</WaveSpinner>
    </box>
  )
}

export function WaitOverlay(props: { extra?: () => string | undefined }) {
  const wait = useWait()
  const { theme } = useTheme()
  const label = createMemo(() => wait.label() ?? props.extra?.())

  return (
    <Show when={label()}>
      {(text) => (
        <box
          position="absolute"
          zIndex={3800}
          left={0}
          right={0}
          top={0}
          bottom={0}
          justifyContent="center"
          alignItems="center"
        >
          <box
            backgroundColor={theme.backgroundPanel}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <WaveSpinner color={theme.primary}>{text()}</WaveSpinner>
          </box>
        </box>
      )}
    </Show>
  )
}

export function Waiting(props: ParentProps) {
  return <Suspense fallback={<WaitFallback>Loading…</WaitFallback>}>{props.children}</Suspense>
}
