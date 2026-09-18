import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For } from "solid-js"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useSpinosaWorkspace } from "../context/spinosa-workspace"
import { buildStartupChatPrompt } from "@spinosa/core/commands/startup"
import { useDialog } from "../ui/dialog"
import { useBindings } from "../keymap"
import { buttonBackground, buttonBorder, buttonText } from "../util/button"
import { HoverLabel } from "../ui/hover-press"
import { ORCHESTRATOR_AGENT_ID } from "../util/agent"

export function DialogSpinosaStartupChoice(props: {
  workspacePath: string
  workspaceName: string
  prompt: string
  onBack?: () => void
}) {
  const { theme } = useTheme()
  const local = useLocal()
  const spinosa = useSpinosaWorkspace()
  const dialog = useDialog()
  const [selected, setSelected] = createSignal(0)

  const launchStartupInChat = () => {
    // Clear the dialog first so Enter feels immediate; openWorkspace can take
    // a beat for registry/meta I/O.
    dialog.clear()
    local.agent.set(ORCHESTRATOR_AGENT_ID)
    spinosa.queuePrompt(buildStartupChatPrompt(props.prompt), props.workspacePath)
    void spinosa.openWorkspace(props.workspacePath, { route: { type: "global" } })
  }

  const openChatDirectly = () => {
    dialog.clear()
    void spinosa.openWorkspace(props.workspacePath, { route: { type: "global" } })
  }

  const options = createMemo(() => [
    {
      title: "Open setup brief in Chat",
      description: "Review or edit the setup brief, then press Enter to run it.",
      primary: true,
      run: () => void launchStartupInChat(),
    },
    {
      title: "Open workspace",
      description: "Skip the setup brief for now and start a regular chat.",
      primary: false,
      run: () => void openChatDirectly(),
    },
  ] as const)

  const move = (offset: number) => {
    const count = options().length
    setSelected((value) => (value + offset + count) % count)
  }

  const confirm = () => {
    const option = options()[selected()]
    if (!option) return
    option.run()
  }

  const back = () => props.onBack ? props.onBack() : dialog.clear()

  useBindings(() => ({
    bindings: [
      { key: "up", desc: "Previous startup option", group: "Dialog", cmd: () => move(-1) },
      { key: "down", desc: "Next startup option", group: "Dialog", cmd: () => move(1) },
      { key: "left", desc: "Previous startup option", group: "Dialog", cmd: () => move(-1) },
      { key: "right", desc: "Next startup option", group: "Dialog", cmd: () => move(1) },
      { key: "tab", desc: "Next startup option", group: "Dialog", cmd: () => move(1) },
      { key: "shift+tab", desc: "Previous startup option", group: "Dialog", cmd: () => move(-1) },
      { key: "return", desc: "Confirm startup option", group: "Dialog", cmd: () => confirm() },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.workspaceName}
        </text>
        <HoverLabel onPress={back}>esc</HoverLabel>
      </box>
      <text fg={theme.textMuted}>
        Startup the workspace with prompt, or open workspace chat without it.
      </text>
      <box height={1} />
      <For each={options()}>
        {(option, index) => {
          const active = () => selected() === index()
          return (
            <box
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={buttonBackground(theme, active())}
              border={["left"]}
              borderColor={buttonBorder(theme, active(), option.primary ? theme.primary : theme.borderActive)}
              onMouseOver={() => setSelected(index())}
              onMouseDown={() => {
                setSelected(index())
                option.run()
              }}
            >
              <text fg={buttonText(theme, active(), option.primary ? theme.primary : theme.text)}>
                <span style={{ bold: active() }}>{option.title}</span>
              </text>
              <text fg={buttonText(theme, active(), theme.textMuted)}>{option.description}</text>
            </box>
          )
        }}
      </For>
      <box height={1} />
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
        ↑↓ move · enter select · esc close
      </text>
    </box>
  )
}
