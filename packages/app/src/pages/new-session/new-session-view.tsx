import { useDialog } from "@spinosa/ui/context/dialog"
import { Tooltip } from "@spinosa/ui/tooltip"
import { IconButton } from "@spinosa/ui/icon-button"
import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { TextField } from "@spinosa/ui/text-field"
import { Show, createSignal, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import { useNavigate } from "@solidjs/router"
import { PromptInputV2Composer } from "@/components/prompt-input-v2"
import { SpinosaHarnessStrip } from "@/components/spinosa-harness-strip"
import { PromptProjectSelector, type PromptProjectController } from "@/components/prompt-project-selector"
import { StatusPopoverV2 } from "@/components/status-popover"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { showToast } from "@/utils/toast"
import { displayName } from "@/pages/layout/helpers"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import type { NewSessionDraftController } from "./new-session-draft-controller"

export function NewSessionView(props: {
  input: NewSessionDraftController["input"]
  project: PromptProjectController
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const layout = useLayout()
  const navigate = useNavigate()

  const workspaceName = () => {
    if (props.project.loading()) return language.t("session.new.workspace.loading")
    const selected = props.project.selected()
    return selected ? displayName(selected) : language.t("spinosaHome.pickWorkspace")
  }
  const workspaceWorktree = () => props.project.selected()?.worktree

  const confirmDeleteWorkspace = () => {
    const worktree = workspaceWorktree()
    if (!worktree) return
    const name = workspaceName()
    dialog.show(() => {
      const [value, setValue] = createSignal("")
      const matches = () => value().trim() === name.trim() && name.trim().length > 0
      return (
        <Dialog title={language.t("dialog.workspace.delete.title")}>
          <form
            class="flex flex-col gap-4 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!matches()) return
              layout.projects.close(worktree)
              showToast({
                variant: "success",
                title: language.t("toast.workspace.delete.success.title"),
                description: name,
              })
              dialog.close()
              navigate("/")
            }}
          >
            <p class="text-sm opacity-80">{language.t("dialog.workspace.delete.message", { name })}</p>
            <p class="text-sm opacity-80">{language.t("dialog.workspace.delete.confirm.instruction", { name })}</p>
            <TextField
              autofocus
              value={value()}
              onChange={setValue}
              placeholder={language.t("dialog.workspace.delete.confirm.placeholder")}
              label={language.t("dialog.workspace.delete.confirm.placeholder")}
              hideLabel
              error={value().length > 0 && !matches() ? language.t("dialog.workspace.delete.confirm.mismatch") : undefined}
            />
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => dialog.close()}>
                {language.t("common.cancel")}
              </Button>
              <Button type="submit" variant="secondary" disabled={!matches()}>
                {language.t("common.delete")}
              </Button>
            </div>
          </form>
        </Dialog>
      )
    })
  }

  return (
    <div class="@container relative flex flex-col min-h-0 h-full flex-1">
      <div
        data-component="session-new-design"
        class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-v2-background-bg-deep"
      >
        <div class="flex shrink-0 items-center justify-end px-4 pt-3">
          <Tooltip placement="bottom" value={language.t("dialog.workspace.delete.title")}>
            <IconButton
              icon="trash"
              variant="ghost"
              class="titlebar-icon new-session-delete-button"
              disabled={!workspaceWorktree()}
              onClick={confirmDeleteWorkspace}
              aria-label={language.t("dialog.workspace.delete.title")}
            />
          </Tooltip>
        </div>
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6">
          <div class={NEW_SESSION_CONTENT_WIDTH}>
            <h1 class="flex w-full min-w-0 justify-center">
              <PromptProjectSelector controller={props.project} placement="bottom" workspaceTitle={workspaceName()} />
            </h1>
            <div class="mt-8 flex flex-col gap-8">
              <SpinosaHarnessStrip />
              <PromptInputV2Composer controller={props.input} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function NewSessionStatus(props: { mount: Accessor<HTMLElement | null>; visible: Accessor<boolean> }) {
  const language = useLanguage()

  return (
    <Show when={props.mount()} keyed>
      {(mount) => (
        <Portal mount={mount}>
          <Show when={props.visible()}>
            <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
              <StatusPopoverV2 />
            </Tooltip>
          </Show>
        </Portal>
      )}
    </Show>
  )
}
