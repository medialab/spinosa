import { Dialog } from "@spinosa/ui/dialog"
import { List } from "@spinosa/ui/list"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"

interface VariantRow {
  value: string | undefined
  label: string
}

export function DialogVariantPicker(props: {
  variants: string[]
  current?: string | null
  onSelect: (v: string | undefined) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const items = (): VariantRow[] => [
    { value: undefined, label: language.t("dialog.variant.default") },
    ...props.variants.map((v) => ({ value: v as string | undefined, label: v })),
  ]

  return (
    <Dialog title={language.t("dialog.variant.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ autofocus: true }}
        key={(x) => x.label}
        items={items}
        filterKeys={["label"]}
        onSelect={(x) => {
          if (!x) return
          props.onSelect(x.value)
          dialog.close()
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="truncate flex-1 min-w-0 text-left font-normal">{item.label}</span>
            {(item.value ?? null) === (props.current ?? null) && <span aria-hidden="true">✓</span>}
          </div>
        )}
      </List>
    </Dialog>
  )
}
