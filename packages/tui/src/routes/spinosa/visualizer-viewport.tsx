import { Show, type JSX, type ParentProps } from "solid-js"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "../../context/theme"
import type { ToolCallRecord, VisualizerMode } from "./visualizer-types"

export function VisualizerCanvas(props: ParentProps<{ height: number }>) {
  const { theme } = useTheme()
  return (
    <box
      width="100%"
      height={props.height}
      paddingX={2}
      paddingY={1}
      alignItems="flex-start"
      justifyContent="flex-start"
      backgroundColor={theme.backgroundPanel}
    >
      {props.children}
    </box>
  )
}

export function Viewport(props: {
  mode: VisualizerMode
  toolCalls: ToolCallRecord[]
  loading: boolean
  loadedOnce: boolean
  error: string | undefined
  scrollRef?: (el: ScrollBoxRenderable) => void
  children: JSX.Element
}) {
  const { theme } = useTheme()

  const statusText = () => {
    if (props.loading) return "Loading tool calls…"
    if (!props.loadedOnce) return ""
    const calls = props.toolCalls
    const errors = calls.filter((c) => c.status === "error").length
    const running = calls.filter((c) => c.status === "running").length
    let text = `${calls.length} tool calls`
    if (errors > 0) text += ` · ${errors} errors`
    if (running > 0) text += ` · ${running} running`
    return text
  }

  const showEmpty = () => !props.loading && !props.error && (!props.loadedOnce || props.toolCalls.length === 0)

  return (
    <box flexDirection="column" alignItems="flex-start" justifyContent="flex-start" width="100%" height="100%">
      {/* main area */}
      <box flexGrow={1} minHeight={0} width="100%" flexDirection="column" alignItems="flex-start" justifyContent="flex-start">
        <Show when={props.loading || props.error || showEmpty()}>
          <box alignItems="flex-start" justifyContent="flex-start" width="100%" height="100%" flexDirection="column" gap={1}>
            <Show when={props.loading}>
              <text fg={theme.textMuted}>Loading tool calls…</text>
            </Show>
            <Show when={!props.loading && props.error}>
              <text fg={theme.error}>Failed to load</text>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>{props.error}</text>
            </Show>
            <Show when={!props.loading && !props.error && !props.loadedOnce}>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>Pick a workspace and session, then load</text>
            </Show>
            <Show when={!props.loading && !props.error && props.loadedOnce && props.toolCalls.length === 0}>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>No tool calls found in this session</text>
            </Show>
          </box>
        </Show>
        <Show when={!props.loading && !props.error && props.loadedOnce && props.toolCalls.length > 0}>
          <scrollbox
            ref={props.scrollRef}
            flexGrow={1}
            minHeight={0}
            width="100%"
            stickyScroll={true}
            stickyStart="top"
            wrapperOptions={{ justifyContent: "flex-start", alignItems: "stretch" }}
            viewportOptions={{ justifyContent: "flex-start", alignItems: "stretch" }}
            contentOptions={{ justifyContent: "flex-start", alignItems: "stretch" }}
            scrollbarOptions={{ visible: false }}
            verticalScrollbarOptions={{ visible: true }}
          >
            {props.children}
          </scrollbox>
        </Show>
      </box>

      {/* status bar */}
      <Show when={props.loadedOnce && !props.loading && !showEmpty()}>
        <box paddingLeft={1} paddingTop={0}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            {statusText()}
          </text>
        </box>
      </Show>
    </box>
  )
}
