import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { Spinner } from "@spinosa/ui/spinner"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { clusterRawWorkspaceGraph, layoutRawWorkspaceGraph, type RawGraphCluster } from "./raw-workspace-graph-layout"
import { loadRawWorkspaceGraph, type RawGraphClient, type RawWorkspaceGraph } from "./raw-workspace-graph"

const VIEWBOX_WIDTH = 1000
const VIEWBOX_HEIGHT = 680

const EMPTY_GRAPH: RawWorkspaceGraph = { nodes: [], edges: [], unreadable: 0 }
const CLUSTER_COLORS = ["text-icon-info-base", "text-icon-success-base", "text-icon-warning-base", "text-icon-critical-base"]
const MIN_VIEW_SIZE = 120
const MAX_VIEW_SIZE = 3000

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
  const [state, setState] = createStore<LoadState>({
    status: "idle",
    workspacePath: "",
    graph: EMPTY_GRAPH,
  })
  const [interaction, setInteraction] = createStore({ dragging: false })
  const [viewport, setViewport] = createStore<ViewBox>({ x: 0, y: 0, width: VIEWBOX_WIDTH, height: VIEWBOX_HEIGHT })
  let request = 0
  let drag:
    | { pointerId: number; clientX: number; clientY: number; viewport: ViewBox }
    | undefined
  const clusters = createMemo(() => clusterRawWorkspaceGraph(state.graph.nodes, state.graph.edges))
  const points = createMemo(() =>
    layoutRawWorkspaceGraph(state.graph.nodes, state.graph.edges, VIEWBOX_WIDTH, VIEWBOX_HEIGHT, clusters()),
  )
  const clusterByPath = createMemo(() => {
    const lookup = new Map<string, { index: number; size: number }>()
    clusters().forEach((cluster, index) =>
      cluster.nodePaths.forEach((path) => lookup.set(path, { index, size: cluster.nodePaths.length })),
    )
    return lookup
  })
  const degreeByPath = createMemo(() => {
    const degrees = new Map<string, number>()
    for (const edge of state.graph.edges) {
      degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1)
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1)
    }
    return degrees
  })
  const neighbors = createMemo(() => {
    const hovered = state.hoveredPath
    if (!hovered) return
    const related = new Set([hovered])
    for (const edge of state.graph.edges) {
      if (edge.source === hovered) related.add(edge.target)
      if (edge.target === hovered) related.add(edge.source)
    }
    return related
  })

  const load = async (workspacePath: string) => {
    const current = ++request
    setViewport({ x: 0, y: 0, width: VIEWBOX_WIDTH, height: VIEWBOX_HEIGHT })
    setState({ status: "loading", workspacePath, graph: EMPTY_GRAPH, hoveredPath: undefined, error: undefined })
    try {
      const graph = await loadRawWorkspaceGraph(sdk().client as unknown as RawGraphClient, workspacePath)
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
  })

  const retry = () => void load(state.workspacePath || props.workspacePath())
  const open = (path: string) => props.onOpenFile(path)
  const hoveredNode = () => state.graph.nodes.find((node) => node.path === state.hoveredPath)
  const viewBox = () => `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`

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

  const onWheel = (event: WheelEvent & { currentTarget: SVGSVGElement }) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const anchorX = viewport.x + ((event.clientX - rect.left) / rect.width) * viewport.width
    const anchorY = viewport.y + ((event.clientY - rect.top) / rect.height) * viewport.height
    zoomAt(event.deltaY < 0 ? 0.85 : 1.18, anchorX, anchorY)
  }

  const onPointerDown = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("[data-graph-node]"))) return
    drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, viewport: { ...viewport } }
    setInteraction("dragging", true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    setViewport({
      x: drag.viewport.x - ((event.clientX - drag.clientX) * drag.viewport.width) / rect.width,
      y: drag.viewport.y - ((event.clientY - drag.clientY) * drag.viewport.height) / rect.height,
    })
  }

  const onPointerUp = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    if (drag?.pointerId !== event.pointerId) return
    drag = undefined
    setInteraction("dragging", false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const clusterBounds = (cluster: RawGraphCluster) => {
    const members = cluster.nodePaths.flatMap((path) => {
      const point = points().get(path)
      return point ? [point] : []
    })
    if (members.length === 0) return
    const xs = members.map((point) => point.x)
    const ys = members.map((point) => point.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      rx: Math.max(20, (maxX - minX) / 2 + 22),
      ry: Math.max(20, (maxY - minY) / 2 + 22),
    }
  }

  return (
    <div
      class="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
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
        <div class="relative h-full w-full">
          <Show when={state.graph.unreadable > 0}>
            <div class="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-border-weak-base bg-background-base/90 px-3 py-1 text-11-regular text-text-weak shadow-sm">
              {language.t("session.visualizer.partial")}
            </div>
          </Show>
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
          >
            <For each={clusters()}>
              {(cluster, index) => {
                if (cluster.nodePaths.length < 2) return null
                const bounds = clusterBounds(cluster)
                if (!bounds) return null
                return (
                  <ellipse
                    cx={bounds.cx}
                    cy={bounds.cy}
                    rx={bounds.rx}
                    ry={bounds.ry}
                    class={`${clusterColor(index())} fill-current stroke-current`}
                    fill-opacity="0.035"
                    stroke-opacity="0.16"
                    stroke-width="1"
                    vector-effect="non-scaling-stroke"
                  />
                )
              }}
            </For>
            <For each={state.graph.edges}>
              {(edge) => {
                const from = points().get(edge.source)
                const to = points().get(edge.target)
                if (!from || !to) return null
                const emphasized = state.hoveredPath === edge.source || state.hoveredPath === edge.target
                return (
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    class="stroke-border-weak-base"
                    stroke-opacity={state.hoveredPath ? (emphasized ? 0.8 : 0.1) : 0.36}
                    stroke-width={emphasized ? 2 : 1.25}
                    vector-effect="non-scaling-stroke"
                  />
                )
              }}
            </For>
            <For each={state.graph.nodes}>
              {(node) => {
                const point = points().get(node.path)
                if (!point) return null
                const focused = !state.hoveredPath || neighbors()?.has(node.path)
                const cluster = clusterByPath().get(node.path)
                const color = cluster && cluster.size > 1 ? clusterColor(cluster.index) : "text-text-weak"
                const degree = degreeByPath().get(node.path) ?? 0
                return (
                  <g
                    data-graph-node
                    class={`${color} cursor-pointer outline-none transition-opacity duration-150`}
                    classList={{
                      "opacity-20": !focused,
                      "opacity-100": focused,
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
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        open(node.path)
                      }
                    }}
                  >
                    <title>{node.path}</title>
                    <circle cx={point.x} cy={point.y} r="12" fill="transparent" pointer-events="all" />
                    <Show when={state.hoveredPath === node.path}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={8 + Math.min(degree, 5)}
                        fill="currentColor"
                        fill-opacity="0.12"
                      />
                    </Show>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={4.5 + Math.min(degree, 5) * 0.65}
                      fill="currentColor"
                      class="stroke-background-base"
                      stroke-width="2"
                      vector-effect="non-scaling-stroke"
                    />
                  </g>
                )
              }}
            </For>
            <Show when={hoveredNode()}>
              {(node) => {
                const point = points().get(node().path)
                if (!point) return null
                const width = Math.min(320, Math.max(92, node().fileName.length * 7 + 20))
                const x = Math.min(VIEWBOX_WIDTH - width - 12, Math.max(12, point.x + 12))
                const y = Math.max(30, point.y - 18)
                return (
                  <g pointer-events="none">
                    <rect
                      x={x}
                      y={y - 17}
                      width={width}
                      height="28"
                      rx="6"
                      class="fill-background-base stroke-border-weak-base"
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <text
                      x={x + 10}
                      y={y + 1}
                      class="fill-text-base text-[12px] font-medium"
                      textLength={Math.min(width - 20, node().fileName.length * 7)}
                      lengthAdjust="spacingAndGlyphs"
                    >
                      {node().fileName}
                    </text>
                  </g>
                )
              }}
            </Show>
          </svg>
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
      </Show>
    </div>
  )
}
