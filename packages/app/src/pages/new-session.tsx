import { createPromptProjectController } from "@/components/prompt-project-selector"
import { useTitlebarRightMount, useTitlebarSessionMount } from "@/components/titlebar"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { SessionWorkspaceVisualizer } from "./session/session-workspace-visualizer"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@spinosa/ui/v2/segmented-control-v2"
import { useDialog } from "@spinosa/ui/context/dialog"
import { createMediaQuery } from "@solid-primitives/media"
import { createEffect, createResource, createSignal, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { createNewSessionDraftController } from "./new-session/new-session-draft-controller"
import { NewSessionStatus, NewSessionView } from "./new-session/new-session-view"
import "./new-session/new-session-view.css"
import { createNewSessionWorkspaceController } from "./new-session/new-session-workspace-controller"
import { useNewSessionCommands } from "./new-session/use-new-session-commands"

/** The draft-only V2 session page. Submitting promotes the draft into a real session. */
export default function NewSessionPage() {
  const settings = useSettings()
  const language = useLanguage()
  const sdk = useSDK()
  const dialog = useDialog()
  const rightMount = useTitlebarRightMount()
  const titlebarMount = useTitlebarSessionMount()
  const desktop = createMediaQuery("(min-width: 768px)")
  const [view, setView] = createSignal<"home" | "visualizer">("home")
  const workspace = createNewSessionWorkspaceController()
  const draft = createNewSessionDraftController({
    worktree: workspace.selection.value,
    resetWorktree: workspace.selection.reset,
    registeredWorkspaces: workspace.project.registered,
    registeredLoading: () => workspace.project.registered.loading,
    registeredError: workspace.project.registryError,
  })
  const project = createPromptProjectController({
    controls: draft.project.controls,
    onDone: draft.input.restoreFocus,
  })
  useNewSessionCommands({
    restoreFocus: draft.input.restoreFocus,
    project: {
      empty: project.empty,
      open: () => project.setOpen(true),
    },
  })
  createEffect(() => {
    if (!draft.prompt.ready()) return
    draft.input.restoreFocus()
  })
  const ready = Promise.resolve()
  const [suspendUntilPromptReady] = createResource(
    () => draft.prompt.readyPromise() ?? ready,
    (promise) => promise.then(() => true),
  )

  const viewPill = (titlebar = false) => (
    <div class={titlebar
      ? "pointer-events-none absolute inset-x-0 top-1/2 z-40 flex -translate-y-1/2 justify-center"
      : "pointer-events-none absolute inset-x-0 top-1 z-40 flex justify-center"}>
      <SegmentedControlV2
        value={view()}
        onChange={(value) => {
          if (value === "home" || value === "visualizer") setView(value)
        }}
        aria-label={language.t("session.view.mode")}
        class={`pointer-events-auto !h-10 ${titlebar ? "!w-[260px]" : "!w-full"} !max-w-[260px] !rounded-full !border-0 !bg-transparent !p-0 !shadow-none`}
      >
        <SegmentedControlItemV2 value="home" aria-label={language.t("home.title")} class="new-session-view-toggle !h-8 !min-w-0 !flex-1 !truncate !rounded-full !px-2">
          {language.t("home.title")}
        </SegmentedControlItemV2>
        <SegmentedControlItemV2 value="visualizer" aria-label={language.t("session.view.visualizer")} class="new-session-view-toggle !h-8 !min-w-0 !flex-1 !truncate !rounded-full !px-2">
          {language.t("session.view.visualizer")}
        </SegmentedControlItemV2>
      </SegmentedControlV2>
    </div>
  )

  const openFile = (path: string) => {
    const workspacePath = sdk().directory
    if (!workspacePath) return
    const [busy, setBusy] = createSignal(true)
    const [error, setError] = createSignal<string | null>(null)
    const [text, setText] = createSignal<string | null>(null)
    void import("@/components/dialog-markdown-viewer").then((component) =>
      dialog.show(() => (
        <component.DialogMarkdownViewer path={path} busy={busy} error={error} text={text}
          onExport={() => {
            const content = text()
            if (!content) return
            void import("@/utils/session-export").then(({ downloadSessionExportText }) =>
              downloadSessionExportText(path.split("/").at(-1) ?? "source.md", content, "text/markdown"),
            )
          }} onPrint={() => window.print()} />
      )),
    )
    void sdk().client.file.read({ path, directory: workspacePath }).then((result) => {
      if (result.data?.type !== "text") throw new Error(language.t("dialog.md.binary"))
      setText(result.data.content)
    }).catch((cause) => setError(cause instanceof Error ? cause.message : language.t("dialog.md.failed")))
      .finally(() => setBusy(false))
  }

  return (
    <div class="new-session-page relative size-full overflow-hidden flex flex-col">
      {suspendUntilPromptReady()}
      <NewSessionStatus mount={rightMount} visible={settings.visibility.status} />
      <Show when={desktop()}>
        <Show when={titlebarMount()} keyed>{(mount) => <Portal mount={mount}>{viewPill(true)}</Portal>}</Show>
      </Show>
      <Show when={!desktop()}>{viewPill()}</Show>
      <div class="relative flex-1 min-h-0 flex flex-col" classList={{ "pt-14": !desktop() }}>
        <div class="flex-1 min-h-0 flex flex-col gap-2 p-2" classList={{ hidden: view() === "visualizer" }}>
          <NewSessionView input={draft.input} project={project} />
        </div>
        <Show when={view() === "visualizer"}>
          <div class="absolute inset-0 flex min-h-0">
            <SessionWorkspaceVisualizer workspacePath={() => sdk().directory} onOpenFile={openFile} />
          </div>
        </Show>
      </div>
    </div>
  )
}
