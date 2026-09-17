import { createMemo, createSignal, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { toolCalloutColor } from "./visualizer-utils"
import { buttonBackground, buttonText } from "../../util/button"
import { useTheme } from "../../context/theme"
import type { CanvasViewProps } from "./visualizer-types"

export function SessionsView(props: CanvasViewProps) {
  const { theme } = useTheme()
  const [hovered, setHovered] = createSignal(-1)

  const grouped = createMemo(() => {
    const map = new Map<string, { title: string; calls: typeof props.toolCalls }>()
    for (const c of props.toolCalls) {
      const key = c.sessionTitle || "Unknown"
      if (!map.has(key)) map.set(key, { title: key, calls: [] })
      map.get(key)!.calls.push(c)
    }
    return [...map.entries()].map(([, g]) => g)
  })

  const barWidth = 36
  const PARTIAL = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇"]

  return (
    <box flexDirection="column" width="100%">
      <For each={grouped()}>
        {(group, gIdx) => {
          const byTool: Record<string, number> = {}
          let errors = 0
          for (const c of group.calls) {
            byTool[c.tool] = (byTool[c.tool] ?? 0) + 1
            if (c.status === "error") errors++
          }
          const entries = Object.entries(byTool).sort((a, b) => b[1] - a[1])
          const maxCount = Math.max(...entries.map(([, n]) => n), 1)

          return (
            <box flexDirection="column" width="100%" paddingLeft={1}>
              <box
                paddingRight={1}
                backgroundColor={buttonBackground(theme, hovered() === gIdx())}
                onMouseOver={() => setHovered(gIdx())}
                onMouseOut={() => setHovered(-1)}
              >
                <text fg={buttonText(theme, hovered() === gIdx(), theme.text)}>
                  <span style={{ bold: hovered() === gIdx() }}>
                    {group.title.slice(0, 40)}
                  </span>
                </text>
                <text fg={buttonText(theme, hovered() === gIdx(), theme.textMuted)}>
                  {" "}({group.calls.length} calls{errors > 0 ? `, ${errors} errors` : ""})
                </text>
              </box>
              <For each={entries}>
                {([tool, count]) => {
                  const typeColor = toolCalloutColor(tool, theme)
                  const scaled = (count / maxCount) * barWidth
                  const full = Math.floor(scaled)
                  const partial = Math.round((scaled - full) * 8)
                  const bar = "█".repeat(full) + (partial > 0 ? PARTIAL[partial] : "")
                  return (
                    <box flexDirection="row" gap={1} paddingLeft={2}>
                      <text fg={typeColor} width={12}>{tool}</text>
                      <text fg={typeColor} width={barWidth}>{bar.padEnd(barWidth)}</text>
                      <text fg={theme.text} width={3}>{count}</text>
                    </box>
                  )
                }}
              </For>
            </box>
          )
        }}
      </For>

      <Show when={grouped().length === 0}>
        <box paddingLeft={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>No session grouping available</text>
        </box>
      </Show>
    </box>
  )
}
