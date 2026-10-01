import { For } from "solid-js"
import { Dialog } from "@spinosa/ui/dialog"
import { useLanguage } from "@/context/language"

// Keyboard legends are intentionally hardcoded (not translated).
const rows: Array<[string, string]> = [
  ["Cmd+K", "Command palette"],
  ["Mod+P", "Open files"],
  ["Mod+Shift+S", "New session"],
  ["Mod+Alt+[ / ]", "Navigate messages"],
  ["Mod+'", "Switch model"],
  ["Mod+.", "Switch agent"],
  ["Ctrl+`", "Toggle terminal"],
  ["Esc", "Interrupt"],
]

export function DialogHelp() {
  const language = useLanguage()

  return (
    <Dialog title={language.t("dialog.help.title")}>
      <div class="flex flex-col px-6 pb-6">
        <For each={rows}>
          {([keys, label]) => (
            <div class="flex items-center justify-between gap-3 py-1.5">
              <span class="text-14-regular text-text-base">{label}</span>
              <kbd class="text-12-regular text-text-weak font-mono shrink-0">{keys}</kbd>
            </div>
          )}
        </For>
      </div>
    </Dialog>
  )
}
