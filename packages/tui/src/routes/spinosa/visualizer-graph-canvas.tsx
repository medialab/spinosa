import {
  FrameBufferRenderable,
  MouseButton,
  RGBA,
  type MouseEvent,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core"
import { extend } from "@opentui/solid"

import { createEffect, createMemo, createSignal, onMount } from "solid-js"
import { useTheme } from "../../context/theme"
import type { GraphHit, GraphScene } from "./visualizer-graph-layout"
import {
  FIT_GRAPH_VIEWPORT,
  GraphRaster,
  createGraphPalette,
  normalizeGraphViewport,
  paintGraphScene,
  paintGraphText,
  panGraphViewport,
  zoomGraphViewport,
  type GraphHitTarget,
  type GraphPalette,
  type GraphViewport,
} from "./visualizer-graph-render"

const blank = RGBA.fromInts(0, 0, 0, 255)
const DEFAULT_PALETTE: GraphPalette = {
  panel: blank,
  grid: RGBA.fromInts(45, 48, 55, 255),
  muted: RGBA.fromInts(125, 130, 140, 255),
  text: RGBA.fromInts(235, 238, 245, 255),
  primary: RGBA.fromInts(75, 145, 255, 255),
  secondary: RGBA.fromInts(200, 110, 255, 255),
  accent: RGBA.fromInts(255, 100, 200, 255),
  success: RGBA.fromInts(50, 235, 130, 255),
  warning: RGBA.fromInts(255, 200, 50, 255),
  error: RGBA.fromInts(255, 70, 80, 255),
  info: RGBA.fromInts(50, 210, 245, 255),
  "heat-0": RGBA.fromInts(25, 40, 60, 255),
  "heat-1": RGBA.fromInts(40, 100, 160, 255),
  "heat-2": RGBA.fromInts(40, 190, 180, 255),
  "heat-3": RGBA.fromInts(245, 190, 50, 255),
  "heat-4": RGBA.fromInts(255, 60, 70, 255),
}

export type GraphInput =
  | Readonly<{ type: "hover"; hit?: GraphHitTarget }>
  | Readonly<{ type: "select"; hit?: GraphHitTarget }>
  | Readonly<{ type: "activate"; hit: GraphHitTarget }>
  | Readonly<{ type: "pan"; deltaX: number; deltaY: number }>
  | Readonly<{ type: "zoom"; factor: number; anchorX: number; anchorY: number }>

export type SpinosaGraphOptions = RenderableOptions<FrameBufferRenderable> & {
  scene?: GraphScene
  palette?: GraphPalette
  viewport?: GraphViewport
  selectedID?: string
  hoveredID?: string
}

export class SpinosaGraphRenderable extends FrameBufferRenderable {
  private raster = new GraphRaster()
  private sceneValue?: GraphScene
  private paletteValue = DEFAULT_PALETTE
  private viewportValue = FIT_GRAPH_VIEWPORT
  private selectedIDValue?: string
  private hoveredIDValue?: string
  private paintDirty = true
  private dragX?: number
  private dragY?: number
  private hoverKey?: string
  private lastClickKey?: string
  private lastClickAt = 0

  constructor(ctx: RenderContext, options: SpinosaGraphOptions = {}) {
    const width = typeof options.width === "number" ? options.width : 1
    const height = typeof options.height === "number" ? options.height : 1
    super(ctx, { ...options, width, height, live: false, respectAlpha: false })
    if (options.width !== undefined && typeof options.width !== "number") this.width = options.width
    if (options.height !== undefined && typeof options.height !== "number") this.height = options.height
    this.sceneValue = options.scene
    this.paletteValue = options.palette ?? DEFAULT_PALETTE
    this.viewportValue = normalizeGraphViewport(options.viewport ?? FIT_GRAPH_VIEWPORT)
    this.selectedIDValue = options.selectedID
    this.hoveredIDValue = options.hoveredID
  }

  set scene(value: GraphScene | undefined) {
    if (this.sceneValue === value) return
    this.sceneValue = value
    this.invalidate()
  }

  set palette(value: GraphPalette | undefined) {
    const next = value ?? DEFAULT_PALETTE
    if (this.paletteValue === next) return
    this.paletteValue = next
    this.invalidate()
  }

  set viewport(value: GraphViewport | undefined) {
    const next = normalizeGraphViewport(value ?? FIT_GRAPH_VIEWPORT)
    if (
      this.viewportValue.centerX === next.centerX &&
      this.viewportValue.centerY === next.centerY &&
      this.viewportValue.zoom === next.zoom
    ) return
    this.viewportValue = next
    this.invalidate()
  }

  set selectedID(value: string | undefined) {
    if (this.selectedIDValue === value) return
    this.selectedIDValue = value
    this.invalidate()
  }

  set hoveredID(value: string | undefined) {
    if (this.hoveredIDValue === value) return
    this.hoveredIDValue = value
    this.invalidate()
  }

  private invalidate() {
    this.paintDirty = true
    this.requestRender()
  }

  protected override onResize(width: number, height: number) {
    super.onResize(width, height)
    this.raster.resize(width, height)
    this.paintDirty = true
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed) return
    if (this.paintDirty) {
      this.frameBuffer.clear(this.paletteValue.panel)
      this.raster.resize(this.frameBuffer.width, this.frameBuffer.height)
      if (this.sceneValue) {
        const result = paintGraphScene(this.raster, this.sceneValue, this.paletteValue, {
          viewport: this.viewportValue,
          selectedID: this.selectedIDValue,
          hoveredID: this.hoveredIDValue,
        })
        this.raster.composite(this.frameBuffer)
        paintGraphText(this.frameBuffer, result, this.paletteValue)
      }
      this.paintDirty = false
    }
    super.renderSelf(buffer)
  }

  private local(event: MouseEvent) {
    return { x: event.x - this.screenX, y: event.y - this.screenY }
  }

  private hitAt(event: MouseEvent) {
    const local = this.local(event)
    return this.raster.hits.get(local.x, local.y)
  }

  private emitInput(input: GraphInput) {
    this.emit("graph-input", input)
  }

  private updateHover(event: MouseEvent) {
    const hit = this.hitAt(event)
    const key = hit ? `${hit.kind}\u0000${hit.id}` : undefined
    if (key === this.hoverKey) return
    this.hoverKey = key
    this.emitInput({ type: "hover", hit })
  }

  protected override onMouseEvent(event: MouseEvent) {
    const local = this.local(event)
    if (event.type === "out") {
      this.dragX = undefined
      this.dragY = undefined
      if (this.hoverKey !== undefined) {
        this.hoverKey = undefined
        this.emitInput({ type: "hover" })
      }
      return
    }

    if (event.type === "move" || event.type === "over") {
      this.updateHover(event)
      return
    }

    if (event.type === "down" && event.button === MouseButton.LEFT) {
      const hit = this.hitAt(event)
      this.dragX = event.x
      this.dragY = event.y
      this.emitInput({ type: "select", hit })
      if (hit) {
        const key = `${hit.kind}\u0000${hit.id}`
        const now = Date.now()
        if (key === this.lastClickKey && now - this.lastClickAt <= 350) this.emitInput({ type: "activate", hit })
        this.lastClickKey = key
        this.lastClickAt = now
      }
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.type === "drag" && this.dragX !== undefined && this.dragY !== undefined) {
      const deltaX = event.x - this.dragX
      const deltaY = event.y - this.dragY
      this.dragX = event.x
      this.dragY = event.y
      if (deltaX || deltaY) this.emitInput({ type: "pan", deltaX, deltaY })
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.type === "drag-end" || event.type === "up") {
      this.dragX = undefined
      this.dragY = undefined
      return
    }

    if (event.type !== "scroll" || !event.scroll) return
    const magnitude = Math.max(1, Math.abs(event.scroll.delta || 1))
    if (event.modifiers.ctrl) {
      const inward = event.scroll.direction === "up" || event.scroll.direction === "left"
      this.emitInput({
        type: "zoom",
        factor: inward ? 1.2 : 1 / 1.2,
        anchorX: Math.max(0, Math.min(1, local.x / Math.max(1, this.width))),
        anchorY: Math.max(0, Math.min(1, local.y / Math.max(1, this.height))),
      })
    } else {
      const horizontal = event.modifiers.shift || event.scroll.direction === "left" || event.scroll.direction === "right"
      const forward = event.scroll.direction === "down" || event.scroll.direction === "right"
      this.emitInput({
        type: "pan",
        deltaX: horizontal ? (forward ? -magnitude : magnitude) : 0,
        deltaY: horizontal ? 0 : forward ? -magnitude : magnitude,
      })
    }
    event.preventDefault()
    event.stopPropagation()
  }

  protected override destroySelf() {
    this.raster.dispose()
    this.sceneValue = undefined
    this.removeAllListeners("graph-input")
    super.destroySelf()
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    spinosa_graph: typeof SpinosaGraphRenderable
  }
}

