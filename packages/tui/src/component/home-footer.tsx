import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useSpinosaWorkspace } from "../context/spinosa-workspace"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogSpinosaSettings } from "./dialog-spinosa-settings"
import { DialogSessionList } from "./dialog-session-list"
import { DialogModel } from "./dialog-model"
import { DialogProvider } from "./dialog-provider"
import { MAIN_CONTENT_MAX_WIDTH } from "../util/layout"
import { deleteWorkspace } from "../spinosa/service"
import { SPINOSA_BASE_MODE, useBindings } from "../keymap"
import { usePromptRef } from "../context/prompt"

export function HomeFooter() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const spinosa = useSpinosaWorkspace()
  const promptRef = usePromptRef()
  const [hovered, setHovered] = createSignal<string | undefined>()
  const [deleting, setDeleting] = createSignal(false)

  const deleteActiveWorkspace = async () => {
    const workspacePath = spinosa.activePath
    if (!workspacePath || spinosa.genericMode || deleting()) return

    const confirmed = await DialogConfirm.show(
      dialog,
      "Delete workspace",
      "Do you really want to delete this workspace? The folder moves to Trash.",
      {
        confirmLabel: "Yes, delete",
        cancelLabel: "No, keep it",
        defaultChoice: "cancel",
      },
    )
    if (!confirmed) return

    setDeleting(true)
    try {
      await deleteWorkspace(workspacePath)
      spinosa.useGenericMode()
      spinosa.showPicker()
      toast.show({ variant: "success", message: "Workspace moved to Trash." })
    } catch (error) {
      toast.show({
        variant: "error",
        message: error instanceof Error ? error.message : "Couldn’t delete this workspace.",
      })
    } finally {
      setDeleting(false)
    }
  }

  type Shortcut = { id: string; key: string; label: string; action: () => void; danger?: boolean }
  const buttons = createMemo<Shortcut[]>(() => {
    const items: Shortcut[] = [
      { id: "S", key: "shift+s", label: "Settings", action: () => dialog.replace(() => <DialogSpinosaSettings />) },
      { id: "P", key: "shift+p", label: "Provider", action: () => dialog.replace(() => <DialogProvider />) },
      { id: "M", key: "shift+m", label: "Models", action: () => dialog.replace(() => <DialogModel />) },
    ]
    if (!spinosa.genericMode) {
      items.splice(2, 0, {
        id: "K",
        key: "shift+k",
        label: "Sessions",
        action: () => dialog.replace(() => <DialogSessionList />),
      })
    }
    if (spinosa.activePath && !spinosa.genericMode) {
      items.push({
        id: "D",
        key: "shift+d",
        label: deleting() ? "Deleting…" : "Delete workspace",
        action: () => void deleteActiveWorkspace(),
        danger: true,
      })
    }
    return items
  })

  // Shortcuts only on Home picker (no active workspace). In chat the prompt is focused
  // and typing "s" should insert "s" — user will use "/command" or mouse. Keep footer
  // as plain hint in workspace to avoid shortcut confusion.
  const isHomePicker = createMemo(() => !spinosa.activePath || spinosa.genericMode)
  const [footerSelected, setFooterSelected] = createSignal(0)

  const moveFooter = (offset: number) => {
    const len = buttons().length
    if (len === 0) return
    setFooterSelected((v) => {
      const clamped = Math.min(v, Math.max(0, len - 1))
      const next = (clamped + offset + len) % len
      setHovered(buttons()[next]?.id)
      return next
    })
  }

  useBindings(() => ({
    mode: SPINOSA_BASE_MODE,
    enabled: () => isHomePicker() && !promptRef.current?.focused && dialog.stack.length === 0,
    bindings: [
      ...buttons().map((item) => ({
        key: item.key,
        desc: item.label,
        group: "Home",
        cmd: () => item.action(),
      })),
      { key: "left", desc: "Previous footer action", group: "Home", cmd: () => moveFooter(-1) },
      { key: "right", desc: "Next footer action", group: "Home", cmd: () => moveFooter(1) },
      { key: "tab", desc: "Next footer action", group: "Home", cmd: () => moveFooter(1) },
      {
        key: "shift+tab",
        desc: "Previous footer action",
        group: "Home",
        cmd: () => moveFooter(-1),
      },
    ],
  }))

  // Footer Enter is intentionally not bound — recent list's Enter takes precedence
  // when both are visible. Footer actions are mouse-only on Home; in chat use /commands.

  // Workspace chat keeps the prompt's keyboard, so footer buttons are
  // mouse-only there (no shortcuts registered). Rendered so Settings/Models
  // stay one click away even with text in the prompt box — where `/model`
  // mid-text intentionally does not trigger slash commands.
  const chatButtons = createMemo<Shortcut[]>(() => [
    { id: "S", key: "shift+s", label: "Settings", action: () => dialog.replace(() => <DialogSpinosaSettings />) },
    { id: "M", key: "shift+m", label: "Models", action: () => dialog.replace(() => <DialogModel />) },
  ])

  const renderButton = (item: Shortcut) => (
    <box
      paddingX={1}
      onMouseOver={() => {
        setHovered(item.id)
        const idx = buttons().findIndex((b) => b.id === item.id)
        if (idx >= 0) setFooterSelected(idx)
      }}
      onMouseOut={() => setHovered(undefined)}
      onMouseUp={item.action}
    >
      <text
        fg={
          hovered() === item.id
            ? (item.danger ? theme.error : theme.text)
            : (item.danger ? theme.error : theme.textMuted)
        }
        attributes={hovered() === item.id ? TextAttributes.BOLD : undefined}
      >
        {item.label}
      </text>
    </box>
  )

  return (
    <box width="100%" maxWidth={MAIN_CONTENT_MAX_WIDTH} flexDirection="row" justifyContent="center" gap={0}>
      <Show
        when={isHomePicker()}
        fallback={
          <box flexDirection="row" alignItems="center">
            <For each={chatButtons()}>
              {(item, i) => (
                <>
                  <Show when={i() > 0}>
                    <text fg={theme.textMuted}>{" · "}</text>
                  </Show>
                  {renderButton(item)}
                </>
              )}
            </For>
            <text fg={theme.textMuted}>{" · "}Type / for commands · tab agents · ctrl+p palette</text>
          </box>
        }
      >
        <For each={buttons()}>
          {(item, i) => (
            <>
              <Show when={i() > 0}>
                <text fg={theme.textMuted}>{" · "}</text>
              </Show>
              {renderButton(item)}
            </>
          )}
        </For>
      </Show>
    </box>
  )
}
