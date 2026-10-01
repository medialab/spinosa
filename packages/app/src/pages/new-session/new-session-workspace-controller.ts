import { createMemo, createResource, createSignal } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { pathKey } from "@/utils/path-key"
import { showToast } from "@/utils/toast"

type RegisteredWorkspace = {
  path: string
  projectName: string
  presence: string
}

export function availableSpinosaWorkspaces(workspaces: readonly RegisteredWorkspace[] | undefined) {
  const seen = new Set<string>()
  return (workspaces ?? []).flatMap((workspace) => {
    if (workspace.presence !== "present" && workspace.presence !== "legacy") return []
    const key = pathKey(workspace.path)
    if (!workspace.path || seen.has(key)) return []
    seen.add(key)
    return [{ path: workspace.path, name: workspace.projectName }]
  })
}

export function resolveNewSessionWorktree(input: {
  enabled: boolean
  selected?: string
  directory: string
  projectWorktree?: string
}) {
  if (!input.enabled) return "main"
  if (input.selected) return input.selected
  if (input.projectWorktree && input.directory !== input.projectWorktree) return input.directory
  return "main"
}

export function normalizeNewSessionWorktree(value: string, directory: string, projectWorktree?: string) {
  if (value === "main" && projectWorktree !== directory) return projectWorktree
  return value
}

export function createNewSessionWorkspaceController() {
  const sdk = useSDK()
  const sync = useSync()
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const [worktree, setWorktree] = createSignal<string>()
  const [registryError, setRegistryError] = createSignal(false)
  const [registered] = createResource(
    () => serverSDK().client,
    async (client) => {
      try {
        const result = await client.global.spinosa.workspaces.list()
        setRegistryError(false)
        return availableSpinosaWorkspaces(result.data)
      } catch (error) {
        setRegistryError(true)
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
        return []
      }
    },
    { initialValue: [] },
  )
  const value = createMemo(() =>
    resolveNewSessionWorktree({
      enabled: true,
      selected: worktree(),
      directory: sdk().directory,
      projectWorktree: sync().project?.worktree,
    }),
  )

  return {
    selection: {
      value,
      reset: () => setWorktree(),
      set: (worktree: string) =>
        setWorktree(normalizeNewSessionWorktree(worktree, sdk().directory, sync().project?.worktree)),
    },
    project: {
      registered,
      registryError,
    },
  }
}

export type NewSessionWorkspaceController = ReturnType<typeof createNewSessionWorkspaceController>
