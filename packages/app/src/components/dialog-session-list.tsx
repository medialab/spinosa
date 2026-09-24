import { Dialog } from "@spinosa/ui/dialog"
import { Button } from "@spinosa/ui/button"
import { List } from "@spinosa/ui/list"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { Show } from "solid-js"

export interface SessionListEntry {
  id: string
  title: string
}

export function DialogSessionList(props: {
  sessions: SessionListEntry[]
  currentID?: string
  onSelect: (id: string) => void
  onRename?: (id: string) => void
  onDelete?: (id: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const stop = (e: Event) => e.stopPropagation()

  return (
    <Dialog title={language.t("dialog.session.list.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("dialog.session.list.search"), autofocus: true }}
        key={(x) => x.id}
        items={props.sessions}
        filterKeys={["title"]}
        onSelect={(x) => {
          if (!x) return
          props.onSelect(x.id)
          dialog.close()
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="truncate flex-1 min-w-0 text-left font-normal">
              {item.title}
              {item.id === props.currentID ? " •" : ""}
            </span>
            <div class="flex shrink-0 gap-1" onClick={stop}>
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  props.onSelect(item.id)
                  dialog.close()
                }}
              >
                {language.t("common.switch")}
              </Button>
              <Show when={props.onRename}>
                <Button size="small" variant="ghost" onClick={() => props.onRename?.(item.id)}>
                  {language.t("common.rename")}
                </Button>
              </Show>
              <Show when={props.onDelete}>
                <Button size="small" variant="ghost" onClick={() => props.onDelete?.(item.id)}>
                  {language.t("common.delete")}
                </Button>
              </Show>
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
