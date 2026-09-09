import { Prompt, type PromptRef } from "../component/prompt"
import { For, createEffect, createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Logo } from "../component/logo"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useGlobalRoute } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { usePluginRuntime } from "../plugin/runtime"
import { useEditorContext } from "../context/editor"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useTuiConfig } from "../config"
import { HomeSessionDestinationProvider } from "./home/session-destination"
import { SpinosaPromptChips } from "./workspace/spinosa-prompt-chips"
import { MAIN_CONTENT_MAX_WIDTH } from "../util/layout"
import { safeResourceValue } from "../util/resource"
import { CenteredColumn } from "../component/centered-column"
import { useSpinosaWorkspace } from "../context/spinosa-workspace"
import { useTheme } from "../context/theme"
import type { Theme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSpinosaStartupChoice } from "../component/dialog-spinosa-startup-choice"
import { DialogSpinosaMissingWorkspace } from "../component/dialog-spinosa-missing-workspace"
import { getWorkspaceLaunchDecision } from "../spinosa/workspace-launch"
import { setupStatusLabel, setupStatusThemeKey } from "../spinosa/status-labels"
import { HomeFooter } from "../component/home-footer"
import { buttonBackground, buttonBorder, buttonText } from "../util/button"
import { countRawMarkdownFiles, listRegisteredWorkspaces, readBundledFrameworkVersion, isPrereleaseFrameworkVersion, readWorkspaceMeta } from "../spinosa/service"
import { workspaceAsciiBannerText, resolveWorkspaceDisplayName } from "../spinosa/workspace-name"
import { upgradeFramework } from "@spinosa/core/commands/upgrade"
import { type ReleaseChannel } from "@spinosa/core/system/channels"
import { cleanupStaleInstallDirectories, inspectSpinosaMaintenance } from "@spinosa/core/system/maintenance"
import { createImportJob } from "../spinosa/job-events"
import type { SpinosaSetupStatus } from "../spinosa/types"
import { DialogConfirm } from "../ui/dialog-confirm"
import { join } from "node:path"
import { statSync } from "node:fs"
import { useConnected } from "../component/use-connected"
import { ORCHESTRATOR_AGENT_ID } from "../util/agent"
import { DialogProvider } from "../component/dialog-provider"
import { inspectWorkspacePresence, isUsableWorkspaceStatus, workspacePresenceLabel } from "@spinosa/core/workspace/presence"
import type { SpinosaWorkspacePresence } from "@spinosa/core/types"
import type { SpinosaWorkspaceID } from "@spinosa/core/workspace/identity"
import { SPINOSA_BASE_MODE, useBindings } from "../keymap"
import { truncatePathTail } from "../spinosa/truncate-path"
import {
  RECENT_WORKSPACE_COUNT,
  formatCompactMaintenanceCue,
  formatMaintenanceStalePaths,
  formatRecentLoadError,
  formatRecentWorkspacesLabel,
  formatRepairVersionUnknownMessage,
  recentDisplayCap,
} from "../spinosa/home-visibility"

const SHELL_PLACEHOLDER = ["ls -la", "git status", "pwd"]
const defaultPlaceholder = {
  normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
  shell: SHELL_PLACEHOLDER,
}
const spinosaPlaceholder = {
  normal: [
    "Find evidence in my sources for…",
    "Compare groups using my imported sources",
    "Find unexpected links across my sources",
  ],
  shell: SHELL_PLACEHOLDER,
}
const MAINTENANCE_CHECK_DELAY_MS = 500

function getLastAccessed(workspacePath: string): number {
  try {
    return statSync(join(workspacePath, ".spinosa", "workspace")).mtimeMs
  } catch {
    return 0
  }
}

function recentStatusColor(status: SpinosaSetupStatus, theme: Theme) {
  return theme[setupStatusThemeKey(status)]
}

