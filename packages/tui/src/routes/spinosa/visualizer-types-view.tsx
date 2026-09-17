import { createMemo, createSignal, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { toolCalloutColor } from "./visualizer-utils"
import { buttonBackground, buttonText } from "../../util/button"
import { useTheme } from "../../context/theme"
import type { CanvasViewProps } from "./visualizer-types"

export function TypesView(props: CanvasViewProps) {
  const { theme } = useTheme()
  const [hovered, setHovered] = createSignal(-1)

  const stats = createMemo(() => {
    const byTool: Record<string, { total: number; completed: number; error: number; durations: number[] }> = {}
    for (const c of props.toolCalls) {
      if (!byTool[c.tool]) byTool[c.tool] = { total: 0, completed: 0, error: 0, durations: [] }
      const s = byTool[c.tool]
      s.total++
      if (c.status === "completed") s.completed++
      if (c.status === "error") s.error++
      if ((c.status === "completed" || c.status === "error") && c.timeStart && c.timeEnd) {
        s.durations.push(c.timeEnd - c.timeStart)
      }
    }
    return Object.entries(byTool).sort((a, b) => b[1].total - a[1].total)
  })

  const maxCount = createMemo(() => Math.max(...stats().map(([, s]) => s.total), 1))
  const totalCalls = createMemo(() => props.toolCalls.length)
  const totalErrors = createMemo(() => props.toolCalls.filter((c) => c.status === "error").length)
  const barWidth = 44
  const PARTIAL = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇"]

  return (
    <box flexDirection="column" width="100%">
      {/* header row */}
      <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
        <text fg={theme.textMuted} width={12} attributes={TextAttributes.DIM}>Tool</text>
        <text fg={theme.textMuted} width={barWidth} attributes={TextAttributes.DIM}>Distribution</text>
        <text fg={theme.textMuted} width={4} attributes={TextAttributes.DIM}>Calls</text>
        <text fg={theme.textMuted} width={4} attributes={TextAttributes.DIM}>Err</text>
        <text fg={theme.textMuted} width={8} attributes={TextAttributes.DIM}>Avg dur</text>
      </box>

      <For each={stats()}>
        {([tool, s], idx) => {
          const scaled = (s.total / maxCount()) * barWidth
          const full = Math.floor(scaled)
          const partial = Math.round((scaled - full) * 8)
          const bar = "█".repeat(full) + (partial > 0 ? PARTIAL[partial] : "")
          const avgDur = s.durations.length > 0 ? Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length) : 0
          const durText = avgDur > 0 ? `${avgDur >= 1000 ? (avgDur / 1000).toFixed(1) + "s" : avgDur + "ms"}` : ""
          const typeColor = toolCalloutColor(tool, theme)
          const hov = () => hovered() === idx()

          return (
            <box
              flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}
              backgroundColor={buttonBackground(theme, hov())}
              onMouseOver={() => setHovered(idx())}
              onMouseOut={() => setHovered(-1)}
            >
              <text fg={buttonText(theme, hov(), typeColor)} width={12}>
                <span style={{ bold: hov() }}>{tool.slice(0, 12)}</span>
              </text>
              <text fg={buttonText(theme, hov(), typeColor)} width={barWidth}>{bar.padEnd(barWidth)}</text>
              <text fg={buttonText(theme, hov(), theme.text)} width={4}>{String(s.total).padStart(2)}</text>
              <text fg={buttonText(theme, hov(), s.error > 0 ? theme.error : theme.textMuted)} width={4}>
                {s.error > 0 ? `✕${s.error}` : ""}
              </text>
              <text fg={buttonText(theme, hov(), theme.textMuted)} width={8}>{durText}</text>
            </box>
          )
        }}
      </For>

      {/* summary row */}
      <box height={1} />
      <box paddingLeft={1}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          Total: {totalCalls()} calls · {totalErrors()} errors · Avg duration: — · Wall time: —
        </text>
      </box>
    </box>
  )
}
