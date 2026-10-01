import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { Spinner } from "@spinosa/ui/spinner"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { createSignal, For, Show } from "solid-js"

export interface VcsFileItem {
  file: string
  additions: number
  deletions: number
  status: string
}

export function DialogVcs(props: {
  busy: () => boolean
  files: () => VcsFileItem[] | null
  unavailable: () => string | null
  error: () => string | null
  onApply: (patch: string) => void
  onDownloadDiff: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [patch, setPatch] = createSignal("")

  return (
    <Dialog title={language.t("dialog.vcs.title")}>
      <div class="flex flex-col gap-3 px-4 py-3 overflow-y-auto">
        <Show when={props.busy()}>
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner />
            {language.t("dialog.vcs.working")}
          </div>
        </Show>
        <Show when={props.unavailable()}>
          <div class="text-sm opacity-70">{props.unavailable()}</div>
        </Show>
        <Show when={props.files()}>
          {(list) => (
            <div class="flex flex-col">
              <div class="text-xs uppercase opacity-60">{language.t("dialog.vcs.changes")}</div>
              <For each={list()}>
                {(f) => (
                  <div class="flex items-baseline justify-between gap-2 py-1 text-sm">
                    <span class="truncate font-mono text-xs">{f.file}</span>
                    <span class="shrink-0 text-xs opacity-70">
                      {f.status} +{f.additions}/-{f.deletions}
                    </span>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
        <Show when={(props.files()?.length ?? 0) > 0}>
          <Button variant="secondary" disabled={props.busy()} onClick={() => props.onDownloadDiff()}>
            {language.t("dialog.vcs.download")}
          </Button>
        </Show>
        <div class="text-xs uppercase opacity-60">{language.t("dialog.vcs.apply.label")}</div>
        <textarea
          class="min-h-28 w-full rounded border border-black/10 bg-transparent p-2 font-mono text-xs dark:border-white/10"
          value={patch()}
          onInput={(e) => setPatch(e.currentTarget.value)}
          placeholder={language.t("dialog.vcs.apply.placeholder")}
        />
        <Show when={props.error()}>
          <div class="text-sm text-red-500">{props.error()}</div>
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
          <Button disabled={props.busy() || !patch().trim()} onClick={() => props.onApply(patch())}>
            {language.t("dialog.vcs.apply.submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
