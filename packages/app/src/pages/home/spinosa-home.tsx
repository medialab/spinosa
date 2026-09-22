import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { useProviders } from "@/hooks/use-providers"
import { homeProjectDirectories } from "@/pages/layout/helpers"
import { Button } from "@spinosa/ui/button"
import { useDialog } from "@spinosa/ui/context/dialog"
import { Logo } from "@spinosa/ui/logo"
import { DateTime } from "luxon"
import { createMemo, For, Show } from "solid-js"

// Spinosa home: mirrors the TUI global home (title + provider gate, else the
// two big workspace buttons). "Spinosa" below is the intentional product name.
export function SpinosaHome() {
  const sync = useServerSync()
  const pickDirectory = useDirectoryPicker()
  const dialog = useDialog()
  const global = useGlobal()
  const server = useServer()
  const tabs = useTabs()
  const language = useLanguage()
  const providers = useProviders(() => undefined)

  const connected = createMemo(() => providers.connected().length > 0)
  const homedir = createMemo(() => sync().data.path.home)
  const serverUnreachable = createMemo(() => global.servers.health[server.key]?.healthy === false)
  const recent = createMemo(() => {
    return sync()
      .data.project.slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })

  function connectProvider() {
    void import("@/components/dialog-connect-provider").then((x) => {
      void dialog.show(() => <x.DialogConnectProvider />)
    })
  }

  function openNewSession(conn: ServerConnection.Any, directory: string) {
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory })
  }

  function chooseNewWorkspace() {
    const conn = server.current
    if (!conn || serverUnreachable()) return
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: false,
      onSelect: (result) => {
        const directory = homeProjectDirectories(result)[0]
        if (!directory) return
        openNewSession(conn, directory)
      },
    })
  }

  function choosePickWorkspace() {
    const conn = server.current
    if (!conn || serverUnreachable()) return
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        // Pick means open: register each directory and raise a draft tab for
        // it, mirroring a new workspace. Registering alone leaves the home
        // screen unchanged (recent projects come from the server list), which
        // reads as "nothing happens".
        for (const directory of homeProjectDirectories(result)) openNewSession(conn, directory)
      },
    })
  }

  return (
    <div class="mx-auto flex h-full w-full max-w-xl flex-col items-center justify-center gap-6 px-4">
      <div class="flex flex-col items-center gap-3">
        <Logo class="w-16 opacity-90" />
        <h1 class="text-32-medium text-text-strong tracking-tight">Spinosa</h1>
        <Show when={!connected()}>
          <p class="text-center text-12-regular text-text-weak">{language.t("home.providerTip")}</p>
        </Show>
      </div>
      <Show
        when={connected()}
        fallback={
          <Button size="large" variant="primary" class="px-6 py-3" onClick={connectProvider}>
            {language.t("command.provider.connect")}
          </Button>
        }
      >
        <div class="flex w-full flex-col gap-3 sm:flex-row">
          <Button
            size="large"
            variant="primary"
            class="flex-1 px-6 py-4"
            disabled={serverUnreachable()}
            onClick={chooseNewWorkspace}
          >
            {language.t("spinosaHome.newWorkspace")}
          </Button>
          <Button
            size="large"
            variant="secondary"
            class="flex-1 px-6 py-4"
            disabled={serverUnreachable()}
            onClick={choosePickWorkspace}
          >
            {language.t("spinosaHome.pickWorkspace")}
          </Button>
        </div>
      </Show>
      <Show when={connected() && recent().length > 0}>
        <div class="flex w-full flex-col gap-2">
          <div class="pl-3 text-14-medium text-text-strong">{language.t("home.recentProjects")}</div>
          <ul class="flex flex-col gap-2">
            <For each={recent()}>
              {(project) => (
                <Button
                  size="large"
                  variant="ghost"
                  class="justify-between px-3 text-left text-14-mono"
                  onClick={() => server.current && openNewSession(server.current, project.worktree)}
                >
                  {project.worktree.replace(homedir(), "~")}
                  <div class="text-14-regular text-text-weak">
                    {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                  </div>
                </Button>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  )
}
