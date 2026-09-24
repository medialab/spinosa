import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { Show } from "solid-js"

export function DialogConfirm(props: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: () => boolean
  onConfirm: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog title={props.title}>
      <div class="flex flex-col gap-4 px-4 py-3">
        <p class="text-sm opacity-80">{props.message}</p>
        <Show when={props.busy?.()}>
          <div class="text-sm opacity-60">{language.t("common.loading")}</div>
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {props.cancelLabel ?? language.t("common.cancel")}
          </Button>
          <Button
            variant={props.danger === false ? "primary" : "secondary"}
            disabled={props.busy?.()}
            onClick={() => {
              props.onConfirm()
              dialog.close()
            }}
          >
            {props.confirmLabel ?? language.t("common.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
