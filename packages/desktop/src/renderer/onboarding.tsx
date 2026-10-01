import { ServerConnection, useServer, useSettings, useTabs } from "@spinosa/app"
import { onMount } from "solid-js"
import { sendRendererDiagnostic } from "./diagnostics"

export function DesktopFirstLaunchOnboarding(props: { initialUrl: string; onLoaded: () => void }) {
  const server = useServer()
  const settings = useSettings()
  const tabs = useTabs()

  onMount(() => {
    void runFirstLaunchOnboarding().finally(props.onLoaded)
  })

  async function runFirstLaunchOnboarding() {
    const startedAt = Date.now()
    const record = (event: string, fields: Record<string, unknown> = {}, level: "info" | "error" = "info") => {
      void sendRendererDiagnostic(window.api, { event, level, durationMs: Date.now() - startedAt, fields }).catch(
        () => undefined,
      )
    }
    try {
      await Promise.all(
        [server.ready.promise, tabs.ready.promise, tabs.recentReady.promise].map((p) => p ?? Promise.resolve()),
      )
      const existingInstall = await window.api.isOldLayoutEligible()
      settings.general.setOldLayoutEligible(existingInstall)
      settings.general.initializeAgentVisibility(existingInstall)
      if (!server.isLocal()) return

      const pending = await window.api.isFirstLaunchOnboardingPending()
      if (!pending) return

      const shouldTrigger =
        !existingInstall &&
        props.initialUrl === "/" &&
        tabs.store.length === 0 &&
        server.list.every(ServerConnection.builtin)

      record("desktop.onboarding.evaluated", {
        pending,
        shouldTrigger,
        existingInstall,
        initialUrl: props.initialUrl,
        tabs: tabs.store.length,
        servers: server.list.length,
      })

      const directory = await window.api.finishFirstLaunchOnboarding(shouldTrigger)
      if (!shouldTrigger || !directory) return

      record("desktop.onboarding.draft", { hasDirectory: Boolean(directory) })
      server.projects.open(directory)
      server.projects.touch(directory)
      tabs.select(await tabs.newDraft({ server: server.key, directory }))
    } catch (error) {
      record("desktop.onboarding.error", { error }, "error")
    }
  }

  return null
}
