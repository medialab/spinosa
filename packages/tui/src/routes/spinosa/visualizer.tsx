import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { CenteredColumn } from "../../component/centered-column"
import { useRoute } from "../../context/route"
import { useSDK } from "../../context/sdk"
import { useSpinosaWorkspace } from "../../context/spinosa-workspace"
import { useTheme } from "../../context/theme"
import { WaveSpinner } from "../../component/wave-spinner"
import { SPINOSA_BASE_MODE, useBindings } from "../../keymap"
import { listRegisteredWorkspaces, readWorkspaceMeta } from "../../spinosa/service"
import { setupStatusThemeKey } from "../../spinosa/status-labels"
import type { SpinosaSetupStatus } from "../../spinosa/types"
import { resolveWorkspaceDisplayName } from "../../spinosa/workspace-name"
import { DialogSelect } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { useToast } from "../../ui/toast"
import { buttonBackground, buttonBorder, buttonText } from "../../util/button"
import { errorMessage } from "../../util/error"
import { DialogToolDetail } from "./dialog-tool-detail"
import { GraphCanvas, type GraphCanvasHandle } from "./visualizer-graph-canvas"
import { aggregateFileUsage, type WorkspaceFile } from "./visualizer-graph-data"
import { exportGraphScene, type GraphExportFormat } from "./visualizer-graph-export"
import { GraphInspector } from "./visualizer-graph-inspector"
import { buildGraphScene, type GraphHit, type GraphMode } from "./visualizer-graph-layout"
import {
  loadSelectedSessionTree,
  loadWorkspaceFileInventory,
  VisualizerGraphLoadError,
  type SessionTreeCoverage,
  type VisualizerGraphClient,
  type VisualizerSession,
  type WorkspaceFileCoverage,
} from "./visualizer-graph-loader"
import { buildVisualizerGraphModel, type VisualizerGraphScopeCoverage } from "./visualizer-graph-model"
import type { ToolCallRecord } from "./visualizer-types"

type WorkspaceInfo = {
  path: string
  name: string
  status: SpinosaSetupStatus
}

type LoadLifecycle = "idle" | "loading" | "ready" | "error"

type FileLoadState = {
  status: LoadLifecycle
  files: WorkspaceFile[]
  coverage?: WorkspaceFileCoverage
  error?: string
}

type CallLoadState = {
  status: LoadLifecycle
  calls: ToolCallRecord[]
  sessions: VisualizerSession[]
  scope: VisualizerGraphScopeCoverage
  coverage?: SessionTreeCoverage
  error?: string
}

const MODES: readonly { value: GraphMode; label: string }[] = [
  { value: "files", label: "1 Files" },
  { value: "flow", label: "2 Flow" },
  { value: "activity", label: "3 Activity" },
]

const MAX_WIDTH = 136
const MIN_WIDTH = 48
const MIN_HEIGHT = 16

