import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { useBindings } from "../../keymap"
import { useClipboard } from "../../context/clipboard"
import { buttonBackground, buttonText } from "../../util/button"
type ToolDetailPart = {
  tool?: string
  callID?: string
  state?: {
    status?: string
    input?: Record<string, unknown>
    error?: unknown
    time?: { start?: number; end?: number }
  }
}

export function DialogToolDetail(props: { part: ToolDetailPart; workdir?: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const clipboard = useClipboard()
  const [copied, setCopied] = createSignal(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => clearTimeout(copyTimer))

  onMount(() => {
    dialog.setSize("large")
  })

  const p = () => props.part
  const s = () => p().state
  const tool = () => p().tool

  const statusColor = createMemo(() => {
    switch (s()?.status) {
      case "completed": return theme.success
      case "error": return theme.error
      case "running": return theme.warning
      default: return theme.textMuted
    }
  })

  const duration = createMemo(() => {
    const t = s()?.time
    if (!t?.start) return undefined
    const end = t.end ?? Date.now()
    const ms = end - t.start
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  })

  const commandBlock = createMemo(() => {
    const inp = s()?.input ?? {}
    const workdir = props.workdir ?? ""
    let cmd = ""
    if (tool() === "bash") {
      cmd = String(inp.command ?? "")
    } else if (tool() === "read") {
      cmd = `cat ${String(inp.filePath ?? inp.file_path ?? "")}`
    } else if (tool() === "edit") {
      cmd = `# edit: ${String(inp.filePath ?? inp.file_path ?? "")}`
    } else if (tool() === "grep") {
      cmd = `grep "${String(inp.pattern ?? "")}"`
    } else if (tool() === "glob") {
      cmd = `find . -name "${String(inp.pattern ?? "")}"`
    } else if (tool() === "webfetch") {
      cmd = `curl ${String(inp.url ?? "")}`
    } else if (tool() === "websearch") {
      cmd = `# search: ${String(inp.query ?? "")}`
    } else if (tool() === "write") {
      cmd = `# write: ${String(inp.filePath ?? inp.file_path ?? "")}`
    } else {
      cmd = JSON.stringify(inp, null, 2)
    }
    const lines = [`cd ${workdir}`, cmd].filter(Boolean)
    return lines.join("\n")
  })

  const copyCommand = async () => {
    if (!clipboard.write) return
    await clipboard.write(commandBlock())
    setCopied(true)
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => setCopied(false), 3000)
  }

  useBindings(() => ({
    bindings: [
      { key: "escape", desc: "Close", group: "Dialog", cmd: () => dialog.clear() },
      { key: "return", desc: "Close", group: "Dialog", cmd: () => dialog.clear() },
      { key: "c", desc: "Copy command", group: "Dialog", cmd: () => void copyCommand() },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Tool detail
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>{tool()}</text>
        <text fg={statusColor()} attributes={TextAttributes.BOLD}>
          {String(s()?.status ?? "").toUpperCase()}
        </text>
      </box>

      <box height={1} backgroundColor={theme.border} />

      {/* command block */}
      <box flexDirection="column">
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>──── Command ────</text>
        <box
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.backgroundElement}
        >
          <text fg={theme.text} wrapMode="none" overflow="hidden">
            {commandBlock()}
          </text>
        </box>
      </box>

      {/* copy button */}
      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={buttonBackground(theme, false)}
        border={["left"]}
        borderColor={theme.primary}
        onMouseUp={() => void copyCommand()}
      >
        <text fg={buttonText(theme, false, copied() ? theme.success : theme.primary)}>
          {copied() ? "✓ Copied" : "[c] Copy command"}
        </text>
      </box>

      {/* error section */}
      <Show when={s()?.status === "error" && s()?.error}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>──── Error ────</text>
        <box paddingLeft={1} border={["left"]} borderColor={theme.error}>
          <text fg={theme.error}>{String(s()?.error ?? "")}</text>
        </box>
      </Show>

      {/* metadata */}
      <box gap={1} flexDirection="row">
        <Show when={p().callID}>
          <text fg={theme.textMuted}>Call ID: <span style={{ fg: theme.text }}>{p().callID}</span></text>
        </Show>
        <Show when={duration()}>
          <text fg={theme.textMuted}>· Duration: <span style={{ fg: theme.text }}>{duration()}</span></text>
        </Show>
      </box>

      <box height={1} />
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
        esc close · c copy
      </text>
    </box>
  )
}
