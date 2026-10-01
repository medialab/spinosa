import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { Spinner } from "@spinosa/ui/spinner"
import { TextField } from "@spinosa/ui/text-field"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { createSignal, Match, Show, Switch } from "solid-js"

export function DialogVisionTranscribe(props: {
  defaultProviderID: string
  defaultModelID: string
  busy: () => boolean
  error: () => string | null
  result: () => string | null
  onTranscribe: (file: File, prompt: string, providerID: string, modelID: string) => void
  onInsert: (text: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [prompt, setPrompt] = createSignal("")
  const [providerID, setProviderID] = createSignal(props.defaultProviderID)
  const [modelID, setModelID] = createSignal(props.defaultModelID)
  const [file, setFile] = createSignal<File | null>(null)
  let fileInput: HTMLInputElement | undefined

  const submit = () => {
    const f = file()
    if (!f || props.busy()) return
    props.onTranscribe(f, prompt().trim(), providerID().trim(), modelID().trim())
  }

  return (
    <Dialog title={language.t("dialog.vision.title")}>
      <form
        class="flex flex-col gap-3 px-4 py-3 overflow-y-auto"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div class="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            class="hidden"
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
          />
          <Button variant="secondary" onClick={() => fileInput?.click()}>
            {language.t("dialog.vision.choose")}
          </Button>
          <span class="truncate text-sm opacity-70">{file()?.name ?? language.t("dialog.vision.noFile")}</span>
        </div>
        <TextField
          label={language.t("dialog.vision.prompt.label")}
          value={prompt()}
          onChange={setPrompt}
          placeholder={language.t("dialog.vision.prompt.placeholder")}
        />
        <div class="grid grid-cols-2 gap-2">
          <TextField
            label={language.t("dialog.vision.provider.label")}
            value={providerID()}
            onChange={setProviderID}
          />
          <TextField label={language.t("dialog.vision.model.label")} value={modelID()} onChange={setModelID} />
        </div>
        <Show when={props.error()}>
          <div class="text-sm text-red-500">{props.error()}</div>
        </Show>
        <Show when={props.busy()}>
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner />
            {language.t("dialog.vision.working")}
          </div>
        </Show>
        <Show when={props.result()}>
          {(text) => (
            <pre class="max-h-48 overflow-y-auto rounded bg-black/5 p-2 text-xs whitespace-pre-wrap dark:bg-white/5">
              {text()}
            </pre>
          )}
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Show when={props.result()}>
            {(text) => (
              <Button
                variant="secondary"
                onClick={() => {
                  props.onInsert(text())
                  dialog.close()
                }}
              >
                {language.t("dialog.vision.insert")}
              </Button>
            )}
          </Show>
          <Button type="submit" disabled={props.busy() || !file()}>
            {language.t("dialog.vision.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
