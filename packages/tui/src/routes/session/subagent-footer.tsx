import { createMemo, createSignal, Show } from "solid-js"
import { useSessionRoute } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { Locale } from "../../util/locale"
import { useTerminalDimensions } from "@opentui/solid"
import { useCommandShortcut, useOpencodeKeymap } from "../../keymap"
import { agentDisplayName } from "../../util/agent"
import { buttonBackground, buttonText } from "../../util/button"
import { pickSubagentAccent, siblingSubagentIDs } from "./subagent-chrome"

export function SubagentFooter() {
  const route = useSessionRoute()
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID))

  const subagentInfo = createMemo(() => {
    const s = session()
    if (!s) return { label: "Subagent", index: 0, total: 0 }
    const agentMatch = s.title.match(/@(\w+) subagent/)
    const label = agentMatch ? agentDisplayName(agentMatch[1]) : "Subagent"

    if (!s.parentID) return { label, index: 0, total: 0 }

    const siblings = sync.data.session
      .filter((x) => x.parentID === s.parentID)
      .toSorted((a, b) => a.time.created - b.time.created)
    const index = siblings.findIndex((x) => x.id === s.id)

    return { label, index: index + 1, total: siblings.length }
  })

  const { theme } = useTheme()
  const accent = createMemo(() => {
    const current = session()
    if (!current?.parentID) return theme.border
    return pickSubagentAccent(theme, current.id, siblingSubagentIDs(sync.data.session, current))
  })
  const keymap = useOpencodeKeymap()
  const parentShortcut = useCommandShortcut("session.parent")
  const previousShortcut = useCommandShortcut("session.child.previous")
  const nextShortcut = useCommandShortcut("session.child.next")
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)
  useTerminalDimensions()

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={accent()}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
          <box flexDirection="row" justifyContent="space-between" gap={1}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.text} wrapMode="none">
                <b>{subagentInfo().label}</b>
              </text>
              <Show when={subagentInfo().total > 0}>
                <text style={{ fg: theme.textMuted }} wrapMode="none">
                  ({subagentInfo().index} of {subagentInfo().total})
                </text>
              </Show>
            </box>
            <box flexDirection="row" gap={2}>
              <box
                onMouseOver={() => setHover("parent")}
                onMouseOut={() => setHover(null)}
                onMouseDown={() => keymap.dispatchCommand("session.parent")}
                backgroundColor={buttonBackground(theme, hover() === "parent")}
              >
                <text fg={buttonText(theme, hover() === "parent", theme.text)} wrapMode="none">
                  Parent <span style={{ fg: buttonText(theme, hover() === "parent", theme.textMuted) }}>{parentShortcut()}</span>
                </text>
              </box>
              <box
                onMouseOver={() => setHover("prev")}
                onMouseOut={() => setHover(null)}
                onMouseDown={() => keymap.dispatchCommand("session.child.previous")}
                backgroundColor={buttonBackground(theme, hover() === "prev")}
              >
                <text fg={buttonText(theme, hover() === "prev", theme.text)} wrapMode="none">
                  Prev <span style={{ fg: buttonText(theme, hover() === "prev", theme.textMuted) }}>{previousShortcut()}</span>
                </text>
              </box>
              <box
                onMouseOver={() => setHover("next")}
                onMouseOut={() => setHover(null)}
                onMouseDown={() => keymap.dispatchCommand("session.child.next")}
                backgroundColor={buttonBackground(theme, hover() === "next")}
              >
                <text fg={buttonText(theme, hover() === "next", theme.text)} wrapMode="none">
                  Next <span style={{ fg: buttonText(theme, hover() === "next", theme.textMuted) }}>{nextShortcut()}</span>
                </text>
              </box>
            </box>
          </box>
      </box>
    </box>
  )
}
