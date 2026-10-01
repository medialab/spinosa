import { useCommand, type CommandOption } from "@/context/command"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useLocal, type ModelSelection } from "@/context/local"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useDialog } from "@spinosa/ui/context/dialog"
import { getCursorPosition, setCursorPosition } from "@/components/prompt-input/editor-dom"
import { showToast } from "@/utils/toast"
import { useSessionLayout } from "./session-layout"
import { createSessionOwnership } from "./session-ownership"
import { base64Encode } from "@spinosa/kernel-core/util/encode"

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useComposerCommands = (input: { model?: ModelSelection } = {}) => {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const navigate = useNavigate()
  const { params, sessionKey } = useSessionLayout()
  const sessionOwnership = createSessionOwnership(sessionKey)
  const model = input.model ?? local.model
  const modelCommand = withCategory(language.t("command.category.model"))
  const providerCommand = withCategory(language.t("command.category.provider"))
  const agentCommand = withCategory(language.t("command.category.agent"))
  const sessionCommand = withCategory(language.t("command.category.session"))

  const runStartupBrief = async () => {
    const owner = sessionOwnership.capture()
    let startup: { input: string; forceAgent: "build" } | undefined
    try {
      const result = await sdk().client.experimental.spinosa.workspace.startupPrompt({ directory: sdk().directory })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      startup = result.data
    } catch (cause) {
      owner.run(() =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      return
    }
    owner.run(() => {
      if (!startup) return
      const text = startup.input
      local.agent.set(startup.forceAgent)
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      prompt.submit()
    })
  }

  const chooseModel = async () => {
    const owner = sessionOwnership.capture()
    const editor = document.querySelector<HTMLElement>('[data-component="prompt-input"]')
    const selection = window.getSelection()
    const cursor =
      editor && selection?.rangeCount && editor.contains(selection.anchorNode) ? getCursorPosition(editor) : null
    const restoreComposer = () => {
      // Kobalte restores focus during its teardown effect; defer past it so the
      // composer keeps focus and the caret returns to where the user left it.
      requestAnimationFrame(() => {
        const editor = document.querySelector<HTMLElement>('[data-component="prompt-input"]')
        if (!editor) return
        editor.focus()
        if (cursor !== null) setCursorPosition(editor, cursor)
      })
    }
    const { DialogSelectModel } = await import("@/components/dialog-select-model")
    owner.run(() => {
      void dialog.show(() => <DialogSelectModel model={model} />, restoreComposer)
    })
  }

  const configureProvider = async () => {
    const owner = sessionOwnership.capture()
    const { DialogConnectProvider } = await import("@/components/dialog-connect-provider")
    owner.run(() => void dialog.show(() => <DialogConnectProvider directory={() => sdk().directory} />))
  }

  const openDraftSessions = () => {
    const sessions = sync().data.session.map((item) => ({ id: item.id, title: item.title || item.id }))
    const directory = sdk().directory
    void import("@/components/dialog-session-list").then((x) =>
      dialog.show(() => (
        <x.DialogSessionList
          sessions={sessions}
          onSelect={(id) => navigate(`/${base64Encode(directory)}/session/${id}`)}
        />
      )),
    )
  }

  command.register("composer", () => [
    ...(!params.id
      ? [
          sessionCommand({
            id: "dialog.session",
            title: language.t("dialog.session.list.title"),
            slash: "session",
            onSelect: openDraftSessions,
          }),
        ]
      : []),
    modelCommand({
      id: "model.choose",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      keybind: "mod+'",
      slash: "model",
      onSelect: chooseModel,
    }),
    modelCommand({
      id: "model.choose.alias",
      title: language.t("command.model.choose"),
      slash: "models",
      onSelect: chooseModel,
    }),
    providerCommand({
      id: "provider.configure",
      title: language.t("command.provider.connect"),
      slash: "provider",
      onSelect: () => void configureProvider(),
    }),
    modelCommand({
      id: "model.cycleRecent",
      title: language.t("command.model.cycleRecent"),
      keybind: "f2",
      onSelect: () => model.cycle(1),
    }),
    modelCommand({
      id: "model.cycleRecent.reverse",
      title: language.t("command.model.cycleRecent"),
      keybind: "shift+f2",
      hidden: true,
      onSelect: () => model.cycle(-1),
    }),
    modelCommand({
      id: "dialog.variant",
      title: language.t("dialog.variant.title"),
      slash: "variant",
      onSelect: () => {
        void import("@/components/dialog-variant-picker").then((x) =>
          dialog.show(() => (
            <x.DialogVariantPicker
              variants={model.variant.list()}
              current={model.variant.current() ?? undefined}
              onSelect={(variant) => model.variant.set(variant ?? undefined)}
            />
          )),
        )
      },
    }),
    modelCommand({
      id: "model.variant.cycle",
      title: language.t("command.model.variant.cycle"),
      description: language.t("command.model.variant.cycle.description"),
      keybind: "shift+mod+d",
      onSelect: () => model.variant.cycle(),
    }),
    agentCommand({
      id: "agent.cycle",
      title: language.t("command.agent.cycle"),
      description: language.t("command.agent.cycle.description"),
      keybind: "mod+.",
      slash: "agent",
      disabled: !local.agent.visible(),
      onSelect: () => local.agent.move(1),
    }),
    agentCommand({
      id: "agent.cycle.reverse",
      title: language.t("command.agent.cycle.reverse"),
      description: language.t("command.agent.cycle.reverse.description"),
      keybind: "shift+mod+.",
      disabled: !local.agent.visible(),
      onSelect: () => local.agent.move(-1),
    }),
    sessionCommand({
      id: "session.startup",
      title: language.t("command.startup.title"),
      slash: "startup",
      onSelect: () => void runStartupBrief(),
    }),
  ])
}
