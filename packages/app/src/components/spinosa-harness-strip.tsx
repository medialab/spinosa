import { ButtonV2 } from "@spinosa/ui/v2/button-v2"
import { Show, createMemo } from "solid-js"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useProviders } from "@/hooks/use-providers"

// Spinosa harness strip: provider gate (mirrors useConnected +
// DialogProvider) plus a hint. Examples stay hidden for now.
export function SpinosaHarnessStrip() {
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
