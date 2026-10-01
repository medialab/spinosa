import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { List } from "@spinosa/ui/list"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { createSignal } from "solid-js"

export interface SessionChildItem {
  id: string
  title: string
}

export function DialogSessionChildren(props: {
  load: () => Promise<SessionChildItem[]>
  busy: () => boolean
  onOpen: (sessionID: string) => void
  onAbort: (sessionID: string) => Promise<void>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [nonce, setNonce] = createSignal(0)

  const stop = (e: Event) => e.stopPropagation()

  return (
    <Dialog title={language.t("dialog.children.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ autofocus: true }}
        key={(x: SessionChildItem) => x.id}
        items={() => {
          nonce()
          return props.load()
        }}
        filterKeys={["title", "id"]}
        onSelect={(x) => {
          if (!x) return
          props.onOpen(x.id)
          dialog.close()
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <div class="flex-1 min-w-0 text-left">
              <div class="truncate font-normal">{item.title || item.id}</div>
              <div class="truncate text-xs opacity-60">{item.id}</div>
            </div>
            <div class="flex shrink-0 gap-1" onClick={stop}>
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  props.onOpen(item.id)
                  dialog.close()
                }}
              >
                {language.t("dialog.children.open")}
              </Button>
              <Button
                size="small"
                variant="ghost"
                disabled={props.busy()}
                onClick={() => void props.onAbort(item.id).finally(() => setNonce((v) => v + 1))}
              >
                {language.t("dialog.children.abort")}
              </Button>
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
