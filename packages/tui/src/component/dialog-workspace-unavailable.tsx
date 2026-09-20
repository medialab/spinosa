import { TextAttributes } from "@opentui/core"
import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useBindings } from "../keymap"
import { HoverChip, HoverLabel } from "../ui/hover-press"

export function DialogWorkspaceUnavailable(props: { onRestore?: () => boolean | void | Promise<boolean | void> }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    active: "restore" as "cancel" | "restore",
  })

  const options = ["cancel", "restore"] as const

  async function confirm() {
    if (store.active === "cancel") {
      dialog.clear()
      return
    }
    const result = await props.onRestore?.()
    if (result === false) return
  }

  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Confirm workspace option", group: "Dialog", cmd: () => void confirm() },
      { key: "left", desc: "Cancel workspace restore", group: "Dialog", cmd: () => setStore("active", "cancel") },
      { key: "right", desc: "Restore workspace", group: "Dialog", cmd: () => setStore("active", "restore") },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Workspace unavailable
        </text>
        <HoverLabel onPress={() => dialog.clear()}>esc</HoverLabel>
      </box>
      <text fg={theme.textMuted} wrapMode="word">
        This session is attached to a workspace that is no longer available.
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        Would you like to restore this session into a new workspace?
      </text>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1} gap={1}>
        <For each={options}>
          {(item) => (
            <HoverChip
              paddingLeft={2}
              paddingRight={2}
              label={item}
              active={item === store.active}
              onHover={() => setStore("active", item)}
              onPress={() => {
                setStore("active", item)
                void confirm()
              }}
            />
          )}
        </For>
      </box>
    </box>
  )
}
