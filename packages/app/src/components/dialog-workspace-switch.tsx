import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { List } from "@spinosa/ui/list"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { Show } from "solid-js"

export interface WorkspaceSwitchItem {
  worktree: string
  name: string
  detail?: string
}

export function DialogWorkspaceSwitch(props: {
  items: WorkspaceSwitchItem[]
  currentDirectory: string
  onSelect: (worktree: string) => void
  onPickNew: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog title={language.t("dialog.workspaces.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ autofocus: true }}
        key={(x: WorkspaceSwitchItem) => x.worktree}
        items={props.items}
        filterKeys={["name", "worktree"]}
        onSelect={(x) => {
          if (!x) return
          props.onSelect(x.worktree)
          dialog.close()
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <div class="flex-1 min-w-0 text-left">
              <div class="truncate font-normal">
                {item.name}
                <Show when={item.worktree === props.currentDirectory}>
                  <span class="opacity-60"> · {language.t("dialog.workspaces.current")}</span>
                </Show>
              </div>
              <Show when={item.detail}>
                <div class="truncate text-xs opacity-60">{item.detail}</div>
              </Show>
            </div>
          </div>
        )}
      </List>
      <div class="flex justify-between px-4 py-2">
        <Button variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
        <Button variant="secondary" onClick={() => props.onPickNew()}>
          {language.t("dialog.workspaces.new")}
        </Button>
      </div>
    </Dialog>
  )
}