export function Home() {
  const pluginRuntime = usePluginRuntime()
  const sync = useSync()
  const route = useGlobalRoute()
  const dialog = useDialog()
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const editor = useEditorContext()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const spinosa = useSpinosaWorkspace()
  const providerConnected = useConnected()
  const { theme } = useTheme()
  const workspaceReady = createMemo(() => Boolean(spinosa.activePath && !spinosa.genericMode))
  const compactLayout = createMemo(() => dimensions().height < 24)
  const startupPrompt = createMemo(() => route.prompt ?? spinosa.pendingPrompt)
  const startupPromptIsQueued = createMemo(() => !route.prompt && Boolean(spinosa.pendingPrompt))
  const [bundledVersion] = createResource(() => readBundledFrameworkVersion().catch(() => undefined))
  type RecentWorkspace = {
    path: string
    name: string
    workspaceID?: SpinosaWorkspaceID
    status: SpinosaSetupStatus
    fileCount: number
    presence?: SpinosaWorkspacePresence
    available: boolean
  }
  const [recentWorkspaces, setRecentWorkspaces] = createSignal<RecentWorkspace[]>([])
  const [recentTotal, setRecentTotal] = createSignal(0)
  const [recentLoading, setRecentLoading] = createSignal(true)
  const [recentLoadError, setRecentLoadError] = createSignal<string | undefined>()
  const [selectedRecent, setSelectedRecent] = createSignal(0)
  const loadRecentWorkspaces = async () => {
    setRecentLoading(true)
    setRecentLoadError(undefined)
    try {
      const workspaces = await listRegisteredWorkspaces()
      const rows: (RecentWorkspace & { lastAccessed: number })[] = []
      for (const ws of workspaces) {
        const meta = await readWorkspaceMeta(ws.path).catch(() => undefined)
        const available = Boolean(meta) && isUsableWorkspaceStatus(ws.presence)
        if (available && meta) {
          rows.push({
            path: ws.path,
            name: resolveWorkspaceDisplayName(ws.path, meta.projectName ?? ws.projectName),
            workspaceID: ws.workspaceID,
            status: meta.setupStatus || "unknown",
            fileCount: await countRawMarkdownFiles(join(ws.path, "raw")),
            lastAccessed: getLastAccessed(ws.path),
            presence: ws.presence,
            available: true,
          })
          continue
        }
        // Index entry whose folder is missing or otherwise unusable — keep visible for recovery.
        rows.push({
          path: ws.path,
          name: resolveWorkspaceDisplayName(ws.path, meta?.projectName ?? ws.projectName),
          workspaceID: ws.workspaceID,
          status: meta?.setupStatus || "unknown",
          fileCount: 0,
          lastAccessed: getLastAccessed(ws.path),
          presence: isUsableWorkspaceStatus(ws.presence) ? "non_existent" : (ws.presence ?? "non_existent"),
          available: false,
        })
      }
      rows.sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1
        return b.lastAccessed - a.lastAccessed
      })
      setRecentTotal(rows.length)
      setRecentWorkspaces(rows.slice(0, RECENT_WORKSPACE_COUNT))
    } catch (error) {
      setRecentTotal(0)
      setRecentWorkspaces([])
      setRecentLoadError(formatRecentLoadError(error))
    } finally {
      setRecentLoading(false)
    }
  }
  const wsVersion = createMemo(() => spinosa.meta?.frameworkVersion)
  const workspaceBannerText = createMemo(() => {
    const workspacePath = spinosa.activePath
    if (!workspacePath || spinosa.genericMode) return undefined
    return workspaceAsciiBannerText(workspacePath)
  })
  const versionLabel = createMemo(() => {
    const parts: string[] = []
    if (bundledVersion()) parts.push(`Spinosa v${bundledVersion()}`)
    if (wsVersion()) parts.push(`workspace v${wsVersion()}`)
    return parts.join(" · ")
  })
  const [maintenanceChecksStarted, setMaintenanceChecksStarted] = createSignal(false)
  const [maintenance, { refetch: refetchMaintenance }] = createResource(
    maintenanceChecksStarted,
    async (started) => (started ? inspectSpinosaMaintenance().catch(() => undefined) : undefined),
  )
  const [maintenanceAction, setMaintenanceAction] = createSignal<"idle" | "cleaning" | "repairing">("idle")
  const maintenanceCleanupAvailable = createMemo(() => {
    const status = safeResourceValue(maintenance)
    if (!status) return false
    return status.staleInstallDirectories.length + status.staleTempDirectories.length > 0
  })
  const maintenanceStaleCount = createMemo(() => {
    const status = safeResourceValue(maintenance)
    if (!status) return 0
    return status.staleInstallDirectories.length + status.staleTempDirectories.length
  })
  const maintenanceRepairRequired = createMemo(() => safeResourceValue(maintenance)?.dependencyRepairRequired === true)
  const compactMaintenanceCue = createMemo(() =>
    formatCompactMaintenanceCue({
      staleCount: maintenanceStaleCount(),
      repairRequired: maintenanceRepairRequired(),
    }),
  )

  onMount(() => {
    const timer = setTimeout(() => setMaintenanceChecksStarted(true), MAINTENANCE_CHECK_DELAY_MS)
    onCleanup(() => clearTimeout(timer))
    void loadRecentWorkspaces()
  })

  const toast = useToast()
  const cleanStaleInstallerData = async () => {
    if (maintenanceAction() !== "idle") return
    const status = safeResourceValue(maintenance)
    const listed = formatMaintenanceStalePaths(
      status?.staleInstallDirectories ?? [],
      status?.staleTempDirectories ?? [],
    )
    const confirmed = await DialogConfirm.show(
      dialog,
      "Clean up leftover install files",
      listed.message,
    )
    if (!confirmed) return

    setMaintenanceAction("cleaning")
    try {
      const result = await cleanupStaleInstallDirectories()
      if (result.installInProgress) {
        toast.show({ variant: "info", message: "Cleanup skipped because a Spinosa install is in progress." })
      } else if (result.removedDirectories.length > 0) {
        toast.show({ variant: "success", message: "Removed stale Spinosa installer files." })
      }
      await refetchMaintenance()
    } catch (error) {
      toast.show({ variant: "error", message: error instanceof Error ? error.message : String(error) })
    } finally {
      setMaintenanceAction("idle")
    }
  }
  const repairDependencies = async () => {
    if (maintenanceAction() !== "idle") return
    const bundled = bundledVersion()
    if (!bundled) {
      toast.show({ variant: "error", message: formatRepairVersionUnknownMessage() })
      return
    }
    const confirmed = await DialogConfirm.show(
      dialog,
      "Reinstall Spinosa runtime",
      "Reinstall the files Spinosa needs to run? This can take a few minutes. Restart Spinosa when it finishes.",
    )
    if (!confirmed) return

    setMaintenanceAction("repairing")
    const channel: ReleaseChannel = isPrereleaseFrameworkVersion(bundled) ? "beta" : "stable"
    const job = createImportJob({ kind: "upgrade", title: "Repair dependencies" })
    job.start()
    toast.show({ variant: "info", message: "Repairing Spinosa runtime…" })
    try {
      const result = await upgradeFramework({ channel, version: bundled, reinstall: true, yes: true, suppressInstallOutput: true })
      if (!result.success) {
        job.finish("error", "Dependency repair failed")
        toast.show({ variant: "error", message: "Dependency repair failed." })
        return
      }
      if (job.shouldAbort()) {
        toast.show({ variant: "info", message: "Dependency repair cancelled." })
        return
      }
      job.finish("completed")
      toast.show({ variant: "success", message: "Dependencies repaired. Restart Spinosa to use the repaired runtime." })
      await refetchMaintenance()
    } catch (error) {
      if (job.shouldAbort()) {
        toast.show({ variant: "info", message: "Dependency repair cancelled." })
        return
      }
      job.finish("error", error instanceof Error ? error.message : String(error))
      toast.show({ variant: "error", message: error instanceof Error ? error.message : String(error) })
    } finally {
      setMaintenanceAction("idle")
    }
  }
  const placeholders = createMemo(() => {
    if (spinosa.meta && !spinosa.genericMode && spinosa.meta.setupStatus === "workspace_started") {
      return spinosaPlaceholder
    }
    return defaultPlaceholder
  })

  const promptMaxWidth = createMemo(() => {
    const configured = tuiConfig.prompt?.max_width
    if (configured === "auto") return MAIN_CONTENT_MAX_WIDTH
    return configured ?? MAIN_CONTENT_MAX_WIDTH
  })

  let sent = false
  let once = false
  let lastRoutePromptKey: string | undefined
  let lastStartupHintKey: string | undefined
  let providerPromptRequested = false

  onMount(() => {
    editor.clearSelection()
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (startupPrompt()) return
    if (!args.prompt) return
    r.set({ input: args.prompt, parts: [] })
    once = true
  }

  // Set route prompt and auto-submit if flagged
  createEffect(() => {
    const r = ref()
    const prompt = startupPrompt()
    if (!r || !prompt) return
    // Queued / routed startup briefs always run as the orchestrator.
    local.agent.set(ORCHESTRATOR_AGENT_ID)
    r.set({ ...prompt, forceAgent: prompt.forceAgent ?? ORCHESTRATOR_AGENT_ID })

    if (!prompt.autoSubmit && startupPromptIsQueued()) {
      const hintKey = JSON.stringify({ input: prompt.input, parts: prompt.parts })
      if (lastStartupHintKey !== hintKey) {
        lastStartupHintKey = hintKey
      }
    }
  })

  // A queued workspace prompt always needs a usable model. Reuse the native
  // connect → model flow, then leave the prompt in place for the user.
  createEffect(() => {
    if (!startupPrompt() || providerConnected() || providerPromptRequested) return
    providerPromptRequested = true
    if (dialog.stack.length > 0) return
    dialog.replace(() => <DialogProvider />)
  })

  // Auto-submit route prompt once the prompt, sync, and model state are ready.
  createEffect(() => {
    const r = ref()
    const prompt = startupPrompt()
    if (!r || !prompt?.autoSubmit) return
    if (!sync.ready || !local.model.ready) return
    if (r.current.input !== prompt.input) return

    const promptKey = JSON.stringify({
      input: prompt.input,
      parts: prompt.parts,
      autoSubmit: prompt.autoSubmit,
    })
    if (lastRoutePromptKey === promptKey) return
    lastRoutePromptKey = promptKey
    if (startupPromptIsQueued()) spinosa.consumePendingPrompt()

    setTimeout(() => r.submit(), 0)
  })

  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (r.current.input !== args.prompt) return
    sent = true
    r.submit()
  })

  const launchRecentWorkspace = async (workspacePath: string) => {
    const launch = await getWorkspaceLaunchDecision(workspacePath)
    if (launch.type === "startup-choice") {
      dialog.replace(() => (
        <DialogSpinosaStartupChoice
          workspacePath={launch.workspacePath}
          workspaceName={launch.workspaceName}
          prompt={launch.prompt}
          onBack={() => dialog.clear()}
        />
      ))
      return
    }
    await spinosa.openWorkspace(workspacePath)
  }

  const openMissingRecentWorkspace = (workspace: RecentWorkspace) => {
    const escapeRef = { current: () => dialog.clear() }
    dialog.replace(
      () => (
        <DialogSpinosaMissingWorkspace
          workspacePath={workspace.path}
          workspaceName={workspace.name}
          workspaceID={workspace.workspaceID}
          onRegisterEscape={(handler) => {
            escapeRef.current = () => {
              handler()
            }
          }}
          onBack={() => dialog.clear()}
          onRemoved={async () => {
            dialog.clear()
            await loadRecentWorkspaces()
          }}
          onRecovered={async (workspacePath) => {
            dialog.clear()
            await loadRecentWorkspaces()
            await launchRecentWorkspace(workspacePath)
          }}
        />
      ),
      undefined,
      () => escapeRef.current(),
    )
  }

  const pickRecentWorkspace = async (workspace: RecentWorkspace) => {
    if (!providerConnected()) {
      dialog.replace(() => <DialogProvider />)
      return
    }
    if (!workspace.available) {
      openMissingRecentWorkspace(workspace)
      return
    }
    const presence = inspectWorkspacePresence({
      workspacePath: workspace.path,
      workspaceID: workspace.workspaceID,
    })
    if (!isUsableWorkspaceStatus(presence.status)) {
      openMissingRecentWorkspace(workspace)
      return
    }
    await launchRecentWorkspace(workspace.path)
  }

  const recentListVisible = createMemo(
    () => providerConnected() && !workspaceReady() && !recentLoading() && recentWorkspaces().length > 0,
  )
  const recentVisibleCount = createMemo(() =>
    Math.min(recentWorkspaces().length, recentDisplayCap(compactLayout())),
  )

  createEffect(() => {
    const max = Math.max(0, recentVisibleCount() - 1)
    if (selectedRecent() > max) setSelectedRecent(max)
  })

  useBindings(() => ({
    mode: SPINOSA_BASE_MODE,
    enabled: () => recentListVisible() && !promptRef.current?.focused && dialog.stack.length === 0,
    bindings: [
      {
        key: "Up",
        desc: "Previous recent workspace",
        group: "Home",
        cmd: () => setSelectedRecent((value) => Math.max(0, value - 1)),
      },
      {
        key: "Down",
        desc: "Next recent workspace",
        group: "Home",
        cmd: () => setSelectedRecent((value) => Math.min(recentVisibleCount() - 1, value + 1)),
      },
      {
        key: "Enter",
        desc: "Open selected recent workspace",
        group: "Home",
        cmd: () => {
          const workspace = recentWorkspaces().slice(0, recentVisibleCount())[selectedRecent()]
          if (workspace) void pickRecentWorkspace(workspace)
        },
      },
    ],
  }))

  return (
    <HomeSessionDestinationProvider>
      <CenteredColumn>
        <box flexGrow={1} height="100%" minHeight={0} flexDirection="column" alignItems="center" paddingLeft={2} paddingRight={2}>
          <box flexGrow={1} minHeight={0} />
          <Show when={compactLayout() && compactMaintenanceCue()}>
            <box width="100%" maxWidth={promptMaxWidth()} flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
              <text fg={theme.warning}>{compactMaintenanceCue()}</text>
              <Show when={maintenanceCleanupAvailable()}>
                <box
                  paddingX={1}
                  backgroundColor={theme.backgroundElement}
                  onMouseDown={() => void cleanStaleInstallerData()}
                >
                  <text fg={theme.primary}>{maintenanceAction() === "cleaning" ? "Cleaning…" : "Clean up"}</text>
                </box>
              </Show>
              <Show when={maintenanceRepairRequired()}>
                <box
                  paddingX={1}
                  backgroundColor={theme.backgroundElement}
                  onMouseDown={() => void repairDependencies()}
                >
                  <text fg={theme.primary}>{maintenanceAction() === "repairing" ? "Reinstalling…" : "Repair"}</text>
                </box>
              </Show>
            </box>
            <box height={1} />
          </Show>
          <Show when={!compactLayout()}>
            <box height={4} minHeight={0} flexShrink={1} />
          </Show>
          <Show when={!compactLayout()}>
          <box flexShrink={0} alignItems="center" flexDirection="column">
            <Show when={versionLabel()}>
              <text fg={theme.textMuted}>{versionLabel()}</text>
              <box height={1} />
            </Show>
            <Show when={safeResourceValue(maintenance)?.installInProgress}>
              <text fg={theme.textMuted}>Maintenance checks will resume when this installation finishes.</text>
              <box height={1} />
            </Show>
            <Show when={maintenanceCleanupAvailable()}>
              <box flexDirection="column" alignItems="center" gap={0}>
                <box flexDirection="row" alignItems="center" gap={1}>
                  <text fg={theme.warning}>
                    Spinosa found {maintenanceStaleCount()} leftover install/temp path
                    {maintenanceStaleCount() === 1 ? "" : "s"}.
                  </text>
                  <box
                    paddingX={1}
                    backgroundColor={theme.backgroundElement}
                    onMouseDown={() => void cleanStaleInstallerData()}
                  >
                    <text fg={theme.primary}>{maintenanceAction() === "cleaning" ? "Cleaning…" : "Clean up"}</text>
                  </box>
                </box>
                <For each={[
                  ...(safeResourceValue(maintenance)?.staleInstallDirectories ?? []),
                  ...(safeResourceValue(maintenance)?.staleTempDirectories ?? []),
                ].slice(0, 3)}>
                  {(path) => <text fg={theme.textMuted}>{truncatePathTail(path, 64)}</text>}
                </For>
                <Show when={maintenanceStaleCount() > 3}>
                  <text fg={theme.textMuted}>…and {maintenanceStaleCount() - 3} more (listed in Clean up)</text>
                </Show>
              </box>
              <box height={1} />
            </Show>
            <Show when={maintenanceRepairRequired()}>
              <box flexDirection="row" alignItems="center" gap={1}>
                <text fg={theme.warning}>Spinosa’s runtime is incomplete or damaged.</text>
                <box
                  paddingX={1}
                  backgroundColor={theme.backgroundElement}
                  onMouseDown={() => void repairDependencies()}
                >
                  <text fg={theme.primary}>{maintenanceAction() === "repairing" ? "Reinstalling…" : "Reinstall runtime"}</text>
                </box>
              </box>
              <box height={1} />
            </Show>
            <Show when={maintenance.error}>
              <text fg={theme.textMuted}>Couldn’t check Spinosa’s health. Try again later.</text>
              <box height={1} />
            </Show>
            <pluginRuntime.Slot name="home_logo" mode="replace">
              <Show when={workspaceBannerText()} fallback={<Logo />}>
                {(banner) => (
                  <ascii_font
                    text={banner()}
                    font="block"
                    color={theme.text}
                    selectable={false}
                  />
                )}
              </Show>
            </pluginRuntime.Slot>
          </box>
          <box height={1} minHeight={0} flexShrink={1} />
          </Show>

          {/* recent workspaces (global home only) */}
          <Show when={providerConnected() && !workspaceReady() && recentLoading()}>
            <text fg={theme.textMuted}>Loading recent workspaces…</text>
            <box height={1} />
          </Show>
          <Show when={providerConnected() && !workspaceReady() && !recentLoading() && recentLoadError()}>
            <text fg={theme.warning} wrapMode="word">{recentLoadError()}</text>
            <box height={1} />
          </Show>
          <Show when={providerConnected() && !workspaceReady() && !recentLoading() && recentWorkspaces().length > 0}>
            <box width="100%" maxWidth={promptMaxWidth()} flexDirection="column" flexShrink={0}>
              <text fg={theme.textMuted}>
                {formatRecentWorkspacesLabel(recentTotal(), recentDisplayCap(compactLayout()))}
              </text>
              <box height={1} />
              <For each={recentWorkspaces().slice(0, recentVisibleCount())}>
                {(ws, i) => {
                  const idx = i()
                  const active = () => selectedRecent() === idx
                  const lostLabel = () => {
                    const label = workspacePresenceLabel(ws.presence)
                    if (label === "NON EXISTENT") return "Not found"
                    return label ?? "Not found"
                  }
                  return (
                    <box
                      paddingLeft={2}
                      paddingRight={2}
                      paddingTop={1}
                      paddingBottom={1}
                      backgroundColor={buttonBackground(theme, active())}
                      border={["left"]}
                      borderColor={buttonBorder(theme, active(), ws.available ? theme.borderActive : theme.error)}
                      flexDirection="column"
                      gap={0}
                      onMouseOver={() => setSelectedRecent(idx)}
                      onMouseDown={() => { setSelectedRecent(idx); void pickRecentWorkspace(ws) }}
                    >
                      <box flexDirection="row" gap={1}>
                        <text fg={buttonText(theme, active(), ws.available ? recentStatusColor(ws.status, theme) : theme.error)}>
                          {ws.available ? "●" : "✕"}
                        </text>
                        <text fg={buttonText(theme, active(), ws.available ? theme.text : theme.error)}>
                          <span style={{ bold: active() }}>{ws.name}</span>
                        </text>
                        <Show when={ws.available}>
                          <text fg={buttonText(theme, active(), theme.textMuted)}>{ws.fileCount} files</text>
                          <text fg={buttonText(theme, active(), recentStatusColor(ws.status, theme))}>{setupStatusLabel(ws.status)}</text>
                        </Show>
                        <Show when={!ws.available}>
                          <text fg={buttonText(theme, active(), theme.error)}>{lostLabel()}</text>
                        </Show>
                      </box>
                      <text fg={buttonText(theme, active(), theme.textMuted)}>{truncatePathTail(ws.path, 56)}</text>
                    </box>
                  )
                }}
              </For>
            </box>
            <box height={1} />
          </Show>

          <box width="100%" maxWidth={promptMaxWidth()} zIndex={1000} paddingTop={1} flexShrink={0}>
            <SpinosaPromptChips suppressEnter={recentListVisible()} />
            <Show when={providerConnected() && workspaceReady()}>
              <box>
                <pluginRuntime.Slot name="home_prompt" mode="replace" ref={bind}>
                  <Prompt
                    ref={bind}
                    disabled={false}
                    right={<pluginRuntime.Slot name="home_prompt_right" />}
                    placeholders={placeholders()}
                  />
                </pluginRuntime.Slot>
              </box>
            </Show>
          </box>
          <pluginRuntime.Slot name="home_bottom" />
          <box flexGrow={1} minHeight={0} />
          <box height={1} />
          <box width="100%" maxWidth={promptMaxWidth()}>
            <HomeFooter />
          </box>
        </box>
      </CenteredColumn>
    </HomeSessionDestinationProvider>
  )
}
