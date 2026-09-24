import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { useProviders } from "@/hooks/use-providers"
import { pathKey } from "@/utils/path-key"
import { homeProjectDirectories } from "@/pages/layout/helpers"
import { Button } from "@spinosa/ui/button"
import { useDialog } from "@spinosa/ui/context/dialog"
import { Logo } from "@spinosa/ui/logo"
import { DateTime } from "luxon"
import { createMemo, createResource, For, Show } from "solid-js"

const RECENT_WORKSPACES_DISPLAY_LIMIT = 5

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
  const serverSDK = useServerSDK()
  const workspaceCheckCache = new Map<string, Promise<boolean>>()
  const recent = createMemo(() => {
    const conn = server.current
    return conn ? global.ensureServerCtx(conn).projects.recentlyOpened() : []
  })

  // A real workspace carries a setup marker (spinosa/workspace,
  // .spinosa/workspace, or framework/spinosa/workspace). Plain folders the
  // server happened to open ("/", bare checkouts) stay off the list.
  const isWorkspace = (worktree: string) => {
    const cached = workspaceCheckCache.get(worktree)
    if (cached) return cached
    const pending = (async () => {
      const client = serverSDK().ensureDirSdkContext(worktree).client
      for (const marker of [".spinosa/workspace", "spinosa/workspace", "framework/spinosa/workspace"]) {
        try {
          const data = await client.file.read({ path: marker }).then((result) => result.data)
          if (data?.type === "text") return true
        } catch {
          /* try the next marker */
        }
      }
      return false
    })()
    workspaceCheckCache.set(worktree, pending)
    return pending
  }

  const [workspaceFlags] = createResource(recent, async (projects) => {
    const flags = await Promise.all(projects.map((project) => isWorkspace(project.worktree).catch(() => false)))
    return new Map(projects.map((project, index) => [project.worktree, flags[index]] as const))
  })

  const workspaces = createMemo(() => {
    const flags = workspaceFlags()
    if (!flags) return []
    return recent().filter((project) => flags.get(project.worktree)).slice(0, RECENT_WORKSPACES_DISPLAY_LIMIT)
  })

  const [registered, { refetch: refetchRegistered }] = createResource(
    () => server.current,
    async (conn) => {
      if (!conn) return []
      const result = await global.ensureServerCtx(conn).sdk.client.global.spinosa.workspaces.list()
      return result.data ?? []
    },
  )

  const registeredByPath = createMemo(() => new Map(
    (registered() ?? []).map((workspace) => [pathKey(workspace.path), workspace] as const),
  ))

  const registeredNotRecent = createMemo(() => {
    const recentPaths = new Set(workspaces().map((project) => pathKey(project.worktree)))
    return (registered() ?? []).filter((workspace) => !recentPaths.has(pathKey(workspace.path)))
  })

  function connectProvider() {
    void import("@/components/dialog-connect-provider").then((x) => {
      void dialog.show(() => <x.DialogConnectProvider />)
    })
  }

  function openNewSession(conn: ServerConnection.Any, directory: string, startStartup = false) {
    workspaceCheckCache.delete(directory)
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    void refetchRegistered()
    void tabs.newDraft({ server: ServerConnection.key(conn), directory }, startStartup ? "/startup" : undefined).then(() => {
      if (!startStartup) return
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const editor = document.querySelector<HTMLElement>('[data-component="prompt-input"]')
        if (!editor) return
        editor.focus()
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
      }))
    })
  }

  function chooseNewWorkspace() {
    const conn = server.current
    if (!conn || serverUnreachable()) return
    void import("@/components/dialog-spinosa-onboarding").then((component) => {
      dialog.show(() => (
        <component.DialogSpinosaOnboarding
          onOpenWorkspace={(directory, startStartup) => {
            dialog.close()
            const active = server.current
            if (active) openNewSession(active, directory, startStartup)
          }}
        />
      ))
    })
  }

  function resumeWorkspace(workspace: NonNullable<ReturnType<typeof registered>>[number]) {
    const conn = server.current
    if (!conn || !workspace.sourceLocation || serverUnreachable()) return
    void import("@/components/dialog-spinosa-onboarding").then((component) => {
      dialog.show(() => (
        <component.DialogSpinosaOnboarding
          resume={{
            workspacePath: workspace.path,
            sourcePath: workspace.sourceLocation!,
            workspaceName: workspace.projectName,
          }}
          onOpenWorkspace={(directory, startStartup) => {
            dialog.close()
            const active = server.current
            if (active) openNewSession(active, directory, startStartup)
          }}
        />
      ))
    })
  }

  function recoverWorkspace(workspace: NonNullable<ReturnType<typeof registered>>[number]) {
    void import("@/components/dialog-spinosa-workspace-recovery").then((component) => {
      dialog.show(() => (
        <component.DialogSpinosaWorkspaceRecovery
          workspace={workspace}
          onUpdated={() => void refetchRegistered()}
        />
      ))
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
    <div class="mx-auto flex h-full w-full max-w-xl flex-col items-center gap-6 overflow-y-auto px-4 py-10">
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
      <Show when={connected() && workspaces().length > 0}>
        <div class="flex w-full flex-col gap-2">
          <div class="pl-3 text-14-medium text-text-strong">{language.t("home.recentProjects")}</div>
          <ul class="flex flex-col gap-2">
            <For each={workspaces()}>
              {(project) => {
                const workspace = () => registeredByPath().get(pathKey(project.worktree))
                return (
                  <li class="flex items-center gap-2">
                    <Button
                      size="large"
                      variant="ghost"
                      class="min-w-0 flex-1 justify-between px-3 text-left text-14-mono"
                      onClick={() => server.current && openNewSession(server.current, project.worktree)}
                    >
                      {project.worktree.replace(homedir(), "~")}
                      <Show when={project.openedAt > 0}>
                        <div class="text-14-regular text-text-weak">
                          {DateTime.fromMillis(project.openedAt).toRelative()}
                        </div>
                      </Show>
                    </Button>
                    <Show when={workspace()?.setupStatus === "importing" && workspace()?.sourceLocation}>
                      <Button size="small" variant="secondary" onClick={() => workspace() && resumeWorkspace(workspace()!)}>
                        {language.t("dialog.workspace.recovery.resume")}
                      </Button>
                    </Show>
                    <Show when={workspace()?.setupStatus === "cli_started"}>
                      <Button size="small" variant="secondary" onClick={() => server.current && openNewSession(server.current, project.worktree, true)}>
                        {language.t("dialog.workspace.recovery.startup")}
                      </Button>
                    </Show>
                  </li>
                )
              }}
            </For>
          </ul>
        </div>
      </Show>
      <Show when={connected() && registeredNotRecent().length > 0}>
        <div class="flex w-full flex-col gap-2">
          <div class="pl-3 text-14-medium text-text-strong">{language.t("home.projects")}</div>
          <ul class="flex flex-col gap-2">
            <For each={registeredNotRecent()}>
              {(workspace) => {
                const missing = () => ["moved", "non_existent", "invalid", "identity_mismatch"].includes(workspace.presence)
                const incomplete = () => workspace.setupStatus === "importing"
                const needsStartup = () => workspace.setupStatus === "cli_started"
                return (
                  <li class="flex items-center gap-2 rounded-md border border-border-base px-3 py-2">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-14-medium text-text-strong">{workspace.projectName}</div>
                      <div class="truncate font-mono text-xs text-text-weak">{workspace.path.replace(homedir(), "~")}</div>
                      <Show when={missing()}>
                        <div class="text-xs text-text-weak">{language.t("dialog.workspace.recovery.missing")}</div>
                      </Show>
                      <Show when={incomplete()}>
                        <div class="text-xs text-text-weak">{language.t("dialog.workspace.recovery.incomplete")}</div>
                      </Show>
                    </div>
                    <Show
                      when={missing()}
                      fallback={
                        <Show
                          when={incomplete() && workspace.sourceLocation}
                          fallback={
                            <Button size="small" variant="secondary" onClick={() => server.current && openNewSession(server.current, workspace.path, needsStartup())}>
                              {needsStartup() ? language.t("dialog.workspace.recovery.startup") : language.t("common.open")}
                            </Button>
                          }
                        >
                          <Button size="small" variant="secondary" onClick={() => resumeWorkspace(workspace)}>
                            {language.t("dialog.workspace.recovery.resume")}
                          </Button>
                        </Show>
                      }
                    >
                      <Button size="small" variant="secondary" onClick={() => recoverWorkspace(workspace)}>
                        {language.t("dialog.workspace.recovery.recover")}
                      </Button>
                    </Show>
                  </li>
                )
              }}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  )
}