export function Visualizer() {
  const { theme } = useTheme()
  const route = useRoute()
  const dialog = useDialog()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const spinosa = useSpinosaWorkspace()
  const sdk = useSDK()
  const graphClient = sdk.client as unknown as VisualizerGraphClient

  const [workspace, setWorkspace] = createSignal<WorkspaceInfo>()
  const [session, setSession] = createSignal<VisualizerSession>()
  const [fileLoad, setFileLoad] = createSignal<FileLoadState>({ status: "idle", files: [] })
  const [callLoad, setCallLoad] = createSignal<CallLoadState>({
    status: "idle",
    calls: [],
    sessions: [],
    scope: { scope: "loaded-calls" },
  })
  const [mode, setMode] = createSignal<GraphMode>("files")
  const [hovered, setHovered] = createSignal<GraphHit>()
  const [selected, setSelected] = createSignal<GraphHit>()
  let graph: GraphCanvasHandle | undefined
  let workspaceRequest = 0
  let sessionRequest = 0

  const fileGraph = createMemo(() =>
    aggregateFileUsage(workspace()?.path ?? "/", fileLoad().files, callLoad().calls),
  )
  const graphModel = createMemo(() =>
    buildVisualizerGraphModel({
      calls: callLoad().calls,
      fileGraph: fileGraph(),
      workspaceRoot: workspace()?.path ?? "/",
      coverage: callLoad().scope,
    }),
  )
  const scene = createMemo(() => buildGraphScene(mode(), graphModel()))
  const isWide = () => dimensions().width >= 108
  const isShort = () => dimensions().height < 28
  const isTooSmall = () => dimensions().width < MIN_WIDTH || dimensions().height < MIN_HEIGHT
  const canvasHeight = () => Math.max(10, dimensions().height - 13)

  const resetInspection = () => {
    setHovered(undefined)
    setSelected(undefined)
    graph?.clearSelection()
  }

  const scanWorkspace = async (target: WorkspaceInfo) => {
    const request = ++workspaceRequest
    setFileLoad({ status: "loading", files: [] })
    try {
      const result = await loadWorkspaceFileInventory(graphClient, target.path)
      if (request !== workspaceRequest || workspace()?.path !== target.path) return
      setFileLoad({ status: "ready", files: result.files, coverage: result.coverage })
    } catch (error) {
      if (request !== workspaceRequest || workspace()?.path !== target.path) return
      setFileLoad({ status: "error", files: [], error: graphLoadMessage(error) })
    }
  }

  const loadSession = async (target: VisualizerSession, targetWorkspace = workspace()) => {
    if (!targetWorkspace) return
    const request = ++sessionRequest
    resetInspection()
    setCallLoad({
      status: "loading",
      calls: [],
      sessions: [],
      scope: { scope: "selected-tree", rootSessionID: target.id },
    })
    try {
      const result = await loadSelectedSessionTree(graphClient, target, { directory: targetWorkspace.path })
      if (request !== sessionRequest || workspace()?.path !== targetWorkspace.path) return
      setCallLoad({
        status: "ready",
        calls: result.toolCalls,
        sessions: result.sessions,
        coverage: result.coverage,
        scope: scopeFromCoverage(result.coverage),
      })
    } catch (error) {
      if (request !== sessionRequest || workspace()?.path !== targetWorkspace.path) return
      setCallLoad({
        status: "error",
        calls: [],
        sessions: [],
        scope: scopeFromError(error, target.id),
        error: graphLoadMessage(error),
      })
    }
  }

  const selectWorkspace = (target: WorkspaceInfo) => {
    sessionRequest++
    setWorkspace(target)
    setSession(undefined)
    setCallLoad({ status: "idle", calls: [], sessions: [], scope: { scope: "loaded-calls" } })
    setMode("files")
    resetInspection()
    void scanWorkspace(target)
  }

  onMount(() => {
    const initial = route.data.type === "visualizer" ? route.data : undefined
    const workspacePath = initial?.workspacePath ?? (spinosa.genericMode ? undefined : spinosa.activePath)
    if (!workspacePath) return

    void (async () => {
      const meta = await readWorkspaceMeta(workspacePath).catch(() => undefined)
      if (!meta) return
      const target: WorkspaceInfo = {
        path: workspacePath,
        name: resolveWorkspaceDisplayName(workspacePath, meta.projectName ?? ""),
        status: meta.setupStatus,
      }
      setWorkspace(target)
      void scanWorkspace(target)

      try {
        const result = await sdk.client.session.list({ roots: true, limit: 50, directory: workspacePath })
        if (result.error) throw result.error
        const roots = [...(result.data ?? [])].sort((a, b) => b.time.updated - a.time.updated)
        const requested = initial?.sessionID
        const picked = requested
          ? roots.find((item) => item.id === requested) ?? { id: requested, title: requested }
          : roots[0]
        if (!picked || workspace()?.path !== workspacePath) return
        const selectedRoot: VisualizerSession = { id: picked.id, title: picked.title }
        if ("parentID" in picked) selectedRoot.parentID = picked.parentID
        setSession(selectedRoot)
        await loadSession(selectedRoot, target)
      } catch (error) {
        setCallLoad({
          status: "error",
          calls: [],
          sessions: [],
          scope: { scope: "selected-tree", rootSessionID: initial?.sessionID },
          error: `Couldn’t list sessions: ${errorMessage(error)}`,
        })
      }
    })()
  })

  onCleanup(() => {
    workspaceRequest++
    sessionRequest++
  })

  const openWorkspacePicker = async () => {
    const registered = await listRegisteredWorkspaces()
    const options: {
      value: WorkspaceInfo
      title: string
      description?: string
      gutter?: () => JSX.Element
    }[] = []
    for (const item of registered) {
      const meta = await readWorkspaceMeta(item.path).catch(() => undefined)
      if (!meta) continue
      const name = resolveWorkspaceDisplayName(item.path, meta.projectName ?? item.projectName)
      options.push({
        value: { path: item.path, name, status: meta.setupStatus },
        title: name,
        gutter: () => (
          <text fg={theme[setupStatusThemeKey(meta.setupStatus)]} attributes={TextAttributes.BOLD}>●</text>
        ),
      })
    }
    dialog.replace(() => (
      <DialogSelect
        title="Choose a workspace"
        options={options}
        onSelect={(option) => {
          dialog.clear()
          selectWorkspace(option.value)
        }}
      />
    ))
  }

  const openSessionPicker = async () => {
    const targetWorkspace = workspace()
    if (!targetWorkspace) return
    try {
      const result = await sdk.client.session.list({ roots: true, limit: 50, directory: targetWorkspace.path })
      if (result.error) throw result.error
      const roots = [...(result.data ?? [])].sort((a, b) => b.time.updated - a.time.updated)
      if (roots.length === 0) {
        toast.show({ variant: "info", message: "No conversation sessions found in this workspace." })
        return
      }
      dialog.setSize("large")
      dialog.replace(() => (
        <DialogSelect
          title="Choose a session tree"
          options={roots.map((item) => ({
            value: { id: item.id, title: item.title, parentID: item.parentID },
            title: item.title,
            description: `Includes descendants · updated ${new Date(item.time.updated).toLocaleDateString()}`,
            category: "Latest 50 roots",
          }))}
          onSelect={(option) => {
            dialog.clear()
            setSession(option.value)
            void loadSession(option.value, targetWorkspace)
          }}
        />
      ))
    } catch (error) {
      toast.show({ variant: "error", message: `Couldn’t list sessions: ${errorMessage(error)}` })
    }
  }

  const activate = (hit: GraphHit) => {
    if (hit.kind !== "call") return
    const id = hit.id.startsWith("call:") ? hit.id.slice(5) : hit.id
    const call = callLoad().calls.find((item) => item.id === id)
    if (!call || !("type" in call.part) || call.part.type !== "tool") return
    dialog.replace(() => <DialogToolDetail part={call.part} workdir={workspace()?.path} />)
  }

  const exportCurrentGraph = async (format: GraphExportFormat) => {
    const targetWorkspace = workspace()
    if (!targetWorkspace) return
    const suffix = format
    const sessionName = session()?.title ?? targetWorkspace.name
    const defaultName = `spinosa-${mode()}-${slug(sessionName)}.${suffix}`
    const requested = await DialogPrompt.show(dialog, "Export graph", {
      value: defaultName,
      description: () => <text fg={theme.textMuted}>Exports workspace-relative paths only.</text>,
    })
    dialog.clear()
    if (!requested?.trim()) return

    let filename = path.basename(requested.trim())
    if (!filename || filename === "." || filename === "..") filename = defaultName
    if (!filename.toLowerCase().endsWith(`.${suffix}`)) filename += `.${suffix}`
    const directory = path.join(homedir(), "Downloads")
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, filename), exportGraphScene(scene(), format))
      toast.show({ variant: "success", message: `Graph exported to ~/Downloads/${filename}` })
    } catch (error) {
      toast.show({ variant: "error", message: `Graph export failed: ${errorMessage(error)}` })
    }
  }

  const openExport = () => {
    if (!workspace()) return
    const options: { value: GraphExportFormat; title: string; description: string }[] = [
      { value: "svg", title: "SVG", description: "Full vector graph" },
      { value: "csv", title: "CSV", description: "Plotted tabular data" },
      { value: "json", title: "JSON", description: "Versioned derived graph model" },
    ]
    dialog.replace(() => (
      <DialogSelect
        title="Export graph"
        options={options}
        onSelect={(option) => {
          dialog.clear()
          void exportCurrentGraph(option.value)
        }}
      />
    ))
  }

  const openHelp = () => dialog.replace(() => <GraphHelp />)

  useBindings(() => ({
    mode: SPINOSA_BASE_MODE,
    enabled: () => dialog.stack.length === 0,
    bindings: [
      ...MODES.map((item, index) => ({
        key: String(index + 1),
        desc: `Show ${item.value} graph`,
        group: "Visualizer",
        cmd: () => setMode(item.value),
      })),
      { key: "+", desc: "Zoom in", group: "Visualizer", cmd: () => graph?.zoom(1.2) },
      { key: "=", desc: "Zoom in", group: "Visualizer", cmd: () => graph?.zoom(1.2) },
      { key: "-", desc: "Zoom out", group: "Visualizer", cmd: () => graph?.zoom(1 / 1.2) },
      { key: "0", desc: "Fit graph", group: "Visualizer", cmd: () => graph?.fit() },
      { key: "Left", desc: "Previous mark", group: "Visualizer", cmd: () => graph?.selectNext(-1) },
      { key: "Right", desc: "Next mark", group: "Visualizer", cmd: () => graph?.selectNext(1) },
      { key: "shift+Left", desc: "Pan left", group: "Visualizer", cmd: () => graph?.pan(3, 0) },
      { key: "shift+Right", desc: "Pan right", group: "Visualizer", cmd: () => graph?.pan(-3, 0) },
      { key: "shift+Up", desc: "Pan up", group: "Visualizer", cmd: () => graph?.pan(0, 2) },
      { key: "shift+Down", desc: "Pan down", group: "Visualizer", cmd: () => graph?.pan(0, -2) },
      { key: "Enter", desc: "Inspect mark", group: "Visualizer", cmd: () => graph?.activateSelected() },
      {
        key: "Escape",
        desc: "Clear or go back",
        group: "Visualizer",
        cmd: () => {
          if (selected()) return resetInspection()
          route.navigate({ type: "global" })
        },
      },
      { key: "e", desc: "Export graph", group: "Visualizer", cmd: openExport },
      { key: "?", desc: "Graph controls", group: "Visualizer", cmd: openHelp },
    ],
  }))

  const stateMessage = () => {
    if (!workspace()) return "Choose a workspace to map its files."
    if (mode() === "files") {
      if (fileLoad().status === "loading") return "Scanning workspace files…"
      if (fileLoad().status === "error") return `Couldn’t scan workspace files: ${fileLoad().error}`
      if (fileLoad().status === "idle") return "Choose a workspace to map its files."
      return
    }
    if (callLoad().status === "loading") return "Loading session trace…"
    if (callLoad().status === "error") return `Couldn’t load session trace: ${callLoad().error}`
    if (callLoad().status === "idle") return "Choose a session to load its trace."
    if (callLoad().calls.length === 0) return "No tool calls in this session tree. File inventory is still available."
    return
  }

  const statusText = () => {
    const status = graphModel().status
    const fileSuffix = fileLoad().status === "ready" ? ` · ${status.observedFiles}/${status.totalFiles} files observed` : ""
    return `${status.calls} calls · ${status.errors} errors${fileSuffix} · ${status.scope}`
  }

  return (
    <CenteredColumn maxWidth={MAX_WIDTH}>
      <box width="100%" flexGrow={1} minHeight={0} flexDirection="column" paddingX={1}>
        <box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
          <ActionButton label="< Back" onClick={() => route.navigate({ type: "global" })} />
          <text fg={theme.text}><span style={{ bold: true }}>Conversation graphs</span></text>
          <ActionButton label="⇩ Export" accent onClick={openExport} disabled={!workspace()} />
        </box>

        <Show
          when={!isTooSmall()}
          fallback={
            <box flexGrow={1} alignItems="center" justifyContent="center">
              <text fg={theme.warning}>Visualizer needs at least 48×16. Resize the terminal.</text>
            </box>
          }
        >
          <box height={1} />
          <box
            width="100%"
            height={canvasHeight()}
            minHeight={10}
            minWidth={0}
            flexDirection={isWide() ? "row" : "column"}
            backgroundColor={theme.backgroundPanel}
          >
            <box flexGrow={1} minWidth={0} minHeight={0} padding={1}>
              <Show
                when={!stateMessage()}
                fallback={
                  <box width="100%" height="100%" alignItems="center" justifyContent="center" paddingX={2}>
                    <Show
                      when={fileLoad().status === "loading" || callLoad().status === "loading"}
                      fallback={
                        <text fg={callLoad().status === "error" || fileLoad().status === "error" ? theme.error : theme.textMuted}>
                          {stateMessage()}
                        </text>
                      }
                    >
                      <WaveSpinner color={theme.primary}>{stateMessage()}</WaveSpinner>
                    </Show>
                  </box>
                }
              >
                <GraphCanvas
                  ref={(handle) => (graph = handle)}
                  scene={scene()}
                  width="100%"
                  height="100%"
                  onHoverChange={(hit) => setHovered(hit as GraphHit | undefined)}
                  onSelectionChange={(hit) => setSelected(hit as GraphHit | undefined)}
                  onActivate={(hit) => activate(hit as GraphHit)}
                />
              </Show>
            </box>
            <Show when={!stateMessage() && !isShort()}>
              <GraphInspector scene={scene()} hit={selected() ?? hovered()} compact={!isWide()} />
            </Show>
          </box>

          <box height={1} />
          <box flexDirection="row" width="100%" gap={1}>
            <SelectorButton
              label={`Workspace: ${workspace()?.name ?? "Choose"}`}
              active={!!workspace()}
              onClick={openWorkspacePicker}
            />
            <SelectorButton
              label={`Session: ${session()?.title ?? "Choose"}`}
              active={!!session()}
              disabled={!workspace() || callLoad().status === "loading"}
              onClick={openSessionPicker}
            />
          </box>

          <box height={1} />
          <box flexDirection="row" width="100%" gap={1} alignItems="center">
            <For each={MODES}>
              {(item) => (
                <ModeButton
                  label={item.label}
                  active={mode() === item.value}
                  onClick={() => {
                    setMode(item.value)
                    resetInspection()
                  }}
                />
              )}
            </For>
          </box>

          <box paddingTop={1} width="100%" minHeight={0} flexDirection="column">
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none" overflow="hidden">
              {statusText()}
            </text>
            <Show when={!isShort()}>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none" overflow="hidden">
                {isWide()
                  ? "drag pan · wheel pan · ctrl+wheel zoom · +/− zoom · 0 fit · ←/→ select · enter inspect · ? help"
                  : "drag pan · ctrl+wheel zoom · +/− zoom · 0 fit · ? help"}
              </text>
            </Show>
          </box>
        </Show>
      </box>
    </CenteredColumn>
  )
}

