import { Dialog } from "@spinosa/ui/dialog"
import { useLanguage } from "@/context/language"

export interface DialogStatusInfo {
  session?: { title?: string; id?: string }
  model?: { providerID: string; id: string } | null
  agent?: string | null
  connected: string[]
  formatters?: { name: string; enabled: boolean }[]
}

export function DialogStatus(props: { info: DialogStatusInfo }) {
  const language = useLanguage()

  const rows = () => [
    { label: language.t("dialog.status.row.session"), value: props.info.session?.title ?? props.info.session?.id },
    {
      label: language.t("dialog.status.row.model"),
      value: props.info.model ? `${props.info.model.providerID}/${props.info.model.id}` : undefined,
    },
    { label: language.t("dialog.status.row.agent"), value: props.info.agent ?? undefined },
    {
      label: language.t("dialog.status.row.providers"),
      value: props.info.connected.length > 0 ? props.info.connected.join(", ") : undefined,
    },
  ]

  return (
    <Dialog title={language.t("dialog.status.title")}>
      <div class="flex flex-col px-6 pb-6">
        {rows().map((row) => (
          <div class="flex items-baseline justify-between gap-3 py-1.5">
            <span class="text-12-medium text-text-weak shrink-0">{row.label}</span>
            <span class="text-14-regular text-text-base truncate text-right">{row.value ?? "—"}</span>
          </div>
        ))}
        {props.info.formatters && props.info.formatters.length > 0 && (
          <div class="flex items-baseline justify-between gap-3 py-1.5">
            <span class="text-12-medium text-text-weak shrink-0">{language.t("dialog.status.row.formatters")}</span>
            <span class="text-14-regular text-text-base truncate text-right">
              {props.info.formatters.map((item) => `${item.name}${item.enabled ? "" : " (off)"}`).join(", ")}
            </span>
          </div>
        )}
      </div>
    </Dialog>
  )
}
