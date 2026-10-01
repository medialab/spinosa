import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { List } from "@spinosa/ui/list"
import { Spinner } from "@spinosa/ui/spinner"
import { TextField } from "@spinosa/ui/text-field"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { createSignal, For, Match, Show, Switch } from "solid-js"

export type FindKind = "text" | "files" | "symbols"

export interface FindHit {
  id: string
  title: string
  detail?: string
}

export function DialogFind(props: {
  busy: () => boolean
  results: () => FindHit[] | null
  searched: () => boolean
  onSearch: (query: string, kind: FindKind) => void
  onCopy: (hit: FindHit) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [query, setQuery] = createSignal("")
  const [kind, setKind] = createSignal<FindKind>("text")

  const kinds: FindKind[] = ["text", "files", "symbols"]
  const kindLabels: Record<FindKind, string> = {
    text: language.t("dialog.find.kind.text"),
    files: language.t("dialog.find.kind.files"),
    symbols: language.t("dialog.find.kind.symbols"),
  }

  const submit = () => {
    if (!query().trim() || props.busy()) return
    props.onSearch(query().trim(), kind())
  }

  return (
    <Dialog title={language.t("dialog.find.title")}>
      <form
        class="flex flex-col gap-3 px-4 py-3 min-h-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div class="flex gap-1">
          <For each={kinds}>
            {(k) => (
              <Button size="small" variant={kind() === k ? "primary" : "ghost"} onClick={() => setKind(k)}>
                {kindLabels[k]}
              </Button>
            )}
          </For>
        </div>
        <div class="flex gap-2">
          <div class="flex-1">
            <TextField
              value={query()}
              onChange={setQuery}
              placeholder={language.t("dialog.find.query.placeholder")}
            />
          </div>
          <Button type="submit" disabled={props.busy() || !query().trim()}>
            {language.t("dialog.find.search")}
          </Button>
        </div>
        <Show when={props.busy()}>
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner />
            {language.t("dialog.find.working")}
          </div>
        </Show>
        <Switch>
          <Match when={props.results()}>
            {(hits) => (
              <List
                class="flex-1 px-0 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
                key={(x: FindHit) => x.id}
                items={hits()}
                filterKeys={["title", "detail"]}
                onSelect={(x) => {
                  if (!x) return
                  props.onCopy(x)
                }}
              >
                {(item) => (
                  <div class="w-full flex items-center gap-2">
                    <div class="flex-1 min-w-0 text-left">
                      <div class="truncate font-normal">{item.title}</div>
                      <Show when={item.detail}>
                        <div class="truncate text-xs opacity-60">{item.detail}</div>
                      </Show>
                    </div>
                    <Button size="small" variant="ghost" onClick={() => props.onCopy(item)}>
                      {language.t("dialog.find.copy")}
                    </Button>
                  </div>
                )}
              </List>
            )}
          </Match>
          <Match when={props.searched() && !props.busy()}>
            <div class="text-sm opacity-60">{language.t("dialog.find.empty")}</div>
          </Match>
        </Switch>
        <div class="flex justify-end">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