function scopeFromCoverage(coverage: SessionTreeCoverage): VisualizerGraphScopeCoverage {
  return {
    scope: "selected-tree",
    rootSessionID: coverage.rootSessionID,
    sessionsLoaded: coverage.sessionsLoaded,
    sessionsDiscovered: coverage.sessionsDiscovered,
    messagesLoaded: coverage.messagesLoaded,
  }
}

function scopeFromError(error: unknown, rootSessionID: string): VisualizerGraphScopeCoverage {
  const scope: VisualizerGraphScopeCoverage = { scope: "selected-tree", rootSessionID }
  if (!(error instanceof VisualizerGraphLoadError)) return scope
  const coverage = error.coverage
  if ("sessionsLoaded" in coverage) scope.sessionsLoaded = coverage.sessionsLoaded
  if ("sessionsDiscovered" in coverage) scope.sessionsDiscovered = coverage.sessionsDiscovered
  if ("messagesLoaded" in coverage) scope.messagesLoaded = coverage.messagesLoaded
  return scope
}

function graphLoadMessage(error: unknown) {
  if (error instanceof VisualizerGraphLoadError) return error.message
  return errorMessage(error)
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "workspace"
}

function ActionButton(props: { label: string; onClick: () => void; accent?: boolean; disabled?: boolean }) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const activeHover = () => hover() && !props.disabled
  const accent = () => props.accent ? theme.primary : theme.borderActive
  return (
    <box
      flexShrink={0}
      paddingX={1}
      paddingY={1}
      backgroundColor={buttonBackground(theme, activeHover())}
      border={['left']}
      borderColor={props.disabled ? theme.border : buttonBorder(theme, activeHover(), accent())}
      onMouseOver={() => !props.disabled && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={props.disabled ? undefined : props.onClick}
    >
      <text fg={props.disabled ? theme.textMuted : buttonText(theme, activeHover(), props.accent ? theme.primary : theme.text)}>
        <span style={{ bold: activeHover() }}>{props.label}</span>
      </text>
    </box>
  )
}

