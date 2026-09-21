import { ButtonV2 } from "@spinosa/ui/v2/button-v2"
import { For, Show, createMemo } from "solid-js"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useProviders } from "@/hooks/use-providers"
import { displayName } from "@/pages/layout/helpers"
import type { PromptProjectController } from "@/components/prompt-project-selector"

const exampleKeys = [
  "spinosaHarness.example.evidence",
  "spinosaHarness.example.compare",
  "spinosaHarness.example.links",
] as const

// Spinosa harness strip: ports the TUI global-home harness traits into the
// desktop conversation box. Provider gate first (mirrors useConnected +
// DialogProvider), then workspace/agent chips plus Spinosa example prompts.
export function SpinosaHarnessStrip(props: {
  project: PromptProjectController
  restoreFocus: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const local = useLocal()
  const prompt = usePrompt()
  const providers = useProviders(() => sdk().directory)

  const connected = createMemo(() => providers.connected())
  const agent = () => local.agent.current()
  const canPinOrchestrator = () =>
    agent()?.name !== "build" && local.agent.list().some((item) => item.name === "build")
  const selected = () => props.project.selected()

  function connectProvider() {
    void import("@/components/dialog-connect-provider").then(({ DialogConnectProvider }) => {
      void dialog.show(() => <DialogConnectProvider directory={() => sdk().directory} />)
    })
  }

  function insertExample(key: (typeof exampleKeys)[number]) {
    const text = language.t(key)
    prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
    props.restoreFocus()
  }

  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <Show
          when={connected().length > 0}
          fallback={
            <ButtonV2 variant="contrast" size="small" onClick={connectProvider}>
              {language.t("command.provider.connect")}
            </ButtonV2>
          }
        >
          <ButtonV2 variant="ghost-muted" size="small" onClick={connectProvider}>
            {language.t("spinosaHarness.provider")}: {connected()[0]?.id}
          </ButtonV2>
          <ButtonV2 variant="ghost-muted" size="small" onClick={() => props.project.setOpen(true)}>
            {language.t("spinosaHarness.workspace")}:{" "}
            {selected()?.worktree ? displayName(selected()) : language.t("spinosaHome.pickWorkspace")}
          </ButtonV2>
          <Show when={agent()}>
            {(current) => (
              <ButtonV2
                variant="ghost-muted"
                size="small"
                onClick={() => {
                  if (canPinOrchestrator()) local.agent.set("build")
                  else local.agent.move(1)
                }}
              >
                {language.t("spinosaHarness.agent")}: {current().name}
                <Show when={canPinOrchestrator()}> · {language.t("spinosaHarness.pinOrchestrator")}</Show>
              </ButtonV2>
            )}
          </Show>
        </Show>
      </div>
      <Show when={connected().length > 0}>
        <div class="flex flex-wrap items-center gap-2">
          <For each={exampleKeys}>
            {(key) => (
              <ButtonV2 variant="outline" size="small" onClick={() => insertExample(key)}>
                {language.t(key)}
              </ButtonV2>
            )}
          </For>
        </div>
      </Show>
      <div class="text-12-regular text-text-weak">{language.t("spinosaHarness.hint")}</div>
    </div>
  )
}
