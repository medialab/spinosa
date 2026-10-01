import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { List } from "@spinosa/ui/list"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { createSignal } from "solid-js"

export interface SavedPermissionItem {
  id: string
  projectID: string
  action: string
  resource: string
}

export function DialogSavedPermissions(props: {
  load: () => Promise<SavedPermissionItem[]>
  busy: () => boolean
  onRemove: (id: string) => Promise<void>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [nonce, setNonce] = createSignal(0)

  const stop = (e: Event) => e.stopPropagation()

  return (
    <Dialog title={language.t("dialog.permissions.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ autofocus: true }}
        key={(x: SavedPermissionItem) => x.id}
        items={() => {
          nonce()
          return props.load()
        }}
        filterKeys={["action", "resource", "projectID"]}
        onSelect={(x) => {
          if (!x || props.busy()) return
          void props.onRemove(x.id).finally(() => setNonce((v) => v + 1))
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <div class="flex-1 min-w-0 text-left">
              <div class="truncate font-normal">
                {item.action} · {item.resource}
              </div>
              <div class="truncate text-xs opacity-60">{item.projectID}</div>
            </div>
            <div class="flex shrink-0 gap-1" onClick={stop}>
              <Button
                size="small"
                variant="ghost"
                disabled={props.busy()}
                onClick={() => void props.onRemove(item.id).finally(() => setNonce((v) => v + 1))}
              >
                {language.t("common.remove")}
              </Button>
            </div>
          </div>
        )}
      </List>
      <div class="flex justify-end px-4 py-2">
        <Button variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
      </div>
    </Dialog>
  )
}
