import { Button } from "@spinosa/ui/button"
import { List } from "@spinosa/ui/list"
import { Dialog } from "@spinosa/ui/dialog"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { Show } from "solid-js"

export interface SkillPickerItem {
  name: string
  description?: string
}

export function DialogSkillPicker(props: {
  load: () => Promise<SkillPickerItem[]>
  onPick: (name: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog title={language.t("dialog.skills.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ autofocus: true }}
        key={(x: SkillPickerItem) => x.name}
        items={props.load}
        filterKeys={["name", "description"]}
        onSelect={(x) => {
          if (!x) return
          props.onPick(x.name)
          dialog.close()
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <div class="flex-1 min-w-0 text-left">
              <div class="truncate font-normal">/{item.name}</div>
              <Show when={item.description}>
                <div class="truncate text-xs opacity-60">{item.description}</div>
              </Show>
            </div>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                props.onPick(item.name)
                dialog.close()
              }}
            >
              {language.t("dialog.skills.insert")}
            </Button>
          </div>
        )}
      </List>
    </Dialog>
  )
}
