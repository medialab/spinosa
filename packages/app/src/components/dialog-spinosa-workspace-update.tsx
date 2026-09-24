import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import type {
  ExperimentalSpinosaWorkspaceFreshnessResponses,
  ExperimentalSpinosaWorkspaceUpdateResponses,
} from "@spinosa/sdk/v2/client"
import { useDialog } from "@spinosa/ui/context/dialog"
import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"

type Freshness = ExperimentalSpinosaWorkspaceFreshnessResponses[200]
type WorkspaceUpdate = ExperimentalSpinosaWorkspaceUpdateResponses[200]

export function DialogSpinosaWorkspaceUpdate(props: { workspacePath: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [state, setState] = createStore({
    freshness: undefined as Freshness | undefined,
    result: undefined as WorkspaceUpdate | undefined,
    loading: true,
    updating: false,
    error: "",
  })
  const workspaceClient = () => serverSDK().ensureDirSdkContext(props.workspacePath).client.experimental.spinosa.workspace

  async function refresh() {
    setState({ loading: true, error: "" })
    try {
      const response = await workspaceClient().freshness({ directory: props.workspacePath })
      if (!response.data) throw new Error(language.t("common.requestFailed"))
      setState({ freshness: response.data, result: undefined })
    } catch (cause) {
      setState("error", cause instanceof Error ? cause.message : String(cause))
    } finally {
      setState("loading", false)
    }
  }

  async function update() {
    if (state.updating || !state.freshness?.refreshRecommended) return
    setState({ updating: true, error: "", result: undefined })
    try {
      const response = await workspaceClient().update({ directory: props.workspacePath })
      if (!response.data) throw new Error(language.t("common.requestFailed"))
      setState({ result: response.data, freshness: response.data.freshness })
      if (!response.data.update.success) {
        setState("error", response.data.update.error || language.t("common.requestFailed"))
      }
    } catch (cause) {
      setState("error", cause instanceof Error ? cause.message : String(cause))
    } finally {
      setState("updating", false)
    }
  }

  onMount(() => void refresh())

  return (
    <Dialog
      size="large"
      title={language.t("dialog.spinosaWorkspaceUpdate.title")}
      description={language.t("dialog.spinosaWorkspaceUpdate.description")}
      action={
        <div class="flex items-center gap-2">
          <Button variant="ghost" disabled={state.loading || state.updating} onClick={() => void refresh()}>
            {language.t("dialog.spinosaWorkspaceUpdate.refresh")}
          </Button>
          <Button variant="ghost" disabled={state.updating} onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      }
    >
      <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-4 py-3 text-sm">
        <Show when={state.loading}>
          <p class="text-text-weak">{language.t("common.loading")}</p>
        </Show>
        <Show when={state.freshness}>
          {(freshness) => (
            <>
              <div class="rounded-md border border-border-base p-3">
                <p class="font-medium text-text-strong">{freshness().message}</p>
                <p class="mt-1 text-text-weak">
                  {language.t("dialog.spinosaWorkspaceUpdate.version", {
                    workspace: freshness().workspaceVersion || "unknown",
                    current: freshness().bundledVersion || "unknown",
                  })}
                </p>
              </div>
              <Show when={freshness().refreshRecommended}>
                <div>
                  <p class="mb-2 text-text-weak">{language.t("dialog.spinosaWorkspaceUpdate.filesToUpdate")}</p>
                  <ul class="max-h-40 overflow-y-auto rounded-md bg-surface-weak px-3 py-2 font-mono text-xs">
                    <For each={[...freshness().missingPaths, ...freshness().stalePaths].slice(0, 30)}>
                      {(path) => <li class="truncate">{path}</li>}
                    </For>
                  </ul>
                </div>
              </Show>
              <Show when={state.result}>
                {(result) => (
                  <div class="rounded-md bg-surface-weak p-3">
                    <p class="font-medium">
                      {language.t("dialog.spinosaWorkspaceUpdate.summary", {
                        added: result().update.added,
                        updated: result().update.updated,
                        removed: result().update.removed,
                      })}
                    </p>
                    <Show when={result().restartRequired && result().restartMessage}>
                      <p class="mt-2 text-text-weak">{result().restartMessage}</p>
                    </Show>
                  </div>
                )}
              </Show>
            </>
          )}
        </Show>
        <Show when={state.error}>
          <p class="text-danger" role="alert">{state.error}</p>
        </Show>
        <Show when={state.freshness?.refreshRecommended && (!state.result || !state.result.update.success)}>
          <div class="flex justify-end">
            <Button variant="primary" disabled={state.loading || state.updating} onClick={() => void update()}>
              {state.updating
                ? language.t("dialog.spinosaWorkspaceUpdate.updating")
                : language.t("dialog.spinosaWorkspaceUpdate.update")}
            </Button>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
