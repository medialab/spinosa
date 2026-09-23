import { Dialog } from "@spinosa/ui/dialog"
import { Button } from "@spinosa/ui/button"
import { List } from "@spinosa/ui/list"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"

export interface StashedPrompt {
  id: string
  text: string
}

export function DialogPromptStash(props: {
  items: StashedPrompt[]
  onRestore: (id: string) => void
  onDelete: (id: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const stop = (e: Event) => e.stopPropagation()

  return (
    <Dialog title={language.t("dialog.stash.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ autofocus: true }}
        key={(x) => x.id}
        items={props.items}
        filterKeys={["text"]}
        onSelect={(x) => {
          if (!x) return
          props.onRestore(x.id)
          dialog.close()
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
            <div class="flex shrink-0 gap-1" onClick={stop}>
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  props.onRestore(item.id)
                  dialog.close()
                }}
              >
                {language.t("dialog.stash.restore")}
              </Button>
              <Button size="small" variant="ghost" onClick={() => props.onDelete(item.id)}>
                {language.t("common.delete")}
              </Button>
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
