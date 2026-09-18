import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useClipboard } from "../context/clipboard"
import { useSpinosaWorkspace } from "../context/spinosa-workspace"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogSpinosaSettings } from "./dialog-spinosa-settings"
import { DialogSessionList } from "./dialog-session-list"
import { DialogModel } from "./dialog-model"
import { DialogProvider } from "./dialog-provider"
import { MAIN_CONTENT_MAX_WIDTH } from "../util/layout"
import { deleteWorkspace } from "../spinosa/service"
import {
  BUG_REPORT_CONFIRM_MESSAGE,
  BUG_REPORT_CONFIRM_TITLE,
  reportBugFromTui,
} from "../spinosa/bug-report"
import open from "open"

export function HomeFooter() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const clipboard = useClipboard()
  const spinosa = useSpinosaWorkspace()
  const [hovered, setHovered] = createSignal<string | undefined>()
  const [deleting, setDeleting] = createSignal(false)

  const reportBug = () => {
    void reportBugFromTui({
      confirm: () =>
        DialogConfirm.show(dialog, BUG_REPORT_CONFIRM_TITLE, BUG_REPORT_CONFIRM_MESSAGE, {
          confirmLabel: "Open GitHub",
          cancelLabel: "Cancel",
          defaultChoice: "cancel",
        }),
      showToast: toast.show,
      writeClipboard: clipboard.write,
      openUrl: (href) => open(href),
    })
  }

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

  type Shortcut = { id: string; label: string; action: () => void; danger?: boolean }
  const buttons = createMemo<Shortcut[]>(() => {
    const items: Shortcut[] = [
      { id: "S", label: "Settings", action: () => dialog.replace(() => <DialogSpinosaSettings />) },
      { id: "P", label: "Provider", action: () => dialog.replace(() => <DialogProvider />) },
      { id: "M", label: "Models", action: () => dialog.replace(() => <DialogModel />) },
      { id: "B", label: "Report bug", action: reportBug },
    ]
    if (!spinosa.genericMode) {
      items.splice(2, 0, {
        id: "K",
        label: "Sessions",
        action: () => dialog.replace(() => <DialogSessionList />),
      })
    }
    if (spinosa.activePath && !spinosa.genericMode) {
      items.push({
        id: "D",
        label: deleting() ? "Deleting…" : "Delete workspace",
        action: () => void deleteActiveWorkspace(),
        danger: true,
      })
    }
    return items
  })

  // Workspace home is mouse-only: no keyboard shortcuts here (the prompt
  // writing box owns the keyboard). Footer actions are mouse-only
  // everywhere; in chat use /commands.
  const isHomePicker = createMemo(() => !spinosa.activePath || spinosa.genericMode)

  // Chat keeps the prompt's keyboard: footer buttons stay mouse-only there.
  // Rendered so Settings/Models stay one click away even with text in the
  // prompt box. The "/" command menu may open mid-text, but only a
  // line-start command executes on submit.
  const chatButtons = createMemo<Shortcut[]>(() => [
    { id: "S", label: "Settings", action: () => dialog.replace(() => <DialogSpinosaSettings />) },
    { id: "M", label: "Models", action: () => dialog.replace(() => <DialogModel />) },
    { id: "B", label: "Report bug", action: reportBug },
  ])

  const renderButton = (item: Shortcut) => (
    <box
      paddingX={1}
      onMouseOver={() => {
        setHovered(item.id)
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
