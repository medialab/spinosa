import { useCommand, type CommandOption } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLocal, type ModelSelection } from "@/context/local"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@spinosa/ui/context/dialog"
import { getCursorPosition, setCursorPosition } from "@/components/prompt-input/editor-dom"
import { sdkResponseData } from "@/utils/sdk-response"
import { useSessionLayout } from "./session-layout"
import { createSessionOwnership } from "./session-ownership"

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
  const { sessionKey } = useSessionLayout()
  const sessionOwnership = createSessionOwnership(sessionKey)
  const model = input.model ?? local.model
  const modelCommand = withCategory(language.t("command.category.model"))
  const agentCommand = withCategory(language.t("command.category.agent"))
  const sessionCommand = withCategory(language.t("command.category.session"))

  const runStartupBrief = async () => {
    const owner = sessionOwnership.capture()
    let brief: string | undefined
    try {
      const result = await sdk().client.file.read({ path: "startup-prompt.md" })
      const data = sdkResponseData<{ type?: string; content?: string }>(result)
      const content = data?.type === "text" ? data.content : undefined
      if (content?.trim()) brief = content
    } catch {
      brief = undefined
    }
    owner.run(() => {
      const text = brief ?? language.t("command.startup.fallback")
      local.agent.set("build")
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      queueMicrotask(() => {
        if (!owner.current()) return
        const editor = document.querySelector<HTMLElement>('[data-component="prompt-input"]')
        editor?.focus()
        prompt.submit()
      })
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

  command.register("composer", () => [
    modelCommand({
      id: "model.choose",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      keybind: "mod+'",
      slash: "model",
      onSelect: chooseModel,
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
