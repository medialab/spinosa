import { base64Encode } from "@spinosa/kernel-core/util/encode"
import { createQuery } from "@tanstack/solid-query"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { type Accessor, createMemo } from "solid-js"
import type { PromptInputControls } from "@/components/prompt-input/contracts"
import type { PromptProject, PromptProjectControls } from "@/components/prompt-project-selector"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLayout } from "@/context/layout"
import { useLocal, type ModelSelection } from "@/context/local"
import { usePlatform } from "@/context/platform"
import type { QueryOptionsApi } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { serverName, ServerConnection, useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useTabs } from "@/context/tabs"
import { useProviders } from "@/hooks/use-providers"
import { pathKey } from "@/utils/path-key"

export function createPromptInputController(input: {
  sessionKey: Accessor<string>
  sessionID: Accessor<string | undefined>
  queryOptions: Pick<QueryOptionsApi, "agents" | "providers">
  model?: ModelSelection
}) {
  const layout = useLayout()
  const platform = usePlatform()
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()
  const providers = useProviders(() => sdk().directory)
  const view = layout.view(input.sessionKey)
  const agentsQuery = createQuery(() => input.queryOptions.agents(pathKey(sdk().directory)))
  const globalProvidersQuery = createQuery(() => ({
    ...input.queryOptions.providers(null),
    enabled: !!platform.homeDirectory,
  }))
  const providersQuery = createQuery(() => input.queryOptions.providers(pathKey(sdk().directory)))

  return createMemo<PromptInputControls>(() => {
    return {
      agents: {
        available: sync().data.agent,
        options: local.agent.list().map((agent) => agent.name),
        current: local.agent.current()?.name ?? "",
        loading: agentsQuery.isLoading,
        visible: local.agent.visible(),
        select: local.agent.set,
      },
      model: {
        selection: input.model ?? local.model,
        paid: providers.paid().length > 0,
        loading:
          (local.agent.visible() && agentsQuery.isLoading) ||
          providersQuery.isLoading ||
          globalProvidersQuery.isLoading,
      },
      session: {
        id: input.sessionID(),
        tabs: layout.tabs(input.sessionKey),
        reviewPanel: view.reviewPanel,
      },
    }
  })
}

export function registeredPromptProjects(
  opened: readonly PromptProject[],
  registered: readonly { path: string; name: string }[],
  server?: PromptProject["server"],
  fallbackPath?: string,
): PromptProject[] {
  const projects = registered.map((workspace) => {
    const project = opened.find(
      (item) => pathKey(item.worktree) === pathKey(workspace.path) && (!server || item.server?.key === server.key),
    )
    return {
      ...project,
      worktree: workspace.path,
      name: workspace.name,
      ...(project?.server || server ? { server: project?.server ?? server } : {}),
    }
  })
  if (!fallbackPath || projects.some((project) => pathKey(project.worktree) === pathKey(fallbackPath))) return projects
  const current = opened.find((project) => pathKey(project.worktree) === pathKey(fallbackPath))
  return current ? [...projects, current] : projects
}

export function createPromptProjectControls(
  registeredWorkspaces?: Accessor<readonly { path: string; name: string }[]>,
  registeredLoading?: Accessor<boolean>,
  registeredError?: Accessor<boolean>,
) {
  const navigate = useNavigate()
  const layout = useLayout()
  const server = useServer()
  const serverSDK = useServerSDK()
  const sdk = useSDK()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const [search] = useSearchParams<{ draftId?: string }>()
  const projectServer = () => serverSDK().server
  const projectServerCtx = createMemo(() => global.ensureServerCtx(projectServer()))
  const projects = createMemo(() => {
    const opened =
      server.list.length <= 1
        ? search.draftId
          ? projectServerCtx().projects.list()
          : layout.projects.list()
        : server.list.flatMap((conn) => {
            const item = { key: ServerConnection.key(conn), name: serverName(conn) }
            return global
              .ensureServerCtx(conn)
              .projects.list()
              .map((project) => ({ ...project, server: item }))
          })
    const active = projectServer()
    const serverInfo =
      server.list.length > 1 ? { key: ServerConnection.key(active), name: serverName(active) } : undefined
    if (registeredWorkspaces) {
      return registeredPromptProjects(
        opened,
        registeredWorkspaces(),
        serverInfo,
        registeredError?.() ? sdk().directory : undefined,
      )
    }
    return opened
  })
  const selectProject = (worktree: string, serverKey?: string) => {
    const conn = serverKey ? server.list.find((conn) => ServerConnection.key(conn) === serverKey) : projectServer()
    if (search.draftId) {
      if (!conn) return
      const target = global.ensureServerCtx(conn)
      target.projects.open(worktree)
      target.projects.touch(worktree)
      tabs.updateDraft(search.draftId, { server: ServerConnection.key(conn), directory: worktree })
      return
    }

    if (!serverKey) {
      layout.projects.open(worktree)
      server.projects.touch(worktree)
      navigate(`/${base64Encode(worktree)}/session`)
      return
    }

    if (!conn) return
    const target = global.ensureServerCtx(conn)
    target.projects.open(worktree)
    target.projects.touch(worktree)
    server.setActive(ServerConnection.key(conn))
    navigate(`/${base64Encode(worktree)}/session`)
  }

  const addProject = (title: string, serverKey?: string) => {
    const conn = serverKey ? server.list.find((conn) => ServerConnection.key(conn) === serverKey) : projectServer()
    if (!conn) return
    pickDirectory({
      server: conn,
      title,
      onSelect: (result) => {
        const directory = Array.isArray(result) ? result[0] : result
        if (directory) selectProject(directory, serverKey)
      },
    })
  }

  return createMemo<PromptProjectControls>(() => ({
    available: projects(),
    allowAdd: !registeredWorkspaces,
    loading: registeredLoading?.() ?? false,
    directory: sdk().directory,
    server: server.list.length > 1 ? ServerConnection.key(projectServer()) : undefined,
    select: selectProject,
    add: addProject,
  }))
}