extend({ spinosa_graph: SpinosaGraphRenderable })

function sceneHits(scene: GraphScene) {
  const hits: GraphHit[] = []
  const keys = new Set<string>()
  const add = (hit: GraphHit | undefined) => {
    if (!hit) return
    const key = `${hit.kind}\u0000${hit.id}`
    if (keys.has(key)) return
    keys.add(key)
    hits.push(hit)
  }
  for (const node of scene.nodes) add(node.hit)
  for (const bar of scene.bars) add(bar.hit)
  for (const edge of scene.edges) add(edge.hit)
  for (const area of scene.areas) add(area.hit)
  return hits
}

export type GraphCanvasHandle = Readonly<{
  fit(): void
  pan(deltaX: number, deltaY: number): void
  zoom(factor: number, anchorX?: number, anchorY?: number): void
  selectNext(direction?: 1 | -1): void
  clearSelection(): void
  activateSelected(): void
  viewport(): GraphViewport
  selection(): GraphHitTarget | undefined
}>

export type GraphCanvasProps = {
  scene: GraphScene
  palette?: GraphPalette
  initialViewport?: GraphViewport
  width?: number | "auto" | `${number}%`
  height?: number | "auto" | `${number}%`
  onViewportChange?: (viewport: GraphViewport) => void
  onHoverChange?: (hit: GraphHitTarget | undefined) => void
  onSelectionChange?: (hit: GraphHitTarget | undefined) => void
  onActivate?: (hit: GraphHitTarget) => void
  ref?: (handle: GraphCanvasHandle) => void
}

