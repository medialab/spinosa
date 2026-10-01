import { Button } from "@spinosa/ui/button"
import { Checkbox } from "@spinosa/ui/checkbox"
import { Dialog } from "@spinosa/ui/dialog"
import { TextField } from "@spinosa/ui/text-field"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { createSignal, Show } from "solid-js"

export function DialogMoveSession(props: {
  currentDirectory: string
  busy: () => boolean
  error: () => string | null
  onMove: (destination: string, moveChanges: boolean) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [destination, setDestination] = createSignal(props.currentDirectory)
  const [moveChanges, setMoveChanges] = createSignal(false)

  const submit = () => {
    const dest = destination().trim()
    if (!dest || props.busy()) return
    props.onMove(dest, moveChanges())
  }

  return (
    <Dialog title={language.t("dialog.move.title")}>
      <form
        class="flex flex-col gap-3 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <TextField
          label={language.t("dialog.move.destination.label")}
          value={destination()}
          onChange={(value) => setDestination(value)}
          placeholder={language.t("dialog.move.destination.placeholder")}
        />
        <Checkbox checked={moveChanges()} onChange={setMoveChanges}>
          {language.t("dialog.move.changes")}
        </Checkbox>
        <Show when={props.error()}>
          <div class="text-sm text-red-500">{props.error()}</div>
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={props.busy() || !destination().trim()}>
            {language.t("dialog.move.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
