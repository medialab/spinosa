import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { Locale } from "../util/locale"
import { useBindings } from "../keymap"
import { buttonBackground, buttonText } from "../util/button"
import { HoverLabel } from "./hover-press"

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  label?: string
  confirmLabel?: string
  defaultChoice?: "confirm" | "cancel"
}

export type DialogConfirmShowOptions = {
  cancelLabel?: string
  confirmLabel?: string
  defaultChoice?: "confirm" | "cancel"
}

export type DialogConfirmResult = boolean | undefined

export function DialogConfirm(props: DialogConfirmProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    active: (props.defaultChoice ?? "confirm") as "confirm" | "cancel",
  })

  useBindings(() => ({
    bindings: [
      {
        key: "return",
        desc: "Confirm dialog selection",
        group: "Dialog",
        cmd: () => {
          if (store.active === "confirm") props.onConfirm?.()
          if (store.active === "cancel") props.onCancel?.()
          dialog.clear()
        },
      },
      {
        key: "left",
        desc: "Previous dialog option",
        group: "Dialog",
        cmd: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm")
        },
      },
      {
        key: "right",
        desc: "Next dialog option",
        group: "Dialog",
        cmd: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm")
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
        <HoverLabel
          onPress={() => {
            props.onCancel?.()
            dialog.clear()
          }}
        >
          esc
        </HoverLabel>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1} gap={2}>
        <For each={["cancel", "confirm"] as const}>
          {(key) => {
            const active = () => key === store.active
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={buttonBackground(theme, active())}
                onMouseOver={() => setStore("active", key)}
                onMouseUp={() => {
                  if (key === "confirm") props.onConfirm?.()
                  if (key === "cancel") props.onCancel?.()
                  dialog.clear()
                }}
              >
                <text fg={buttonText(theme, active())}>
                  {Locale.titlecase(key === "cancel" ? (props.label ?? key) : (props.confirmLabel ?? key))}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}

DialogConfirm.show = (
  dialog: DialogContext,
  title: string,
  message: string,
  labelOrOptions?: string | DialogConfirmShowOptions,
) => {
  const options = typeof labelOrOptions === "string"
    ? { cancelLabel: labelOrOptions }
    : labelOrOptions
  return new Promise<DialogConfirmResult>((resolve) => {
    let settled = false
    const settle = (value: DialogConfirmResult) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    dialog.replace(
      () => (
        <DialogConfirm
          title={title}
          message={message}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
          label={options?.cancelLabel}
          confirmLabel={options?.confirmLabel}
          defaultChoice={options?.defaultChoice}
        />
      ),
      () => settle(undefined),
      () => {
        settle(false)
        dialog.dismiss()
      },
    )
  })
}
