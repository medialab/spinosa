import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { Spinner } from "@spinosa/ui/spinner"
import { useDialog } from "@spinosa/ui/context/dialog"
import { Markdown } from "@spinosa/session-ui/markdown"
import { useLanguage } from "@/context/language"
import { createSignal, Match, Show, Switch } from "solid-js"

const MIN_SCALE = 50
const MAX_SCALE = 200
const SCALE_STEP = 10

export function DialogMarkdownViewer(props: {
  path: string
  busy: () => boolean
  error: () => string | null
  text: () => string | null
  onExport: () => void
  onPrint: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [scale, setScale] = createSignal(100)
  const bump = (delta: number) =>
    setScale((value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value + delta)))

  return (
    <Dialog title={props.path}>
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="flex items-center justify-between gap-2 px-4 py-2">
          <div class="flex items-center gap-1">
            <Button size="small" variant="ghost" onClick={() => bump(-SCALE_STEP)}>
              {language.t("dialog.md.zoomOut")}
            </Button>
            <span class="min-w-12 text-center text-xs opacity-70">{scale()}%</span>
            <Button size="small" variant="ghost" onClick={() => bump(SCALE_STEP)}>
              {language.t("dialog.md.zoomIn")}
            </Button>
          </div>
          <div class="flex items-center gap-1">
            <Button size="small" variant="ghost" disabled={!props.text()} onClick={() => props.onExport()}>
              {language.t("dialog.md.export")}
            </Button>
            <Button size="small" variant="ghost" disabled={!props.text()} onClick={() => props.onPrint()}>
              {language.t("dialog.md.print")}
            </Button>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto border-y border-black/10 px-6 py-4 dark:border-white/10">
          <Switch>
            <Match when={props.busy()}>
              <div class="flex items-center gap-2 text-sm opacity-70">
                <Spinner />
                {language.t("dialog.md.loading")}
              </div>
            </Match>
            <Match when={props.error()}>
              <div class="text-sm text-red-500">{props.error()}</div>
            </Match>
            <Match when={props.text()}>
              {(text) => (
                <div style={{ "font-size": `${scale()}%` }}>
                  <Markdown text={text()} />
                </div>
              )}
            </Match>
          </Switch>
        </div>
        <div class="flex items-center justify-between px-4 py-2">
          <span class="text-xs opacity-60">{language.t("dialog.md.hint")}</span>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function isMarkdownPath(path: string): boolean {
  return /\.markdown?$/i.test(path.trim())
}
