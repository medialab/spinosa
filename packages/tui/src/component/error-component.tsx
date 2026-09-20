import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"
import open from "open"
import { getScrollAcceleration } from "../util/scroll"
import { useClipboard } from "../context/clipboard"
import { InstallationVersion } from "@spinosa/kernel-core/installation/version"
import { useExit } from "../context/exit"
import { buildBugReportUrl, openBugReport } from "../spinosa/bug-report"

export function ErrorComponent(props: { error: Error; reset: () => void; mode?: "dark" | "light" }) {
  const term = useTerminalDimensions()
  const exit = useExit()
  const clipboard = useClipboard()
  const [reportState, setReportState] = createSignal<"idle" | "opened" | "copied">("idle")

  // Safe fallback palette per mode (mirrors theme/assets/spinosa.json) since the
  // theme context may be the thing that crashed.
  const isLight = props.mode === "light"
  const colors = isLight
    ? {
        bg: "#ffffff",
        element: "#f5f5f5",
        borderSubtle: "#d4d4d4",
        text: "#1a1a1a",
        muted: "#8a8a8a",
        primary: "#3b7dd8",
        onPrimary: "#ffffff",
        error: "#d1383d",
        success: "#3d9a57",
      }
    : {
        bg: "#0a0a0a",
        element: "#1e1e1e",
        borderSubtle: "#3c3c3c",
        text: "#eeeeee",
        muted: "#808080",
        primary: "#6cb2f5",
        onPrimary: "#0a0a0a",
        error: "#e06c75",
        success: "#7fd88f",
      }

  const message = props.error.message || "An unknown error occurred."
  const stack = props.error.stack || "No stack trace available."
  const issueURL = buildBugReportUrl({ kind: "crash", message, stack })

  const openReport = () => {
    void openBugReport(issueURL, {
      openUrl: (href) => open(href),
      writeClipboard: clipboard.write,
    }).then((result) => {
      if (result === "opened") setReportState("opened")
      else if (result === "copied") setReportState("copied")
    })
  }

  const reportLabel = () => {
    if (reportState() === "opened") return "✓ Opened"
    if (reportState() === "copied") return "✓ Copied"
    return "Open report"
  }

  const actions = [
    { key: "o", label: reportLabel, copy: true, onUse: openReport },
    { key: "r", label: () => "Restart", onUse: props.reset },
    { key: "q", label: () => "Quit", onUse: () => exit() },
  ]
  const [selected, setSelected] = createSignal(0)
  const move = (delta: number) => setSelected((prev) => (prev + delta + actions.length) % actions.length)
  let scroll: ScrollBoxRenderable | undefined

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") return exit()
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      return actions[selected()].onUse()
    }
    if (evt.name === "left") {
      evt.preventDefault()
      evt.stopPropagation()
      return move(-1)
    }
    if (evt.name === "right") {
      evt.preventDefault()
      evt.stopPropagation()
      return move(1)
    }
    if (evt.name === "tab") {
      evt.preventDefault()
      evt.stopPropagation()
      return move(evt.shift ? -1 : 1)
    }
    // Vertical keys scroll the stack trace; buttons navigate horizontally.
    if (evt.name === "up") return scroll?.scrollBy(-1)
    if (evt.name === "down") return scroll?.scrollBy(1)
    if (evt.name === "pageup" && scroll) return scroll.scrollBy(-scroll.height)
    if (evt.name === "pagedown" && scroll) return scroll.scrollBy(scroll.height)
    if (evt.name === "home" && scroll) return scroll.scrollTo(0)
    if (evt.name === "end" && scroll) return scroll.scrollTo(scroll.scrollHeight)
    if (evt.name === "q") return exit()
    if (evt.name === "o" || evt.name === "c") return openReport()
    if (evt.name === "r") return props.reset()
  })

  // Responsive thresholds.
  const contentWidth = () => Math.min(84, Math.max(24, term().width - 4))
  const showSubtext = () => term().height >= 18
  const showFooter = () => term().height >= 20
  const reported = () => reportState() !== "idle"

  return (
    <box
      width={term().width}
      height={term().height}
      backgroundColor={colors.bg}
      flexDirection="column"
      alignItems="center"
    >
      <box width={contentWidth()} flexGrow={1} flexDirection="column" paddingTop={1} paddingBottom={1} gap={1}>
        {/* Headline */}
        <box flexDirection="column" alignItems="center" flexShrink={0}>
          <text attributes={TextAttributes.BOLD} fg={colors.text}>
            spinosa crashed
          </text>
          <Show when={showSubtext()}>
            <text fg={colors.muted}>An unexpected error stopped the session.</text>
          </Show>
        </box>

        {/* Error message panel */}
        <box
          flexShrink={0}
          border
          borderStyle="rounded"
          borderColor={colors.error}
          title=" Error "
          titleColor={colors.error}
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg={colors.text}>{message}</text>
        </box>

        {/* Actions */}
        <box flexDirection="row" flexWrap="wrap" justifyContent="center" gap={2} rowGap={1} flexShrink={0}>
          <For each={actions}>
            {(action, index) => {
              const isSelected = () => selected() === index()
              const isCopied = () => action.copy && reported()
              return (
                <box flexDirection="column" alignItems="center" flexShrink={0}>
                  <box
                    onMouseOver={() => setSelected(index())}
                    onMouseDown={() => setSelected(index())}
                    onMouseUp={() => action.onUse()}
                    backgroundColor={isCopied() ? colors.success : isSelected() ? colors.primary : colors.element}
                    minWidth={15}
                    alignItems="center"
                    paddingLeft={2}
                    paddingRight={2}
                  >
                    <text
                      attributes={TextAttributes.BOLD}
                      fg={isCopied() || isSelected() ? colors.onPrimary : colors.text}
                    >
                      {action.label()}
                    </text>
                  </box>
                  <text fg={isSelected() ? colors.primary : colors.muted}>{action.key}</text>
                </box>
              )
            }}
          </For>
        </box>

        {/* Stack trace */}
        <box
          flexGrow={1}
          flexBasis={0}
          minHeight={3}
          border
          borderStyle="rounded"
          borderColor={colors.borderSubtle}
          title=" Stack trace "
          titleColor={colors.muted}
          bottomTitle=" ↑↓ scroll "
          bottomTitleAlignment="right"
          paddingLeft={1}
          paddingRight={1}
        >
          <scrollbox
            ref={(element: ScrollBoxRenderable) => (scroll = element)}
            flexGrow={1}
            scrollAcceleration={getScrollAcceleration()}
          >
            <text fg={colors.muted}>{stack}</text>
          </scrollbox>
        </box>

        {/* Footer */}
        <Show when={showFooter()}>
          <box flexDirection="column" alignItems="center" flexShrink={0}>
            <text fg={colors.muted}>
              {reportState() === "opened"
                ? "GitHub form opened. Submit on github.com/medialab/spinosa to file the issue."
                : reportState() === "copied"
                  ? "URL copied — paste it in a browser, then Submit on GitHub."
                  : "Open the GitHub form. Nothing is posted until you Submit."}
            </text>
            <text fg={colors.muted}>spinosa {InstallationVersion}</text>
          </box>
        </Show>
      </box>
    </box>
  )
}
