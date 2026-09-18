import { createEffect, createSignal, createResource, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useKV } from "./kv"
import { useRoute } from "./route"
import { useTuiPaths, useTuiStartup } from "./runtime"
import type { PromptInfo } from "../prompt/history"
import {
  routeForWorkspaceOpen,
  SPINOSA_ACTIVE_WORKSPACE_KV,
  SPINOSA_ACTIVE_WORKSPACE_ID_KV,
  SPINOSA_GENERIC_MODE_KV,
  SPINOSA_LAST_SESSION_KV,
} from "../spinosa/entry"
import { inspectWorkspaceTemplatePack, isSpinosaWorkspace, readWorkspaceMeta } from "../spinosa/service"
import type { SpinosaWorkspaceMeta } from "../spinosa/types"
import { setActiveWorkspacePath, tuiLog } from "../spinosa/log"
import { inspectRegisteredWorkspacePresence, isUsableWorkspacePresence } from "@spinosa/core/workspace/presence"
import type { RouteNavigateInput } from "./route"
import { KV } from "../constants/kv-keys"
import { useToast } from "../ui/toast"
import {
  buildOpenWorkspaceSoftFail,
  humanizeWorkspacePresence,
  type OpenWorkspaceSoftFail,
} from "../spinosa/home-visibility"
import { resolveWorkspaceDisplayName } from "../spinosa/workspace-name"
import { truncatePathTail } from "../spinosa/truncate-path"

