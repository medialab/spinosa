import { useDialog } from "@spinosa/ui/context/dialog"
import { Tooltip } from "@spinosa/ui/tooltip"
import { IconButton } from "@spinosa/ui/icon-button"
import { Show, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import { useNavigate } from "@solidjs/router"
import { PromptInputV2Composer } from "@/components/prompt-input-v2"
import { SpinosaHarnessStrip } from "@/components/spinosa-harness-strip"
import { PromptWorkspaceSelector } from "@/components/prompt-workspace-selector"
import {
  PromptProjectAddButton,
  PromptProjectSelector,
  type PromptProjectController,
} from "@/components/prompt-project-selector"
import { StatusPopoverV2 } from "@/components/status-popover"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { showToast } from "@/utils/toast"
import { displayName } from "@/pages/layout/helpers"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import type { NewSessionDraftController } from "./new-session-draft-controller"
import type { NewSessionWorkspaceController } from "./new-session-workspace-controller"

export function NewSessionView(props: {
  input: NewSessionDraftController["input"]
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const layout = useLayout()
  const navigate = useNavigate()

  const workspaceName = () => {
    const selected = props.project.selected()
    return selected ? displayName(selected) : language.t("spinosaHome.pickWorkspace")
  }
  const workspaceWorktree = () => props.project.selected()?.worktree

  const confirmDeleteWorkspace = () => {
    const worktree = workspaceWorktree()
    if (!worktree) return
    const name = workspaceName()
    void import("@/components/dialog-confirm").then((x) =>
      dialog.show(() => (
        <x.DialogConfirm
          title={language.t("dialog.workspace.delete.title")}
          message={language.t("dialog.workspace.delete.message", { name })}
          confirmLabel={language.t("common.delete")}
          onConfirm={() => {
            layout.projects.close(worktree)
            showToast({
              variant: "success",
              title: language.t("toast.workspace.delete.success.title"),
              description: name,
            })
            navigate("/")
          }}
        />
      )),
    )
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
              class="titlebar-icon"
              disabled={!workspaceWorktree()}
              onClick={confirmDeleteWorkspace}
              aria-label={language.t("dialog.workspace.delete.title")}
            />
          </Tooltip>
        </div>
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6">
          <div class={NEW_SESSION_CONTENT_WIDTH}>
            <h1 class="w-full truncate text-center text-[22px] font-[560] leading-7 tracking-[-0.02em] text-v2-text-text-base [font-family:var(--v2-font-family-sans)]">
              {workspaceName()}
            </h1>
            <div class="mt-8 flex flex-col gap-8">
              <SpinosaHarnessStrip />
              <PromptInputV2Composer controller={props.input} />
              <Show when={props.project.empty()}>
                <PromptProjectAddButton controller={props.project} />
              </Show>
              <Show when={props.project.selected()}>
                <div class="flex min-h-7 min-w-0 flex-col items-center justify-center gap-0 text-v2-text-text-faint sm:flex-row">
                  <PromptProjectSelector controller={props.project} placement="bottom" />
                  <PromptWorkspaceSelector
                    value={props.workspace.selection.value()}
                    projectRoot={props.workspace.project.root()}
                    workspaces={props.workspace.project.workspaces()}
                    canCreate={props.workspace.project.git()}
                    onChange={props.workspace.selection.set}
                    onDone={props.input.restoreFocus}
                  />
                </div>
              </Show>
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
