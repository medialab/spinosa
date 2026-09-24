import { ButtonV2 } from "@spinosa/ui/v2/button-v2"
import { Show, createMemo } from "solid-js"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useProviders } from "@/hooks/use-providers"
import { displayName } from "@/pages/layout/helpers"
import type { PromptProjectController } from "@/components/prompt-project-selector"

// Spinosa harness strip: provider gate (mirrors useConnected +
// DialogProvider) plus a hint. Chips and example prompts moved out:
// chips live in SpinosaHarnessFooter, examples stay hidden for now.
export function SpinosaHarnessStrip(props: {
  project: PromptProjectController
  restoreFocus: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const providers = useProviders(() => sdk().directory)

  const connected = createMemo(() => providers.connected())

  function connectProvider() {
    void import("@/components/dialog-connect-provider").then(({ DialogConnectProvider }) => {
      void dialog.show(() => <DialogConnectProvider directory={() => sdk().directory} />)
    })
  }

  if (connected().length > 0) return null

  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <ButtonV2 variant="contrast" size="small" onClick={connectProvider}>
          {language.t("command.provider.connect")}
        </ButtonV2>
      </div>
      <div class="text-12-regular text-text-weak">{language.t("spinosaHarness.hint")}</div>
    </div>
  )
}

// Thin horizontal footer carrying the harness chips (provider, workspace,
// agent) at the bottom of the workspace home.
export function SpinosaHarnessFooter(props: { project: PromptProjectController }) {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const local = useLocal()
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

  return (
    <div class="flex h-7 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-t border-v2-border-border-muted px-3 text-[12px] text-v2-text-text-muted">
      <Show
        when={connected().length > 0}
        fallback={
          <button
            type="button"
            class="shrink-0 rounded px-1.5 py-0.5 hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus:outline-none"
            onClick={connectProvider}
          >
            {language.t("command.provider.connect")}
          </button>
        }
      >
        <button
          type="button"
          class="shrink-0 rounded px-1.5 py-0.5 hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus:outline-none"
          onClick={connectProvider}
        >
          {language.t("spinosaHarness.provider")}: {connected()[0]?.id}
        </button>
        <span aria-hidden="true" class="shrink-0 opacity-50">
          ·
        </span>
        <button
          type="button"
          class="shrink-0 rounded px-1.5 py-0.5 hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus:outline-none"
          onClick={() => props.project.setOpen(true)}
        >
          {language.t("spinosaHarness.workspace")}:{" "}
          {selected()?.worktree ? displayName(selected()) : language.t("spinosaHome.pickWorkspace")}
        </button>
        <Show when={agent()}>
          {(current) => (
            <>
              <span aria-hidden="true" class="shrink-0 opacity-50">
                ·
              </span>
              <button
                type="button"
                class="shrink-0 rounded px-1.5 py-0.5 hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus:outline-none"
                onClick={() => {
                  if (canPinOrchestrator()) local.agent.set("build")
                  else local.agent.move(1)
                }}
              >
                {language.t("spinosaHarness.agent")}: {current().name}
                <Show when={canPinOrchestrator()}> · {language.t("spinosaHarness.pinOrchestrator")}</Show>
              </button>
            </>
          )}
        </Show>
      </Show>
    </div>
  )
}
