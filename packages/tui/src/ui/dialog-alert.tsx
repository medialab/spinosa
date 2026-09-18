import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { useBindings } from "../keymap"
import { HoverChip, HoverLabel } from "./hover-press"

export type DialogAlertProps = {
  title: string
  message: string
  onConfirm?: () => void
}

export function DialogAlert(props: DialogAlertProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  useBindings(() => ({
    bindings: [
      {
        key: "return",
        desc: "Confirm alert",
        group: "Dialog",
        cmd: () => {
          props.onConfirm?.()
          dialog.clear()
        },
      },
    ],
  }))
  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <HoverLabel onPress={() => dialog.clear()}>esc</HoverLabel>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <HoverChip
          paddingLeft={3}
          paddingRight={3}
          label="ok"
          onPress={() => {
            props.onConfirm?.()
            dialog.clear()
          }}
        />
      </box>
    </box>
  )
}

DialogAlert.show = (dialog: DialogContext, title: string, message: string) => {
  return new Promise<void>((resolve) => {
    dialog.replace(
      () => <DialogAlert title={title} message={message} onConfirm={() => resolve()} />,
      () => resolve(),
    )
  })
}
