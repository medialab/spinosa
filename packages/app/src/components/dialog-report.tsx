import { createSignal } from "solid-js"
import { Dialog } from "@spinosa/ui/dialog"
import { Button } from "@spinosa/ui/button"
import { useLanguage } from "@/context/language"

export function DialogReport(props: { issueUrl: string; onExportLogs?: () => Promise<string> }) {
  const language = useLanguage()
  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const text = props.onExportLogs ? await props.onExportLogs().catch(() => "") : ""
    if (!text) return
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog title={language.t("dialog.report.title")}>
      <div class="flex flex-col gap-4 px-6 pb-6">
        <p class="text-14-regular text-text-base">{language.t("dialog.report.steps")}</p>
        <div class="flex items-center gap-2">
          <Button variant="secondary" onClick={handleCopy}>
            {copied() ? language.t("dialog.report.copied") : language.t("dialog.report.copy")}
          </Button>
          <Button variant="primary" as="a" href={props.issueUrl} target="_blank" rel="noreferrer">
            {language.t("dialog.report.open")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
