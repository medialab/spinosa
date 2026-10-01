import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { Spinner } from "@spinosa/ui/spinner"
import { useTitlebarRightMount } from "@/components/titlebar"
import { Portal } from "solid-js/web"
import { graphHitTest, graphScreenPoint, graphWorldPoint, paintRawWorkspaceGraph } from "./raw-workspace-graph-canvas"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { clusterRawWorkspaceGraph, DEFAULT_GRAPH_FORCES, layoutRawWorkspaceGraph } from "./raw-workspace-graph-layout"
import { loadRawWorkspaceGraph, type RawGraphClient, type RawWorkspaceGraph } from "./raw-workspace-graph"
import { filterRawWorkspaceGraph, graphSettingsNeedFullPane, incomingDegreeByPath } from "./raw-workspace-graph-view"

const VIEWBOX_WIDTH = 1000
const VIEWBOX_HEIGHT = 680

const EMPTY_GRAPH: RawWorkspaceGraph = { nodes: [], edges: [], unreadable: 0 }
const CLUSTER_COLORS = ["text-[#7488a9]", "text-[#788f94]", "text-[#9588a4]", "text-[#a18e83]"]
const MIN_VIEW_SIZE = 120
const MAX_VIEW_SIZE = 3000
const GRAPH_CACHE_MS = 60_000
const graphCache = new Map<string, { until: number; promise: Promise<RawWorkspaceGraph> }>()

function cachedGraph(client: RawGraphClient, workspacePath: string, refresh = false) {
  const cached = graphCache.get(workspacePath)
  if (!refresh && cached && cached.until > Date.now()) return cached.promise
  const promise = loadRawWorkspaceGraph(client, workspacePath).catch((error) => {
    if (graphCache.get(workspacePath)?.promise === promise) graphCache.delete(workspacePath)
    throw error
  })
  graphCache.set(workspacePath, { until: Date.now() + GRAPH_CACHE_MS, promise })
  if (graphCache.size > 3) graphCache.delete(graphCache.keys().next().value!)
  return promise
}

type Props = {
  workspacePath: () => string
  onOpenFile: (path: string) => void
}

type LoadState = {
  status: "idle" | "loading" | "ready" | "error"
  workspacePath: string
  graph: RawWorkspaceGraph
  hoveredPath?: string
  error?: string
}

type ViewBox = { x: number; y: number; width: number; height: number }

function clusterColor(index: number) {
  return CLUSTER_COLORS[index % CLUSTER_COLORS.length]
}