export const { use: useSpinosaWorkspace, provider: SpinosaWorkspaceProvider } = createSimpleContext({
  name: "SpinosaWorkspace",
  init: () => {
    const kv = useKV()
    const route = useRoute()
    const paths = useTuiPaths()
    const startup = useTuiStartup()
    const toast = useToast()
    const cwdWorkspace = isSpinosaWorkspace(paths.cwd) ? paths.cwd : undefined
    const [activePath, setActivePath] = createSignal<string | undefined>()
    const [genericMode, setGenericMode] = createSignal(false)
    const [pickerRequested, setPickerRequested] = createSignal(false)
    const [pickerReturnSessionId, setPickerReturnSessionId] = createSignal<string | undefined>()
    const [pendingPrompt, setPendingPrompt] = createSignal<{ workspacePath: string; prompt: PromptInfo } | undefined>()
    const [openFailure, setOpenFailure] = createSignal<OpenWorkspaceSoftFail | undefined>()
    let attemptedInitialWorkspaceHydration = false

    const reportOpenFailure = (failure: OpenWorkspaceSoftFail) => {
      setOpenFailure(failure)
      toast.show({
        variant: "warning",
        message: `${truncatePathTail(failure.path, 48)} — ${failure.reason}`,
        duration: 5000,
      })
    }

    const [meta, { refetch: refetchMeta }] = createResource(activePath, async (workspacePath) => {
      if (!workspacePath || !isSpinosaWorkspace(workspacePath)) return undefined
      return readWorkspaceMeta(workspacePath).catch(() => undefined)
    })
    const openWorkspace = async (workspacePath: string, options?: { route?: RouteNavigateInput }) => {
      const presence = await inspectRegisteredWorkspacePresence(workspacePath).catch(() => undefined)
      if (presence && !isUsableWorkspacePresence(presence)) {
        if (presence.status === "identity_mismatch") {
          tuiLog("openWorkspace: identity_mismatch, proceeding with marker ID")
        } else {
          const reason = `Workspace ${humanizeWorkspacePresence(presence.status)}`
          reportOpenFailure(
            buildOpenWorkspaceSoftFail({
              path: workspacePath,
              name: resolveWorkspaceDisplayName(workspacePath),
              workspaceID: presence.indexedWorkspaceID,
              presence: presence.status,
              reason,
            }),
          )
          return
        }
      }
      const previousPath = activePath()
      const previousGeneric = genericMode()
      const previousWorkspaceKv = kv.get(SPINOSA_ACTIVE_WORKSPACE_KV) as string | undefined
      const previousWorkspaceIdKv = kv.get(SPINOSA_ACTIVE_WORKSPACE_ID_KV) as string | undefined
      const previousGenericKv = kv.get(SPINOSA_GENERIC_MODE_KV)

      const rollbackActiveWorkspace = () => {
        setActiveWorkspacePath(previousPath)
        setActivePath(previousPath)
        setGenericMode(previousGeneric)
        kv.set(SPINOSA_ACTIVE_WORKSPACE_KV, previousWorkspaceKv)
        kv.set(SPINOSA_ACTIVE_WORKSPACE_ID_KV, previousWorkspaceIdKv)
        kv.set(SPINOSA_GENERIC_MODE_KV, previousGenericKv)
      }

      setActiveWorkspacePath(workspacePath)
      tuiLog("openWorkspace opened")
      kv.set(SPINOSA_ACTIVE_WORKSPACE_KV, workspacePath)
      kv.set(SPINOSA_GENERIC_MODE_KV, false)
      kv.set(KV.SESSION_DIRECTORY_FILTER, true)
      setActivePath(workspacePath)
      setGenericMode(false)
      setPickerRequested(false)
      const loaded = await readWorkspaceMeta(workspacePath).catch(() => undefined)
      if (activePath() !== workspacePath) return
      if (!loaded) {
        rollbackActiveWorkspace()
        reportOpenFailure(
          buildOpenWorkspaceSoftFail({
            path: workspacePath,
            name: resolveWorkspaceDisplayName(workspacePath),
            workspaceID: presence?.indexedWorkspaceID,
            presence: presence?.status ?? "invalid",
            reason: "Workspace metadata missing or unreadable",
          }),
        )
        return
      }
      kv.set(SPINOSA_ACTIVE_WORKSPACE_ID_KV, loaded.workspaceID)
      const nextRoute = options?.route
        ?? (route.data.type === "workspace" || route.data.type === "visualizer"
          ? route.data
          : routeForWorkspaceOpen(loaded.setupStatus, undefined, {
              workspacePath,
              sourceLocation: loaded.sourceLocation,
              workspaceName: loaded.projectName,
            }))
      route.navigate(nextRoute)

      // Non-blocking: point at Update workspace when protocol/template packs lag (version can match).
      void inspectWorkspaceTemplatePack({
        workspacePath,
        workspaceVersion: loaded.frameworkVersion,
      })
        .then((freshness) => {
          if (activePath() !== workspacePath || !freshness.refreshRecommended) return
          toast.show({
            variant: "warning",
            title: "Workspace template pack is stale",
            message: "Home → Update workspace files, then re-run spinosa to catch up.",
            duration: 8000,
          })
        })
        .catch(() => {})
    }

    const cwdDiscoveryTimer = setInterval(() => {
      if (activePath() || genericMode() || !isSpinosaWorkspace(paths.cwd)) return
      void openWorkspace(paths.cwd)
    }, 15_000)
    onCleanup(() => clearInterval(cwdDiscoveryTimer))

    /** Unset active workspace so Home is not workspace-ready (blocks cwd rediscovery). */
    const clearActiveWorkspace = () => {
      kv.set(SPINOSA_GENERIC_MODE_KV, true)
      kv.set(SPINOSA_ACTIVE_WORKSPACE_KV, undefined)
      kv.set(SPINOSA_ACTIVE_WORKSPACE_ID_KV, undefined)
      setActiveWorkspacePath(undefined)
      setActivePath(undefined)
      setGenericMode(true)
      setPickerRequested(false)
    }

    const useGenericMode = () => {
      clearActiveWorkspace()
      route.navigate({ type: "global" })
    }

    const showPicker = () => {
      // Keep the current route; Home/app open the picker as an overlay.
      // Previously this navigated to global and stranded mid-run sessions.
      const currentRoute = route.data
      if (currentRoute.type === "workspace" && currentRoute.sessionID) {
        kv.set(SPINOSA_LAST_SESSION_KV, currentRoute.sessionID)
        setPickerReturnSessionId(currentRoute.sessionID)
      } else {
        setPickerReturnSessionId(undefined)
      }
      setPickerRequested(true)
    }

    createEffect(() => {
      if (!kv.ready || attemptedInitialWorkspaceHydration || activePath() || genericMode()) {
        return
      }
      if (startup.initialRoute || route.data.type !== "global" || route.data.prompt) {
        attemptedInitialWorkspaceHydration = true
        return
      }
      attemptedInitialWorkspaceHydration = true
      if (kv.get(SPINOSA_GENERIC_MODE_KV) === true) {
        setGenericMode(true)
        return
      }

      if (cwdWorkspace) {
        void openWorkspace(cwdWorkspace)
        return
      }
    })

    const refresh = async (): Promise<void> => {
      if (!activePath()) return
      try {
        await refetchMeta()
      } catch (error) {
        tuiLog(`workspace refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return {
      get activePath() {
        return activePath()
      },
      get genericMode() {
        return genericMode()
      },
      get meta(): SpinosaWorkspaceMeta | undefined {
        return genericMode() ? undefined : meta()
      },
      get loading() {
        return meta.loading
      },
      get bootReady() {
        return true
      },
      get pickerRequested() {
        return pickerRequested()
      },
      get openFailure(): OpenWorkspaceSoftFail | undefined {
        return openFailure()
      },
      get pendingPrompt(): PromptInfo | undefined {
        const pending = pendingPrompt()
        return pending !== undefined && pending.workspacePath === activePath() ? pending.prompt : undefined
      },
      openWorkspace,
      clearActiveWorkspace,
      useGenericMode,
      showPicker,
      clearPickerRequest() {
        setPickerRequested(false)
      },
      clearOpenFailure() {
        setOpenFailure(undefined)
      },
      consumeOpenFailure(): OpenWorkspaceSoftFail | undefined {
        const failure = openFailure()
        setOpenFailure(undefined)
        return failure
      },
      restorePickerRoute() {
        const sessionID = pickerReturnSessionId()
        setPickerReturnSessionId(undefined)
        route.navigate(sessionID ? { type: "workspace", sessionID } : { type: "global" })
      },
      refresh,
      queuePrompt(prompt: PromptInfo, targetWorkspacePath?: string) {
        const workspacePath = targetWorkspacePath ?? activePath()
        if (workspacePath) setPendingPrompt({ workspacePath, prompt })
      },
      consumePendingPrompt() {
        const pending = pendingPrompt()
        const prompt = pending !== undefined && pending.workspacePath === activePath() ? pending.prompt : undefined
        setPendingPrompt(undefined)
        return prompt
      },
    }
  },
})
