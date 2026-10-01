import { createSignal } from "solid-js"
import { Dialog } from "@spinosa/ui/dialog"
import { Button } from "@spinosa/ui/button"
import { Checkbox } from "@spinosa/ui/checkbox"
import { RadioGroup } from "@spinosa/ui/radio-group"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"

export type SessionExportFormat = "json" | "markdown" | "text"

const formats: SessionExportFormat[] = ["json", "markdown", "text"]

export function DialogExportOptions(props: {
  onExport: (format: SessionExportFormat, includeThinking: boolean) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [format, setFormat] = createSignal<SessionExportFormat>("markdown")
  const [thinking, setThinking] = createSignal(false)

  const submit = () => {
    props.onExport(format(), thinking())
    dialog.close()
  }

  return (
    <Dialog title={language.t("dialog.export.title")}>
      <div class="flex flex-col gap-4 px-6 pb-6">
        <div class="flex flex-col gap-2">
          <span class="text-12-medium text-text-weak">{language.t("dialog.export.format")}</span>
          <RadioGroup options={formats} current={format()} onSelect={(v) => v && setFormat(v)} />
        </div>
        <Checkbox checked={thinking()} onChange={setThinking}>
          {language.t("dialog.export.thinking")}
        </Checkbox>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit}>
            {language.t("dialog.export.export")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