export function SessionWorkspaceVisualizer(props: Props) {
  const language = useLanguage()
  const sdk = useSDK()
  const titlebarMount = useTitlebarRightMount()
  const [state, setState] = createStore<LoadState>({
    status: "idle",
    workspacePath: "",
    graph: EMPTY_GRAPH,
  })
  const [interaction, setInteraction] = createStore({ dragging: false, settingsOpen: false, settingsFullPane: false,
    contextPath: undefined as string | undefined, contextX: 0, contextY: 0 })
  const [settings, setSettings] = createStore({
    search: "", attachments: true, orphans: true, localPath: undefined as string | undefined, depth: 1,
    labels: 0.55, nodeSize: 1, linkThickness: 1, arrows: false, ...DEFAULT_GRAPH_FORCES,
  })
  const [viewport, setViewport] = createStore<ViewBox>({ x: 0, y: 0, width: VIEWBOX_WIDTH, height: VIEWBOX_HEIGHT })
  let request = 0
  let drag:
    | { pointerId: number; clientX: number; clientY: number; viewport: ViewBox }
    | undefined
  let canvas: HTMLCanvasElement | undefined
  let observer: ResizeObserver | undefined
  let paneObserver: ResizeObserver | undefined
  let paintFrame: number | undefined
  let pressedPath: string | undefined
  const graph = createMemo(() => filterRawWorkspaceGraph(state.graph, settings))
  const clusters = createMemo(() => clusterRawWorkspaceGraph(graph().nodes, graph().edges))
  const points = createMemo(() =>
    layoutRawWorkspaceGraph(graph().nodes, graph().edges, VIEWBOX_WIDTH, VIEWBOX_HEIGHT, clusters(), settings),
  )
  const clusterByPath = createMemo(() => {
    const lookup = new Map<string, { index: number; size: number }>()
    clusters().forEach((cluster, index) =>
      cluster.nodePaths.forEach((path) => lookup.set(path, { index, size: cluster.nodePaths.length })),
    )
    return lookup
  })
  const degreeByPath = createMemo(() => incomingDegreeByPath(graph()))
  const neighbors = createMemo(() => {
    const hovered = state.hoveredPath
    if (!hovered) return
    const related = new Set([hovered])
    for (const edge of graph().edges) {
      if (edge.source === hovered) related.add(edge.target)
      if (edge.target === hovered) related.add(edge.source)
    }
    return related
  })

  const load = async (workspacePath: string, refresh = false) => {
    const current = ++request
    setViewport({ x: 0, y: 0, width: VIEWBOX_WIDTH, height: VIEWBOX_HEIGHT })
    setSettings("localPath", undefined)
    setState({ status: "loading", workspacePath, graph: EMPTY_GRAPH, hoveredPath: undefined, error: undefined })
    try {
      const graph = await cachedGraph(sdk().client as unknown as RawGraphClient, workspacePath, refresh)
      if (current !== request) return
      setState({ status: "ready", workspacePath, graph, hoveredPath: undefined, error: undefined })
    } catch (error) {
      if (current !== request) return
      setState({
        status: "error",
        workspacePath,
        graph: EMPTY_GRAPH,
        hoveredPath: undefined,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  createEffect(() => {
    const workspacePath = props.workspacePath()
    if (!workspacePath || (state.workspacePath === workspacePath && state.status !== "idle")) return
    void load(workspacePath)
  })

  onCleanup(() => {
    request++
    observer?.disconnect()
    paneObserver?.disconnect()
    if (paintFrame !== undefined) cancelAnimationFrame(paintFrame)
  })

  const retry = () => void load(state.workspacePath || props.workspacePath(), true)
  const open = (path: string) => props.onOpenFile(path)
  const hoveredNode = () => graph().nodes.find((node) => node.path === state.hoveredPath)
  const labelThreshold = () => (1.3 - settings.labels) * VIEWBOX_WIDTH * (graph().nodes.length > 500 ? 0.6 : 1)
  const viewBox = () => `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`

  const paintCanvas = () => {
    if (!canvas || state.status !== "ready" || graph().nodes.length <= 500) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.round(rect.width * ratio)
    const height = Math.round(rect.height * ratio)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const style = getComputedStyle(canvas)
    paintRawWorkspaceGraph(ctx, {
      graph: graph(), points: points(), viewport: { ...viewport }, size: { width: rect.width, height: rect.height },
      clusters: clusterByPath(), degrees: degreeByPath(), neighbors: neighbors(), hovered: state.hoveredPath,
      labels: settings.labels, nodeSize: settings.nodeSize, linkThickness: settings.linkThickness, arrows: settings.arrows,
      baseColor: style.color, textColor: style.color,
    })
  }

  createEffect(() => {
    graph()
    points()
    clusterByPath()
    degreeByPath()
    neighbors()
    state.hoveredPath
    settings.labels
    settings.nodeSize
    settings.linkThickness
    settings.arrows
    viewport.x
    viewport.y
    viewport.width
    viewport.height
    if (paintFrame !== undefined) cancelAnimationFrame(paintFrame)
    paintFrame = requestAnimationFrame(() => {
      paintFrame = undefined
      paintCanvas()
    })
  })

  const hitCanvas = (event: PointerEvent | MouseEvent, target: HTMLCanvasElement) => {
    const rect = target.getBoundingClientRect()
    return graphHitTest(graph(), points(), viewport, { width: rect.width, height: rect.height }, event.clientX - rect.left, event.clientY - rect.top)
  }

  const zoomAt = (factor: number, anchorX = viewport.x + viewport.width / 2, anchorY = viewport.y + viewport.height / 2) => {
    const width = Math.min(MAX_VIEW_SIZE, Math.max(MIN_VIEW_SIZE, viewport.width * factor))
    const height = (width * VIEWBOX_HEIGHT) / VIEWBOX_WIDTH
    const ratio = width / viewport.width
    setViewport({
      x: anchorX - (anchorX - viewport.x) * ratio,
      y: anchorY - (anchorY - viewport.y) * ratio,
      width,
      height,
    })
  }

  const onWheel = (event: WheelEvent & { currentTarget: SVGSVGElement | HTMLCanvasElement }) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const anchor = graphWorldPoint(event.clientX - rect.left, event.clientY - rect.top, viewport, { width: rect.width, height: rect.height })
    zoomAt(event.deltaY < 0 ? 0.85 : 1.18, anchor.x, anchor.y)
  }

  const onPointerDown = (event: PointerEvent & { currentTarget: SVGSVGElement | HTMLCanvasElement }) => {
    setInteraction("contextPath", undefined)
    if (event.button !== 0) return
    pressedPath = event.currentTarget instanceof HTMLCanvasElement ? hitCanvas(event, event.currentTarget) : undefined
    if (event.target instanceof Element && event.target.closest("[data-graph-node]")) return
    drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, viewport: { ...viewport } }
    setInteraction("dragging", true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent & { currentTarget: SVGSVGElement | HTMLCanvasElement }) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      if (event.currentTarget instanceof HTMLCanvasElement) {
        const path = hitCanvas(event, event.currentTarget)
        if (state.hoveredPath !== path) setState("hoveredPath", path)
      }
      return
    }
    if (Math.abs(event.clientX - drag.clientX) + Math.abs(event.clientY - drag.clientY) > 4) pressedPath = undefined
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(rect.width / drag.viewport.width, rect.height / drag.viewport.height)
    setViewport({
      x: drag.viewport.x - (event.clientX - drag.clientX) / scale,
      y: drag.viewport.y - (event.clientY - drag.clientY) / scale,
    })
  }

  const onPointerUp = (event: PointerEvent & { currentTarget: SVGSVGElement | HTMLCanvasElement }) => {
    if (drag?.pointerId !== event.pointerId) return
    const openPath = pressedPath && event.currentTarget instanceof HTMLCanvasElement && hitCanvas(event, event.currentTarget) === pressedPath ? pressedPath : undefined
    pressedPath = undefined
    drag = undefined
    setInteraction("dragging", false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (openPath) open(openPath)
  }

  const resetGraph = () => {
    setSettings({ search: "", attachments: true, orphans: true, localPath: undefined, depth: 1,
      labels: 0.55, nodeSize: 1, linkThickness: 1, arrows: false, ...DEFAULT_GRAPH_FORCES })
    setViewport({ x: 0, y: 0, width: VIEWBOX_WIDTH, height: VIEWBOX_HEIGHT })
  }
  const slider = (key: "labels" | "nodeSize" | "linkThickness" | "center" | "repel" | "link" | "distance", label: string) => (
    <label class="flex flex-col gap-1 text-11-regular text-text-weak">
      <span>{label}</span>
      <input type="range" min={key === "labels" ? "0" : "0.1"} max={key === "labels" ? "1" : "2"} step="0.05" value={settings[key]}
        onInput={(event) => setSettings(key, Number(event.currentTarget.value))} class="w-full accent-blue-500" />
    </label>
  )

  return (
    <div
      class="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden w-full"
      data-testid="session-workspace-visualizer"
    >
      <Show when={state.status === "loading"}>
        <div class="flex items-center gap-2 text-13-regular text-text-weak" role="status">
          <Spinner class="size-4" />
          {language.t("common.loading")}
        </div>
      </Show>
      <Show when={state.status === "error"}>
        <div class="flex max-w-md flex-col items-center gap-3 px-6 text-center" role="alert">
          <div class="text-13-regular text-text-weak">
            {language.t("session.visualizer.failed", { message: state.error ?? "" })}
          </div>
          <button
            type="button"
            class="rounded-full border border-border-weak-base px-3 py-1.5 text-12-medium text-text-base transition-colors hover:bg-background-stronger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={retry}
          >
            {language.t("session.visualizer.retry")}
          </button>
        </div>
      </Show>
      <Show when={state.status === "ready" && state.graph.nodes.length === 0}>
        <div class="text-13-regular text-text-weak">{language.t("session.visualizer.empty")}</div>
      </Show>
      <Show when={state.status === "ready" && state.graph.nodes.length > 0}>
        <div class="relative h-full w-full" ref={(element) => {
          paneObserver?.disconnect()
          paneObserver = new ResizeObserver(([entry]) => {
            if (!entry) return
            setInteraction("settingsFullPane", graphSettingsNeedFullPane(entry.contentRect.width, entry.contentRect.height))
          })
          paneObserver.observe(element)
        }}>
          <Show when={titlebarMount()} keyed>{(mount) => <Portal mount={mount}>
          <button type="button" class="flex size-8 shrink-0 items-center justify-center rounded-full text-16-medium text-text-base motion-safe:transition-colors hover:bg-background-stronger"
            aria-label={language.t("session.visualizer.settings")} title={language.t("session.visualizer.settings")}
            aria-expanded={interaction.settingsOpen} onClick={() => setInteraction("settingsOpen", !interaction.settingsOpen)}>⚙</button>
          </Portal>}</Show>
          <Show when={interaction.settingsOpen}>
            <aside
              class="absolute z-20 flex min-h-0 flex-col gap-3 overflow-y-auto border border-border-weak-base bg-background-base p-4 shadow-lg"
              classList={{
                "inset-0 h-full w-full": interaction.settingsFullPane,
                "right-4 top-2 max-h-[calc(100%_-_5rem)] w-64 rounded-xl": !interaction.settingsFullPane,
              }}
              aria-label={language.t("session.visualizer.settings")}
            >
              <div class="flex items-center justify-between text-12-medium text-text-base"><span>{language.t("session.visualizer.settings")}</span>
                <div class="flex gap-2"><button type="button" class="text-11-regular text-text-weak hover:text-text-base" onClick={retry}>{language.t("session.visualizer.refresh")}</button>
                <button type="button" class="text-11-regular text-text-weak hover:text-text-base" onClick={resetGraph}>{language.t("common.reset")}</button>
                <button type="button" class="text-11-regular text-text-weak hover:text-text-base" onClick={() => setInteraction("settingsOpen", false)}>{language.t("common.close")}</button></div></div>
              <label class="flex flex-col gap-1 text-11-regular text-text-weak"><span>{language.t("session.visualizer.search")}</span>
                <input type="search" value={settings.search} onInput={(event) => setSettings("search", event.currentTarget.value)}
                  class="rounded-md border border-border-weak-base bg-background-base px-2 py-1.5 text-12-regular text-text-base" /></label>
              <Show when={graph().nodes.length === 1 && !settings.localPath}>
                <button type="button" class="rounded-md border border-border-weak-base px-2 py-1 text-11-medium text-text-base hover:bg-background-stronger"
                  onClick={() => { setSettings("localPath", graph().nodes[0]!.path); setSettings("search", "") }}>
                  {language.t("session.visualizer.openLocal")}
                </button>
              </Show>
              <div class="border-t border-border-weak-base pt-2 text-11-medium text-text-base">{language.t("session.visualizer.filters")}</div>
              <label class="flex items-center gap-2 text-11-regular text-text-base"><input type="checkbox" checked={settings.attachments} onChange={(event) => setSettings("attachments", event.currentTarget.checked)} />{language.t("session.visualizer.attachments")}</label>
              <label class="flex items-center gap-2 text-11-regular text-text-base"><input type="checkbox" checked={settings.orphans} onChange={(event) => setSettings("orphans", event.currentTarget.checked)} />{language.t("session.visualizer.orphans")}</label>
              <Show when={settings.localPath}>
                <div class="flex items-center justify-between gap-2 text-11-regular text-text-base"><span class="truncate" title={settings.localPath}>{language.t("session.visualizer.local")}: {settings.localPath}</span>
                  <button type="button" class="rounded px-1 text-text-weak hover:bg-background-stronger hover:text-text-base" onClick={() => setSettings("localPath", undefined)}>{language.t("session.visualizer.global")}</button></div>
                <label class="flex flex-col gap-1 text-11-regular text-text-weak"><span>{language.t("session.visualizer.depth")}</span>
                  <input type="range" min="1" max="5" step="1" value={settings.depth} onInput={(event) => setSettings("depth", Number(event.currentTarget.value))} /></label>
              </Show>
              <div class="border-t border-border-weak-base pt-2 text-11-medium text-text-base">{language.t("session.visualizer.display")}</div>
              <label class="flex items-center gap-2 text-11-regular text-text-base"><input type="checkbox" checked={settings.arrows} onChange={(event) => setSettings("arrows", event.currentTarget.checked)} />{language.t("session.visualizer.arrows")}</label>
              {slider("labels", language.t("session.visualizer.textFade"))}
              {slider("nodeSize", language.t("session.visualizer.nodeSize"))}
              {slider("linkThickness", language.t("session.visualizer.linkThickness"))}
              <div class="border-t border-border-weak-base pt-2 text-11-medium text-text-base">{language.t("session.visualizer.forces")}</div>
              {slider("center", language.t("session.visualizer.centerForce"))}
              {slider("repel", language.t("session.visualizer.repelForce"))}
              {slider("link", language.t("session.visualizer.linkForce"))}
              {slider("distance", language.t("session.visualizer.linkDistance"))}
            </aside>
          </Show>
          <div class="absolute inset-0" classList={{ hidden: interaction.settingsOpen && interaction.settingsFullPane }}>
          <Show when={graph().nodes.length === 0}>
            <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-13-regular text-text-weak">{language.t("session.visualizer.noMatches")}</div>
          </Show>
          <div class="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-1">
            <Show when={state.graph.unreadable > 0}>
              <div class="rounded-full border border-border-weak-base bg-background-base/90 px-3 py-1 text-11-regular text-text-weak shadow-sm">
                {language.t("session.visualizer.partial")}
              </div>
            </Show>
            <Show when={state.graph.edges.length === 0}>
              <div class="whitespace-nowrap rounded-full border border-border-weak-base bg-background-base/90 px-3 py-1 text-11-regular text-text-weak shadow-sm">
                {language.t("session.visualizer.unlinkedFolders")}
              </div>
            </Show>
          </div>
          <Show when={graph().nodes.length > 500}>
            <canvas
              ref={(element) => {
                canvas = element
                observer?.disconnect()
                observer = new ResizeObserver(() => paintCanvas())
                observer.observe(element)
              }}
              class="h-full w-full touch-none select-none text-text-weak"
              classList={{ "cursor-grab": !interaction.dragging && !state.hoveredPath, "cursor-grabbing": interaction.dragging, "cursor-pointer": !!state.hoveredPath && !interaction.dragging }}
              role="img"
              aria-label={language.t("session.view.visualizer")}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => setState("hoveredPath", undefined)}
              onContextMenu={(event) => {
                event.preventDefault()
                const path = hitCanvas(event, event.currentTarget)
                if (!path) { setInteraction("contextPath", undefined); return }
                const rect = event.currentTarget.getBoundingClientRect()
                setInteraction({ contextPath: path, contextX: Math.max(4, Math.min(event.clientX - rect.left, rect.width - 170)), contextY: Math.max(4, Math.min(event.clientY - rect.top, rect.height - 90)) })
              }}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(0.8) }
                else if (event.key === "-") { event.preventDefault(); zoomAt(1.25) }
                else if ((event.key === "Enter" || event.key === " ") && state.hoveredPath) { event.preventDefault(); open(state.hoveredPath) }
                else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                  event.preventDefault()
                  const step = (event.shiftKey ? 0.18 : 0.06) * viewport.width
                  setViewport("x", viewport.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))
                  setViewport("y", viewport.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))
                }
              }}
            />
            <Show when={hoveredNode()}>
              {(node) => {
                const position = () => {
                  const rect = canvas?.getBoundingClientRect()
                  const point = points().get(node().path)
                  if (!rect || !point) return { x: 0, y: 0 }
                  return graphScreenPoint(point, viewport, { width: rect.width, height: rect.height })
                }
                return <div class="pointer-events-none absolute z-10 max-w-52 truncate rounded border border-border-weak-base bg-background-base px-2 py-1 text-11-medium text-text-base shadow-sm"
                  style={{ left: `${Math.max(8, position().x + 8)}px`, top: `${Math.max(8, position().y - 30)}px` }}>{node().fileName}</div>
              }}
            </Show>
          </Show>
          <Show when={graph().nodes.length <= 500}>
          <svg
            class="h-full w-full touch-none select-none text-text-base"
            classList={{ "cursor-grab": !interaction.dragging, "cursor-grabbing": interaction.dragging }}
            viewBox={viewBox()}
            role="group"
            aria-label={language.t("session.view.visualizer")}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(event) => event.preventDefault()}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(0.8) }
              else if (event.key === "-") { event.preventDefault(); zoomAt(1.25) }
              else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault()
                const step = (event.shiftKey ? 0.18 : 0.06) * viewport.width
                setViewport("x", viewport.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))
                setViewport("y", viewport.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))
              }
            }}
          >
            <defs><marker id="spinosa-graph-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto-start-reverse"><path d="M0 0 L5 2.5 L0 5 Z" fill="currentColor" /></marker></defs>
            <For each={graph().edges}>
              {(edge) => {
                const from = () => points().get(edge.source)
                const to = () => points().get(edge.target)
                const emphasized = () => state.hoveredPath === edge.source || state.hoveredPath === edge.target
                return (
                  <line
                    x1={from()?.x}
                    y1={from()?.y}
                    x2={to()?.x}
                    y2={to()?.y}
                    class="stroke-border-weak-base"
                    stroke-opacity={state.hoveredPath ? (emphasized() ? 0.8 : 0.1) : 0.36}
                    stroke-width={(emphasized() ? 2 : 1.25) * settings.linkThickness}
                    stroke-dasharray={edge.directions?.length === 0 ? "3 3" : undefined}
                    marker-end={settings.arrows && edge.directions?.includes(edge.source) ? "url(#spinosa-graph-arrow)" : undefined}
                    marker-start={settings.arrows && edge.directions?.includes(edge.target) ? "url(#spinosa-graph-arrow)" : undefined}
                    vector-effect="non-scaling-stroke"
                  >
                    <title>{language.t(edge.directions?.length === 0 ? "session.visualizer.metadataBond" : "session.visualizer.fileLink")}</title>
                  </line>
                )
              }}
            </For>
            <For each={graph().nodes}>
              {(node) => {
                const point = () => points().get(node.path)
                const focused = () => !state.hoveredPath || neighbors()?.has(node.path)
                const color = () => {
                  const cluster = clusterByPath().get(node.path)
                  return cluster && cluster.size > 1
                    ? clusterColor(cluster.index) : "text-text-weak"
                }
                const degree = () => degreeByPath().get(node.path) ?? 0
                return (
                  <g
                    data-graph-node
                    class={`${color()} cursor-pointer outline-none`}
                    classList={{
                      "opacity-20": !focused(),
                      "opacity-100": focused(),
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={node.path}
                    onMouseEnter={() => setState("hoveredPath", node.path)}
                    onMouseLeave={() => {
                      if (state.hoveredPath === node.path) setState("hoveredPath", undefined)
                    }}
                    onFocus={() => setState("hoveredPath", node.path)}
                    onBlur={() => {
                      if (state.hoveredPath === node.path) setState("hoveredPath", undefined)
                    }}
                    onClick={() => open(node.path)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      const rect = event.currentTarget.closest("svg")!.getBoundingClientRect()
                      setInteraction({ contextPath: node.path, contextX: Math.max(4, Math.min(event.clientX - rect.left, rect.width - 170)), contextY: Math.max(4, Math.min(event.clientY - rect.top, rect.height - 90)) })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        open(node.path)
                      }
                    }}
                  >
                    <title>{node.path}</title>
                    <circle cx={point()?.x} cy={point()?.y} r={9 * viewport.width / VIEWBOX_WIDTH} fill="transparent" pointer-events="all" />
                    <Show when={state.hoveredPath === node.path}>
                      <circle
                        cx={point()?.x}
                        cy={point()?.y}
                        r={(5 + Math.min(degree(), 5) * 0.5) * settings.nodeSize}
                        fill="currentColor"
                        fill-opacity="0.12"
                      />
                    </Show>
                    <circle
                      cx={point()?.x}
                      cy={point()?.y}
                      r={(2.5 + Math.min(degree(), 5) * 0.4) * settings.nodeSize}
                      fill="currentColor"
                      fill-opacity="0.8"
                      class="stroke-background-base"
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <Show when={viewport.width < labelThreshold() || state.hoveredPath === node.path}>
                      <text x={(point()?.x ?? 0) + 5} y={(point()?.y ?? 0) + 1.5} class="fill-text-base"
                        font-size={`${8 * viewport.width / VIEWBOX_WIDTH}px`}
                        opacity={state.hoveredPath === node.path ? 1 : Math.min(0.8, (labelThreshold() - viewport.width) / (labelThreshold() * 0.25))}
                        pointer-events="none">{node.title || node.fileName.replace(/\.(md|markdown)$/i, "")}</text>
                    </Show>
                  </g>
                )
              }}
            </For>
            <Show when={hoveredNode()}>
              {(node) => {
                const point = () => points().get(node().path)
                const unit = () => viewport.width / VIEWBOX_WIDTH
                const width = () => Math.min(210, Math.max(55, node().fileName.length * 4 + 14)) * unit()
                const x = () => Math.min(viewport.x + viewport.width - width() - 6 * unit(), Math.max(viewport.x + 6 * unit(), (point()?.x ?? 0) + 6 * unit()))
                const y = () => Math.max(viewport.y + 14 * unit(), (point()?.y ?? 0) - 6 * unit())
                return (
                  <g pointer-events="none">
                    <rect
                      x={x()}
                      y={y() - 11 * unit()}
                      width={width()}
                      height={17 * unit()}
                      rx={3 * unit()}
                      class="fill-background-base stroke-border-weak-base"
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <text
                      x={x() + 7 * unit()}
                      y={y() + 1 * unit()}
                      class="fill-text-base font-medium"
                      font-size={`${7 * unit()}px`}
                      textLength={Math.min(width() - 14 * unit(), node().fileName.length * 4 * unit())}
                      lengthAdjust="spacingAndGlyphs"
                    >
                      {node().fileName}
                    </text>
                  </g>
                )
              }}
            </Show>
          </svg>
          </Show>
          <Show when={interaction.contextPath}>
            <div class="absolute z-20 flex flex-col rounded-lg border border-border-weak-base bg-background-base p-1 shadow-lg"
              style={{ left: `${interaction.contextX}px`, top: `${interaction.contextY}px` }}>
              <button type="button" class="rounded px-3 py-1.5 text-left text-12-regular text-text-base hover:bg-background-stronger"
                onClick={() => { open(interaction.contextPath!); setInteraction("contextPath", undefined) }}>
                {language.t("session.visualizer.openFile")}
              </button>
              <button type="button" class="rounded px-3 py-1.5 text-left text-12-regular text-text-base hover:bg-background-stronger"
                onClick={() => { setSettings({ localPath: interaction.contextPath, search: "" }); setInteraction("contextPath", undefined) }}>
                {language.t("session.visualizer.openLocal")}
              </button>
            </div>
          </Show>
          <div class="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-full border border-border-weak-base bg-background-base/90 p-1 shadow-sm">
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-full text-16-medium text-text-base transition-colors hover:bg-background-stronger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={language.t("desktop.menu.zoomOut")}
              title={language.t("desktop.menu.zoomOut")}
              onClick={() => zoomAt(1.25)}
            >
              −
            </button>
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-full text-16-medium text-text-base transition-colors hover:bg-background-stronger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={language.t("desktop.menu.zoomIn")}
              title={language.t("desktop.menu.zoomIn")}
              onClick={() => zoomAt(0.8)}
            >
              +
            </button>
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-full text-14-medium text-text-base transition-colors hover:bg-background-stronger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={language.t("common.reset")}
              title={language.t("common.reset")}
              onClick={() => setViewport({ x: 0, y: 0, width: VIEWBOX_WIDTH, height: VIEWBOX_HEIGHT })}
            >
              ↺
            </button>
          </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