function SelectorButton(props: { label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const over = () => hover() && !props.disabled
  return (
    <box
      flexGrow={1}
      minWidth={0}
      paddingX={1}
      paddingY={1}
      alignItems="center"
      justifyContent="center"
      backgroundColor={over() ? buttonBackground(theme, true) : props.active ? theme.backgroundElement : undefined}
      border={['left']}
      borderColor={props.disabled ? theme.border : props.active ? theme.success : theme.primary}
      onMouseOver={() => !props.disabled && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={props.disabled ? undefined : props.onClick}
    >
      <text fg={props.disabled ? theme.textMuted : over() ? buttonText(theme, true) : props.active ? theme.success : theme.textMuted} wrapMode="none" overflow="hidden">
        <span style={{ bold: over() || props.active }}>{props.label}{props.active ? " ▼" : ""}</span>
      </text>
    </box>
  )
}

function ModeButton(props: { label: string; active: boolean; onClick: () => void }) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  return (
    <box
      paddingX={1}
      backgroundColor={hover() ? buttonBackground(theme, true) : props.active ? theme.backgroundElement : undefined}
      border={['left']}
      borderColor={props.active ? theme.success : theme.primary}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={props.onClick}
    >
      <text fg={hover() ? buttonText(theme, true) : props.active ? theme.success : theme.textMuted}>
        <span style={{ bold: hover() || props.active }}>{props.label}</span>
      </text>
    </box>
  )
}

function GraphHelp() {
  const { theme } = useTheme()
  return (
    <box paddingX={2} paddingBottom={1} flexDirection="column" gap={1}>
      <text fg={theme.text}><span style={{ bold: true }}>Graph controls</span></text>
      <text fg={theme.textMuted}>Mouse: hover preview · click pin · double-click inspect · drag pan · wheel pan · ctrl+wheel zoom</text>
      <text fg={theme.textMuted}>Keyboard: 1–4 views · ←/→ select · shift+arrows pan · +/− zoom · 0 fit · enter inspect</text>
      <text fg={theme.textMuted}>e export · esc clear selection, then go back</text>
    </box>
  )
}