export function GraphCanvas(props: GraphCanvasProps) {
  const theme = props.palette ? undefined : useTheme().theme
  const palette = createMemo(() => props.palette ?? createGraphPalette(theme!))
  const [viewport, setViewport] = createSignal(normalizeGraphViewport(props.initialViewport ?? FIT_GRAPH_VIEWPORT))
  const [hovered, setHovered] = createSignal<GraphHitTarget>()
  const [selected, setSelected] = createSignal<GraphHitTarget>()
  let graph: SpinosaGraphRenderable | undefined
  let mode = props.scene.mode

  const updateViewport = (next: GraphViewport) => {
    const normalized = normalizeGraphViewport(next)
    setViewport(normalized)
    props.onViewportChange?.(normalized)
  }

  const pan = (deltaX: number, deltaY: number) => {
    updateViewport(panGraphViewport(viewport(), deltaX, deltaY, graph?.width ?? 1, graph?.height ?? 1))
  }

  const zoom = (factor: number, anchorX = 0.5, anchorY = 0.5) => {
    updateViewport(zoomGraphViewport(viewport(), factor, anchorX, anchorY))
  }

  const select = (hit: GraphHitTarget | undefined) => {
    setSelected(hit)
    props.onSelectionChange?.(hit)
  }

  const handle: GraphCanvasHandle = {
    fit() {
      updateViewport(FIT_GRAPH_VIEWPORT)
    },
    pan,
    zoom,
    selectNext(direction = 1) {
      const hits = sceneHits(props.scene)
      if (hits.length === 0) return select(undefined)
      const current = selected()
      const index = current ? hits.findIndex((hit) => hit.id === current.id && hit.kind === current.kind) : -1
      select(hits[(index + direction + hits.length) % hits.length])
    },
    clearSelection() {
      select(undefined)
    },
    activateSelected() {
      const hit = selected()
      if (hit) props.onActivate?.(hit)
    },
    viewport,
    selection: selected,
  }

  onMount(() => props.ref?.(handle))

  createEffect(() => {
    const scene = props.scene
    if (scene.mode !== mode) {
      mode = scene.mode
      updateViewport(FIT_GRAPH_VIEWPORT)
    }
    const current = selected()
    if (current && !sceneHits(scene).some((hit) => hit.id === current.id && hit.kind === current.kind)) select(undefined)
  })

  const onInput = (input: GraphInput) => {
    if (input.type === "hover") {
      setHovered(input.hit)
      props.onHoverChange?.(input.hit)
      return
    }
    if (input.type === "select") return select(input.hit)
    if (input.type === "activate") return props.onActivate?.(input.hit)
    if (input.type === "pan") return pan(input.deltaX, input.deltaY)
    zoom(input.factor, input.anchorX, input.anchorY)
  }

  return (
    <spinosa_graph
      ref={(value: SpinosaGraphRenderable) => (graph = value)}
      width={props.width ?? "100%"}
      height={props.height ?? "100%"}
      scene={props.scene}
      palette={palette()}
      viewport={viewport()}
      selectedID={selected()?.id}
      hoveredID={hovered()?.id}
      on:graph-input={onInput}
    />
  )
}
