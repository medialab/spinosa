import { createSignal } from "solid-js"
import { Dialog } from "@spinosa/ui/dialog"
import { Button } from "@spinosa/ui/button"
import { TextField } from "@spinosa/ui/text-field"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"

export function DialogSessionRename(props: { initial: string; onSubmit: (title: string) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const [value, setValue] = createSignal(props.initial)

  const submit = (e: SubmitEvent) => {
    e.preventDefault()
    props.onSubmit(value())
    dialog.close()
  }

  return (
    <Dialog title={language.t("dialog.session.rename.title")}>
      <form onSubmit={submit} class="flex flex-col gap-4 px-6 pb-6">
        <TextField autofocus value={value()} onChange={setValue} />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {language.t("dialog.session.rename.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
