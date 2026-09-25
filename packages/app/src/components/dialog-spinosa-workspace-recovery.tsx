import { useDirectoryPicker } from "@/components/directory-picker"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { useDialog } from "@spinosa/ui/context/dialog"
import { createSignal, Show, For } from "solid-js"

export type RegistryWorkspace = {
  path: string
  projectName: string
  workspaceID?: string
  presence: string
  setupStatus: string
  registeredAt: string
  sourceLocation?: string
  tags: string[]
}

export function DialogSpinosaWorkspaceRecovery(props: {
  workspace: RegistryWorkspace
  onUpdated: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const server = useServer()
  const sdk = useServerSDK()
  const pickDirectory = useDirectoryPicker()
  const [candidatePath, setCandidatePath] = createSignal("")
  const [matches, setMatches] = createSignal<string[]>([])
  const [busy, setBusy] = createSignal(false)
  const [confirmRemove, setConfirmRemove] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const [error, setError] = createSignal("")

  const recover = async (path: string) => {
    const conn = server.current
    if (!conn || busy()) return
    setBusy(true)
    setError("")
    try {
      await sdk().client.global.spinosa.workspaces.recover({
        indexedPath: props.workspace.path,
        candidatePath: path,
        projectName: props.workspace.projectName,
        workspaceID: props.workspace.workspaceID,
      })
      props.onUpdated()
      dialog.close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const chooseFolder = () => {
    const conn = server.current
    if (!conn) return
    pickDirectory({
      server: conn,
      title: language.t("dialog.workspace.recovery.chooseFolder"),
      multiple: false,
      onSelect: (result) => {
        const selected = Array.isArray(result) ? result[0] : result
        if (selected) setCandidatePath(selected)
      },
    })
  }

  const scan = async () => {
    if (!props.workspace.workspaceID || busy()) return
    setBusy(true)
    setError("")
    setMatches([])
    setMessage(language.t("dialog.workspace.recovery.searching"))
    try {
      const result = await sdk().client.global.spinosa.workspaces.recover2.scan({
        indexedPath: props.workspace.path,
        projectName: props.workspace.projectName,
        workspaceID: props.workspace.workspaceID,
      }).then((response) => response.data)
      if (!result) throw new Error(language.t("dialog.workspace.recovery.failed"))
      if (result.status === "found") {
        props.onUpdated()
        dialog.close()
      } else if (result.status === "ambiguous") {
        setMatches(result.matches)
        setMessage(language.t("dialog.workspace.recovery.multiple"))
      } else {
        setMessage(language.t("dialog.workspace.recovery.notFound"))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setMessage("")
    } finally {
      setBusy(false)
    }
  }

  const unregister = async () => {
    if (busy()) return
    setBusy(true)
    setError("")
    try {
      await sdk().client.global.spinosa.workspaces.unregister({ path: props.workspace.path })
      props.onUpdated()
      dialog.close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={language.t("dialog.workspace.recovery.title")}
      description={language.t("dialog.workspace.recovery.description", { name: props.workspace.projectName })}
      size="large"
      action={
        <Button variant="ghost" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
      }
    >
      <div class="flex flex-col gap-4 px-4 py-3">
        <div class="rounded-md bg-surface-weak px-3 py-2 text-sm">
          <div class="font-medium">{props.workspace.projectName}</div>
          <div class="break-all font-mono text-xs opacity-70">{props.workspace.path}</div>
        </div>

        <div class="flex flex-col gap-2">
          <div class="text-sm font-medium">{language.t("dialog.workspace.recovery.manual")}</div>
          <div class="flex gap-2">
            <input
              class="min-w-0 flex-1 rounded-md border border-border-base bg-background-base px-3 py-2 text-sm"
              value={candidatePath()}
              placeholder={language.t("dialog.workspace.recovery.pathPlaceholder")}
              onInput={(event) => setCandidatePath(event.currentTarget.value)}
            />
            <Button variant="secondary" disabled={busy()} onClick={chooseFolder}>
              {language.t("dialog.workspace.recovery.chooseFolder")}
            </Button>
            <Button variant="primary" disabled={busy() || !candidatePath().trim()} onClick={() => void recover(candidatePath().trim())}>
              {language.t("dialog.workspace.recovery.recover")}
            </Button>
          </div>
        </div>

        <div class="flex flex-col gap-2 border-t border-border-base pt-4">
          <div class="text-sm font-medium">{language.t("dialog.workspace.recovery.searchTitle")}</div>
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs opacity-70">{language.t("dialog.workspace.recovery.searchDescription")}</p>
            <Button variant="secondary" disabled={busy() || !props.workspace.workspaceID} onClick={() => void scan()}>
              {language.t("dialog.workspace.recovery.search")}
            </Button>
          </div>
          <Show when={message()}><div class="text-sm opacity-80">{message()}</div></Show>
          <Show when={matches().length > 0}>
            <ul class="flex max-h-40 flex-col gap-1 overflow-auto">
              <For each={matches()}>
                {(match) => (
                  <li>
                    <Button variant="ghost" class="w-full justify-start break-all text-left font-mono text-xs" disabled={busy()} onClick={() => void recover(match)}>
                      {match}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>

        <Show when={error()}>
          <div role="alert" class="rounded-md bg-surface-danger-base/10 px-3 py-2 text-sm text-text-danger">
            {error()}
          </div>
        </Show>

        <div class="flex flex-col gap-2 border-t border-border-base pt-4">
          <Show
            when={confirmRemove()}
            fallback={
              <Button variant="ghost" disabled={busy()} onClick={() => setConfirmRemove(true)}>
                {language.t("dialog.workspace.recovery.remove")}
              </Button>
            }
          >
            <div class="text-xs opacity-70">{language.t("dialog.workspace.recovery.removeConfirm")}</div>
            <div class="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy()} onClick={() => setConfirmRemove(false)}>
                {language.t("common.cancel")}
              </Button>
              <Button variant="secondary" disabled={busy()} onClick={() => void unregister()}>
                {language.t("dialog.workspace.recovery.remove")}
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
