import { Dialog } from "@spinosa/ui/dialog"
import { Button } from "@spinosa/ui/button"
import { List } from "@spinosa/ui/list"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"

export interface QueuedPrompt {
  id: string
  text: string
}

export function DialogQueuedPrompts(props: {
  items: QueuedPrompt[]
  onSteer: (id: string) => void
  onRemove: (id: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const stop = (e: Event) => e.stopPropagation()

  return (
    <Dialog title={language.t("dialog.queued.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ autofocus: true }}
        key={(x) => x.id}
        items={props.items}
        filterKeys={["text"]}
        onSelect={(x) => {
          if (!x) return
          props.onSteer(x.id)
          dialog.close()
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span
              id={`queued-prompt-${item.id}`}
              class="line-clamp-2 min-w-0 flex-1 break-words text-left font-normal"
              title={item.text}
            >
              {item.text}
            </span>
            <div class="flex shrink-0 gap-1" onClick={stop}>
              <Button
                size="small"
                variant="ghost"
                aria-describedby={`queued-prompt-${item.id}`}
                onClick={() => {
                  props.onSteer(item.id)
                  dialog.close()
                }}
              >
                {language.t("dialog.queued.steer")}
              </Button>
              <Button
                size="small"
                variant="ghost"
                aria-describedby={`queued-prompt-${item.id}`}
                onClick={() => props.onRemove(item.id)}
              >
                {language.t("common.remove")}
              </Button>
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
