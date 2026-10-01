import { Dialog } from "@spinosa/ui/dialog"
import { Button } from "@spinosa/ui/button"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"

export function DialogMessageActions(props: {
  canRevert: boolean
  onRevert: () => void
  onCopy: () => void
  onFork: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const run = (fn: () => void) => () => {
    fn()
    dialog.close()
  }

  return (
    <Dialog title={language.t("dialog.message.actions.title")}>
      <div class="flex flex-col gap-1 px-3 pb-4">
        <Button variant="ghost" class="justify-start" disabled={!props.canRevert} onClick={run(props.onRevert)}>
          {language.t("dialog.message.actions.revert")}
        </Button>
        <Button variant="ghost" class="justify-start" onClick={run(props.onCopy)}>
          {language.t("dialog.message.actions.copy")}
        </Button>
        <Button variant="ghost" class="justify-start" onClick={run(props.onFork)}>
          {language.t("dialog.message.actions.fork")}
        </Button>
      </div>
    </Dialog>
  )
}
