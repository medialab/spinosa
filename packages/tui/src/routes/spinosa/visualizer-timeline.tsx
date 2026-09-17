import { createMemo, createSignal, For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { DialogToolDetail } from "./dialog-tool-detail"
import { inputSummary, toolCalloutColor } from "./visualizer-utils"
import type { CanvasViewProps, ToolCallRecord } from "./visualizer-types"
import { buttonBackground, buttonText } from "../../util/button"
import { useTheme } from "../../context/theme"

export function TimelineView(props: CanvasViewProps & { workdir?: string }) {
  const { theme } = useTheme()
  const [hovered, setHovered] = createSignal(-1)

  const maxDuration = createMemo(() => {
    let max = 1
    for (const c of props.toolCalls) {
      if (c.timeStart && c.timeEnd) {
        max = Math.max(max, c.timeEnd - c.timeStart)
      }
    }
    return max
  })

  const openDetail = (call: ToolCallRecord) => props.dialog.replace(() => <DialogToolDetail part={call.part} workdir={props.workdir} />)

  return (
    <box flexDirection="column" width="100%">
      {/* column headers */}
      <box flexDirection="row" gap={0} paddingLeft={1} paddingRight={1}>
        <text fg={theme.textMuted} width={4} attributes={TextAttributes.DIM}> </text>
        <text fg={theme.textMuted} width={2} attributes={TextAttributes.DIM}>S</text>
        <text fg={theme.textMuted} width={14} attributes={TextAttributes.DIM}>Tool</text>
        <text fg={theme.textMuted} overflow="hidden" wrapMode="none" flexGrow={1} attributes={TextAttributes.DIM}>Input</text>
        <text fg={theme.textMuted} width={9} attributes={TextAttributes.DIM}>Duration</text>
      </box>

      {/* rows */}
      <box flexDirection="column" gap={1}>
        <For each={props.toolCalls}>
          {(call, idx) => {
          const duration = call.timeStart && call.timeEnd ? call.timeEnd - call.timeStart : 0
          const barLen = maxDuration() > 0 ? Math.round((duration / maxDuration()) * 8) : 0
          const typeColor = toolCalloutColor(call.tool, theme)
          const dotColor = call.status === "error" ? theme.error : typeColor
          const dotIcon = call.status === "completed" ? "✔" : call.status === "error" ? "✗" : call.status === "running" ? "◌" : "●"
          const isLast = idx() === props.toolCalls.length - 1
          const conn = isLast ? " └─" : " ├─"
          const hov = () => hovered() === idx()

          return (
            <box
              flexDirection="row" gap={0} paddingLeft={1} paddingRight={1}
              backgroundColor={buttonBackground(theme, hov())}
              onMouseOver={() => setHovered(idx())}
              onMouseOut={() => setHovered(-1)}
              onMouseDown={() => openDetail(call)}
            >
              <text fg={buttonText(theme, hov(), theme.border)} width={4}>{conn}</text>
              <text fg={buttonText(theme, hov(), dotColor)} width={2}>{dotIcon}</text>
              <text fg={buttonText(theme, hov(), typeColor)} width={14} attributes={hov() ? TextAttributes.UNDERLINE : TextAttributes.NONE}>
                <span style={{ bold: hov() }}>{call.tool}</span>
              </text>
              <text fg={buttonText(theme, hov(), theme.textMuted)} overflow="hidden" wrapMode="none" flexGrow={1} attributes={hov() ? TextAttributes.UNDERLINE : TextAttributes.NONE}>
                {inputSummary(call.tool, call.input)}
              </text>
              <text fg={buttonText(theme, hov(), dotColor)} width={9} attributes={hov() ? TextAttributes.UNDERLINE : TextAttributes.NONE}>
                {"█".repeat(barLen) + "░".repeat(8 - barLen)}
              </text>
            </box>
          )
          }}
        </For>
      </box>
    </box>
  )
}
