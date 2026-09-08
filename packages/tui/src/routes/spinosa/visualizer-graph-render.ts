import { RGBA, TextAttributes, type OptimizedBuffer } from "@opentui/core"
import type { GraphHit, GraphPoint, GraphScene, GraphTone } from "./visualizer-graph-layout"

export type { GraphPoint, GraphTone } from "./visualizer-graph-layout"

export const GRAPH_MIN_ZOOM = 1
export const GRAPH_MAX_ZOOM = 12

export type GraphPalette = Readonly<Record<GraphTone, RGBA>>

export type GraphThemeTokens = Readonly<{
  backgroundPanel: RGBA
  backgroundElement: RGBA
  borderSubtle: RGBA
  textMuted: RGBA
  text: RGBA
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  success: RGBA
  warning: RGBA
  error: RGBA
  info: RGBA
}>

/** Centered world-space viewport. The complete graph occupies [0, 1]² at zoom 1. */
export type GraphViewport = Readonly<{
  centerX: number
  centerY: number
  zoom: number
}>

export const FIT_GRAPH_VIEWPORT: GraphViewport = Object.freeze({ centerX: 0.5, centerY: 0.5, zoom: 1 })

export type GraphHitTarget = Readonly<{
  kind: string
  id: string
  label?: string
  data?: Readonly<Record<string, string | number | boolean | null>>
}>

type RasterColor = readonly [number, number, number, number]

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function viewportCenter(value: number, zoom: number) {
  const half = 0.5 / zoom
  return clamp(finite(value, 0.5), half, 1 - half)
}

export function normalizeGraphViewport(viewport: GraphViewport): GraphViewport {
  const zoom = clamp(finite(viewport.zoom, 1), GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM)
  return {
    centerX: viewportCenter(viewport.centerX, zoom),
    centerY: viewportCenter(viewport.centerY, zoom),
    zoom,
  }
}

export function worldToRaster(
  point: GraphPoint,
  viewport: GraphViewport,
  rasterWidth: number,
  rasterHeight: number,
): GraphPoint {
  const view = normalizeGraphViewport(viewport)
  return {
    x: (0.5 + (finite(point.x, 0.5) - view.centerX) * view.zoom) * Math.max(1, rasterWidth),
    y: (0.5 + (finite(point.y, 0.5) - view.centerY) * view.zoom) * Math.max(1, rasterHeight),
  }
}

export function rasterToWorld(
  point: GraphPoint,
  viewport: GraphViewport,
  rasterWidth: number,
  rasterHeight: number,
): GraphPoint {
  const view = normalizeGraphViewport(viewport)
  return {
    x: view.centerX + (finite(point.x, 0) / Math.max(1, rasterWidth) - 0.5) / view.zoom,
    y: view.centerY + (finite(point.y, 0) / Math.max(1, rasterHeight) - 0.5) / view.zoom,
  }
}

export function panGraphViewport(
  viewport: GraphViewport,
  deltaCellsX: number,
  deltaCellsY: number,
  widthCells: number,
  heightCells: number,
): GraphViewport {
  const view = normalizeGraphViewport(viewport)
  return normalizeGraphViewport({
    centerX: view.centerX - finite(deltaCellsX, 0) / (Math.max(1, widthCells) * view.zoom),
    centerY: view.centerY - finite(deltaCellsY, 0) / (Math.max(1, heightCells) * view.zoom),
    zoom: view.zoom,
  })
}

/** Zoom while preserving the world point under the normalized [0, 1] anchor. */
export function zoomGraphViewport(
  viewport: GraphViewport,
  factor: number,
  anchorX = 0.5,
  anchorY = 0.5,
): GraphViewport {
  const view = normalizeGraphViewport(viewport)
  const zoom = clamp(view.zoom * finite(factor, 1), GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM)
  const ax = clamp(finite(anchorX, 0.5), 0, 1)
  const ay = clamp(finite(anchorY, 0.5), 0, 1)
  const worldX = view.centerX + (ax - 0.5) / view.zoom
  const worldY = view.centerY + (ay - 0.5) / view.zoom
  return normalizeGraphViewport({
    centerX: worldX - (ax - 0.5) / zoom,
    centerY: worldY - (ay - 0.5) / zoom,
    zoom,
  })
}

/** Dense O(1) lookup table in terminal-cell coordinates. Later paint calls win. */
export class GraphHitMap {
  private widthValue = 1
  private heightValue = 1
  private cells = new Int32Array(1).fill(-1)
  private targets: GraphHitTarget[] = []
  private targetIndexes = new Map<string, number>()

  get width() {
    return this.widthValue
  }

  get height() {
    return this.heightValue
  }

  resize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.floor(finite(width, 1)))
    const nextHeight = Math.max(1, Math.floor(finite(height, 1)))
    if (nextWidth !== this.widthValue || nextHeight !== this.heightValue) {
      this.widthValue = nextWidth
      this.heightValue = nextHeight
      this.cells = new Int32Array(nextWidth * nextHeight)
    }
    this.clear()
  }

  clear() {
    this.cells.fill(-1)
    this.targets = []
    this.targetIndexes.clear()
  }

  indexFor(target: GraphHitTarget | undefined) {
    if (!target) return -1
    const key = `${target.kind}\u0000${target.id}`
    const existing = this.targetIndexes.get(key)
    if (existing !== undefined) return existing
    const index = this.targets.length
    this.targets.push(target)
    this.targetIndexes.set(key, index)
    return index
  }

  mark(x: number, y: number, targetIndex: number) {
    if (targetIndex < 0 || !Number.isFinite(x) || !Number.isFinite(y)) return false
    const cellX = Math.floor(x)
    const cellY = Math.floor(y)
    if (cellX < 0 || cellY < 0 || cellX >= this.widthValue || cellY >= this.heightValue) return false
    this.cells[cellY * this.widthValue + cellX] = targetIndex
    return true
  }

  get(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const cellX = Math.floor(x)
    const cellY = Math.floor(y)
    if (cellX < 0 || cellY < 0 || cellX >= this.widthValue || cellY >= this.heightValue) return
    const index = this.cells[cellY * this.widthValue + cellX]
    return index < 0 ? undefined : this.targets[index]
  }
}

const DENSITY_CHARS = [" ", "\u2591", "\u2592", "\u2593", "\u2588"]

/** Blend factor per density level: higher = more saturated fg color. */
const DENSITY_FG_BLEND = [0, 0.15, 0.35, 0.6, 1.0]

export class GraphRaster {
  readonly hits = new GraphHitMap()
  grid: Uint16Array
  private colors: Uint32Array
  private cellsW = 1
  private cellsH = 1
  private panelColor = 0

  constructor(widthCells = 1, heightCells = 1) {
    this.grid = new Uint16Array(widthCells * heightCells)
    this.colors = new Uint32Array(widthCells * heightCells)
    this.resize(widthCells, heightCells)
  }

  get width() { return this.cellsW }
  get height() { return this.cellsH }

  resize(widthCells: number, heightCells: number) {
    const cw = Math.max(1, Math.floor(finite(widthCells, 1)))
    const ch = Math.max(1, Math.floor(finite(heightCells, 1)))
    if (cw !== this.cellsW || ch !== this.cellsH) {
      this.cellsW = cw
      this.cellsH = ch
      const n = cw * ch
      this.grid = new Uint16Array(n)
      this.colors = new Uint32Array(n)
    }
    this.hits.resize(cw, ch)
  }

  dispose() {
    this.cellsW = 0
    this.cellsH = 0
    this.grid = new Uint16Array(0)
    this.colors = new Uint32Array(0)
    this.hits.resize(1, 1)
  }

  clear(color: RGBA) {
    this.grid.fill(0)
    this.colors.fill(0)
    this.panelColor = this.pack(color)
    this.hits.clear()
  }

  private pack(color: RGBA) {
    const [r, g, b] = color.toInts()
    return (r << 24) | (g << 16) | (b << 8) | 255
  }

  private unpack(packed: number): [number, number, number, number] {
    return [(packed >> 24) & 0xff, (packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff]
  }

  pixel(x: number, y: number, color: RGBA, hitIndex: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    const cx = Math.floor(x)
    const cy = Math.floor(y)
    if (cx < 0 || cy < 0 || cx >= this.cellsW || cy >= this.cellsH) return false
    const ci = cy * this.cellsW + cx
    if (this.grid[ci] < 4) this.grid[ci]++
    this.colors[ci] = this.pack(color)
    if (hitIndex >= 0) this.hits.mark(cx, cy, hitIndex)
    return true
  }

  /** Fill a cell at full density (4) — renders as solid █. */
  fillCell(x: number, y: number, color: RGBA, hitIndex: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    const cx = Math.floor(x)
    const cy = Math.floor(y)
    if (cx < 0 || cy < 0 || cx >= this.cellsW || cy >= this.cellsH) return false
    const ci = cy * this.cellsW + cx
    this.grid[ci] = 4
    this.colors[ci] = this.pack(color)
    if (hitIndex >= 0) this.hits.mark(cx, cy, hitIndex)
    return true
  }

  composite(buffer: OptimizedBuffer) {
    for (let cy = 0; cy < this.cellsH; cy++) {
      for (let cx = 0; cx < this.cellsW; cx++) {
        const ci = cy * this.cellsW + cx
        const level = this.grid[ci]
        if (level === 0) {
          const bg = this.unpack(this.panelColor)
          const c = RGBA.fromInts(bg[0], bg[1], bg[2], 255)
          buffer.setCell(cx, cy, " ", c, c)
        } else {
          const fg = this.unpack(this.colors[ci])
          const bg = this.unpack(this.panelColor)
          const t = DENSITY_FG_BLEND[level]!
          buffer.setCell(cx, cy, DENSITY_CHARS[level]!,
            RGBA.fromInts(
              Math.round(bg[0] + (fg[0] - bg[0]) * t),
              Math.round(bg[1] + (fg[1] - bg[1]) * t),
              Math.round(bg[2] + (fg[2] - bg[2]) * t),
              255,
            ),
            RGBA.fromInts(bg[0], bg[1], bg[2], 255),
          )
        }
      }
    }
  }

  paintRect(x: number, y: number, width: number, height: number, color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    this.paintRectPx(x, y, width, height, color, opacity, hit, (x, y, c, h) => this.pixel(x, y, c, h))
  }

  /** Fill a rectangle at full density — renders as solid █. */
  paintRectSolid(x: number, y: number, width: number, height: number, color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    this.paintRectPx(x, y, width, height, color, opacity, hit, (x, y, c, h) => this.fillCell(x, y, c, h))
  }

  private paintRectPx(
    x: number, y: number, width: number, height: number, color: RGBA, opacity: number, hit: GraphHitTarget | undefined,
    put: (x: number, y: number, c: RGBA, h: number) => boolean,
  ) {
    const x0 = Math.max(0, Math.floor(Math.min(x, x + width)))
    const x1 = Math.min(this.cellsW, Math.ceil(Math.max(x, x + width)))
    const y0 = Math.max(0, Math.floor(Math.min(y, y + height)))
    const y1 = Math.min(this.cellsH, Math.ceil(Math.max(y, y + height)))
    if (x1 <= x0 || y1 <= y0) return
    const hitIndex = this.hits.indexFor(hit)
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        put(px, py, color, hitIndex)
      }
    }
  }

  paintEllipse(cx: number, cy: number, rx: number, ry: number, color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    this.paintEllipsePx(cx, cy, rx, ry, color, opacity, hit, (x, y, c, h) => this.pixel(x, y, c, h))
  }

  paintEllipseSolid(cx: number, cy: number, rx: number, ry: number, color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    this.paintEllipsePx(cx, cy, rx, ry, color, opacity, hit, (x, y, c, h) => this.fillCell(x, y, c, h))
  }

  private paintEllipsePx(
    cx: number, cy: number, rx: number, ry: number, color: RGBA, opacity: number, hit: GraphHitTarget | undefined,
    put: (x: number, y: number, c: RGBA, h: number) => boolean,
  ) {
    rx = Math.abs(rx)
    ry = Math.abs(ry)
    if (![cx, cy, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0) return
    const hitIndex = this.hits.indexFor(hit)
    const sx = Math.max(0, Math.floor(cx - rx - 1))
    const ex = Math.min(this.cellsW, Math.ceil(cx + rx + 1))
    const sy = Math.max(0, Math.floor(cy - ry - 1))
    const ey = Math.min(this.cellsH, Math.ceil(cy + ry + 1))
    for (let py = sy; py < ey; py++) {
      for (let px = sx; px < ex; px++) {
        if (Math.hypot((px + 0.5 - cx) / rx, (py + 0.5 - cy) / ry) <= 1) put(px, py, color, hitIndex)
      }
    }
  }

  paintLine(from: GraphPoint, to: GraphPoint, width: number, color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    this.paintLinePx(from, to, width, color, opacity, hit, (x, y, c, h) => this.pixel(x, y, c, h))
  }

  paintLineSolid(from: GraphPoint, to: GraphPoint, width: number, color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    this.paintLinePx(from, to, width, color, opacity, hit, (x, y, c, h) => this.fillCell(x, y, c, h))
  }

  private paintLinePx(
    from: GraphPoint, to: GraphPoint, width: number, color: RGBA, opacity: number, hit: GraphHitTarget | undefined,
    put: (x: number, y: number, c: RGBA, h: number) => boolean,
  ) {
    if (![from.x, from.y, to.x, to.y, width].every(Number.isFinite) || width <= 0) return
    const hitIndex = this.hits.indexFor(hit)
    const radius = Math.max(0.5, width / 2)
    const dx = to.x - from.x
    const dy = to.y - from.y
    const steps = Math.max(Math.ceil(Math.abs(dx)), Math.ceil(Math.abs(dy)), 1)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const px = Math.round(from.x + dx * t)
      const py = Math.round(from.y + dy * t)
      for (let ox = -radius; ox <= radius; ox++) {
        for (let oy = -radius; oy <= radius; oy++) {
          if (Math.hypot(ox, oy) <= radius) put(px + ox, py + oy, color, hitIndex)
        }
      }
    }
  }

  paintPolyline(points: readonly GraphPoint[], width: number, color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    for (let i = 1; i < points.length; i++) this.paintLine(points[i - 1]!, points[i]!, width, color, opacity, hit)
  }

  paintPolylineSolid(points: readonly GraphPoint[], width: number, color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    for (let i = 1; i < points.length; i++) this.paintLineSolid(points[i - 1]!, points[i]!, width, color, opacity, hit)
  }

  paintCubic(points: readonly GraphPoint[], width: number, color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    this.paintCubicPx(points, width, color, opacity, hit, (x, y, c, h) => this.pixel(x, y, c, h))
  }

  paintCubicSolid(points: readonly GraphPoint[], width: number, color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    this.paintCubicPx(points, width, color, opacity, hit, (x, y, c, h) => this.fillCell(x, y, c, h))
  }

  private paintCubicPx(
    points: readonly GraphPoint[], width: number, color: RGBA, opacity: number, hit: GraphHitTarget | undefined,
    put: (x: number, y: number, c: RGBA, h: number) => boolean,
  ) {
    if (points.length !== 4) {
      for (let i = 1; i < points.length; i++) this.paintLinePx(points[i - 1]!, points[i]!, width, color, opacity, hit, put)
      return
    }
    const [a, b, c, d] = points
    const span = Math.hypot(d.x - a.x, d.y - a.y) + Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(d.x - c.x, d.y - c.y)
    const steps = clamp(Math.ceil(span / 2), 8, 96)
    const curve: GraphPoint[] = [a]
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      curve.push({
        x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
        y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y,
      })
    }
    for (let i = 1; i < curve.length; i++) {
      this.paintLinePx(curve[i - 1]!, curve[i]!, width, color, opacity, hit, put)
    }
  }

  paintPolygon(points: readonly GraphPoint[], color: RGBA, opacity = 1, hit?: GraphHitTarget) {
    if (points.length < 3 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return
    const hitIndex = this.hits.indexFor(hit)
    const minX = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x))))
    const maxX = Math.min(this.cellsW, Math.ceil(Math.max(...points.map((p) => p.x))))
    const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))))
    const maxY = Math.min(this.cellsH, Math.ceil(Math.max(...points.map((p) => p.y))))
    for (let py = minY; py < maxY; py++) {
      for (let px = minX; px < maxX; px++) {
        let inside = false
        for (let i = 0, prev = points.length - 1; i < points.length; prev = i++) {
          const a = points[i]!
          const b = points[prev]!
          if (a.y > py + 0.5 === b.y > py + 0.5) continue
          if (px + 0.5 < ((b.x - a.x) * (py + 0.5 - a.y)) / (b.y - a.y) + a.x) inside = !inside
        }
        if (inside) this.pixel(px, py, color, hitIndex)
      }
    }
    this.paintPolyline([...points, points[0]!], 1, color, opacity, hit)
  }
}

export type GraphPaintState = Readonly<{
  viewport: GraphViewport
  selectedID?: string
  hoveredID?: string
}>

export type GraphTextOverlay = Readonly<{
  x: number
  y: number
  text: string
  tone: GraphTone
  align: "start" | "center" | "end"
  maxWidth: number
  bold?: boolean
}>

export type GraphPaintResult = Readonly<{
  labels: readonly GraphTextOverlay[]
}>

function mixColor(base: RGBA, overlay: RGBA, amount: number) {
  const a = base.toInts()
  const b = overlay.toInts()
  const t = clamp(amount, 0, 1)
  return RGBA.fromInts(
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    255,
  )
}

export function createGraphPalette(theme: GraphThemeTokens): GraphPalette {
  return {
    panel: theme.backgroundPanel,
    grid: mixColor(theme.backgroundPanel, theme.borderSubtle, 0.78),
    muted: theme.textMuted,
    text: theme.text,
    primary: theme.primary,
    secondary: theme.secondary,
    accent: theme.accent,
    success: theme.success,
    warning: theme.warning,
    error: theme.error,
    info: theme.info,
    "heat-0": mixColor(theme.backgroundElement, theme.info, 0.16),
    "heat-1": mixColor(theme.backgroundElement, theme.info, 0.48),
    "heat-2": mixColor(theme.info, theme.success, 0.55),
    "heat-3": mixColor(theme.success, theme.warning, 0.72),
    "heat-4": mixColor(theme.warning, theme.error, 0.78),
  }
}

function transformPoints(points: readonly GraphPoint[], state: GraphPaintState, raster: GraphRaster) {
  return points.map((point) => worldToRaster(point, state.viewport, raster.width, raster.height))
}

function transformRect(
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
  state: GraphPaintState,
  raster: GraphRaster,
) {
  const start = worldToRaster(rect, state.viewport, raster.width, raster.height)
  const end = worldToRaster(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    state.viewport,
    raster.width,
    raster.height,
  )
  return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y }
}

function active(id: string, hit: GraphHit | undefined, state: GraphPaintState) {
  const identity = hit?.id ?? id
  return {
    selected: state.selectedID === identity || state.selectedID === id,
    hovered: state.hoveredID === identity || state.hoveredID === id,
  }
}

function paintPill(
  raster: GraphRaster,
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
  color: RGBA,
  opacity: number,
  hit?: GraphHitTarget,
) {
  const radius = Math.min(Math.abs(rect.width) / 2, Math.abs(rect.height) / 2)
  const left = Math.min(rect.x, rect.x + rect.width)
  const top = Math.min(rect.y, rect.y + rect.height)
  const width = Math.abs(rect.width)
  const height = Math.abs(rect.height)
  if (width <= height) return raster.paintEllipseSolid(left + width / 2, top + height / 2, width / 2, height / 2, color, opacity, hit)
  raster.paintRectSolid(left + radius, top, width - radius * 2, height, color, opacity, hit)
  raster.paintEllipseSolid(left + radius, top + height / 2, radius, height / 2, color, opacity, hit)
  raster.paintEllipseSolid(left + width - radius, top + height / 2, radius, height / 2, color, opacity, hit)
}

function paintNodeShape(
  raster: GraphRaster,
  shape: "rect" | "circle" | "pill",
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
  color: RGBA,
  opacity: number,
  hit?: GraphHitTarget,
  expansion = 0,
) {
  const expanded = {
    x: rect.x - expansion,
    y: rect.y - expansion,
    width: rect.width + expansion * 2,
    height: rect.height + expansion * 2,
  }
  if (shape === "rect") return raster.paintRectSolid(expanded.x, expanded.y, expanded.width, expanded.height, color, opacity, hit)
  if (shape === "pill") return paintPill(raster, expanded, color, opacity, hit)
  const cx = expanded.x + expanded.width / 2
  const cy = expanded.y + expanded.height / 2
  const candidateX = Math.max(1.25, Math.abs(expanded.width) / 2)
  const candidateY = Math.max(0.7, Math.abs(expanded.height) / 2)
  // Terminal cells are roughly twice as tall as wide; 2:1 raster radii look physically circular.
  const radiusX = Math.max(candidateX, candidateY * 2)
  const radiusY = radiusX / 2
  raster.paintEllipseSolid(cx, cy, radiusX, radiusY, color, opacity, hit)
}

function addNodeLabel(
  labels: GraphTextOverlay[],
  label: string | undefined,
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
  tone: GraphTone,
  bold: boolean,
  raster: GraphRaster,
) {
  if (!label) return
    const widthCells = Math.floor(Math.abs(rect.width))
  if (widthCells < 5) return
  labels.push({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    text: label,
    tone,
    align: "center",
    maxWidth: Math.max(1, widthCells - 2),
    bold,
  })
}

/** Paints every normalized scene primitive into the reusable sub-pixel raster. */
export function paintGraphScene(
  raster: GraphRaster,
  scene: GraphScene,
  palette: GraphPalette,
  state: GraphPaintState,
): GraphPaintResult {
  raster.clear(palette.panel)
  const labels: GraphTextOverlay[] = []
  const plot = transformRect(scene.plotBounds, state, raster)

  for (const axis of scene.axes) {
    for (const tick of axis.ticks) {
      const point = worldToRaster(
        axis.orientation === "x" ? { x: tick.position, y: axis.start.y } : { x: axis.start.x, y: tick.position },
        state.viewport,
        raster.width,
        raster.height,
      )
      const start = axis.orientation === "x" ? { x: point.x, y: plot.y } : { x: plot.x, y: point.y }
      const end = axis.orientation === "x"
        ? { x: point.x, y: plot.y + plot.height }
        : { x: plot.x + plot.width, y: point.y }
      raster.paintLine(start, end, 1, palette.grid, 0.42)
      labels.push({
        x: point.x,
        y: point.y + (axis.orientation === "x" ? 1 : 0),
        text: tick.label,
        tone: "muted",
        align: axis.orientation === "x" ? "center" : "end",
        maxWidth: 12,
      })
    }
    const points = transformPoints([axis.start, axis.end], state, raster)
    raster.paintLine(points[0]!, points[1]!, 1.2, palette[axis.tone], 0.9)
    if (axis.label) {
      labels.push({
        x: (points[0]!.x + points[1]!.x) / 2,
        y: (points[0]!.y + points[1]!.y) / 2 + (axis.orientation === "x" ? 2 : 0),
        text: axis.label,
        tone: "muted",
        align: "center",
        maxWidth: Math.max(8, Math.floor(Math.abs(points[1]!.x - points[0]!.x))),
      })
    }
  }

  for (const area of scene.areas) {
    const points = transformPoints(area.points, state, raster)
    const activity = active(area.id, area.hit, state)
    const areaTone = activity.selected ? "text" : activity.hovered ? "accent" : area.tone
    raster.paintPolygon(points, palette[areaTone], area.opacity, area.hit)
    if (area.label && points.length > 0) {
      labels.push({
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
        text: area.label,
        tone: "muted",
        align: "center",
        maxWidth: 20,
      })
    }
  }

  for (const edge of scene.edges) {
    const points = transformPoints(edge.points, state, raster)
    const lineWidth = Math.max(1, edge.width * Math.min(raster.width, raster.height) * state.viewport.zoom)
    const activity = active(edge.id, edge.hit, state)
    const edgeTone = activity.selected ? "text" : activity.hovered ? "accent" : edge.tone
    raster.paintCubicSolid(points, lineWidth, palette[edgeTone], edge.opacity ?? 1, edge.hit)
  }

  for (const bar of scene.bars) {
    const rect = transformRect(bar, state, raster)
    const activity = active(bar.id, bar.hit, state)
    const barTone = activity.selected ? "text" : activity.hovered ? "accent" : bar.tone
    raster.paintRectSolid(rect.x, rect.y, rect.width, rect.height, palette[barTone], 1, bar.hit)
    addNodeLabel(labels, bar.label, rect, "text", activity.selected, raster)
  }

  for (const node of scene.nodes) {
    const rect = transformRect(node, state, raster)
    const activity = active(node.id, node.hit, state)
    if (node.rimTone) paintNodeShape(raster, node.shape, rect, palette[node.rimTone], 1, node.hit, 1)
    const nodeTone = activity.selected ? "text" : activity.hovered ? "accent" : node.tone
    paintNodeShape(raster, node.shape, rect, palette[nodeTone], 1, node.hit)
    addNodeLabel(labels, node.label, rect, "text", activity.selected, raster)
  }

  for (const label of scene.labels) {
    if (label.importance === 0 && raster.hits.width < 70 && state.viewport.zoom <= 1) continue
    const point = worldToRaster(label, state.viewport, raster.width, raster.height)
    labels.push({
      x: point.x,
      y: point.y,
      text: label.text,
      tone: label.tone,
      align: label.align,
      maxWidth: Math.max(1, Math.floor((label.maxWidth ?? 0.25) * raster.hits.width * state.viewport.zoom)),
      bold: label.importance === 2,
    })
  }

  return { labels }
}

function truncateLabel(value: string, width: number) {
  const clean = value.replace(/[\r\n\t\u0000-\u001f\u007f]/g, " ").trim()
  const chars = Array.from(clean)
  if (chars.length <= width) return clean
  if (width <= 1) return "…"
  return `${chars.slice(0, width - 1).join("")}…`
}

/** Draw terminal-native text after the subcell raster has been composited. */
export function paintGraphText(buffer: OptimizedBuffer, result: GraphPaintResult, palette: GraphPalette) {
  for (const label of result.labels) {
    const maxWidth = Math.max(1, Math.min(buffer.width, Math.floor(label.maxWidth)))
    const text = truncateLabel(label.text, maxWidth)
    if (!text) continue
    let x = Math.round(label.x)
    if (label.align === "center") x -= Math.floor(Array.from(text).length / 2)
    if (label.align === "end") x -= Array.from(text).length
    x = clamp(x, 0, Math.max(0, buffer.width - Array.from(text).length))
    const y = Math.round(label.y)
    if (y < 0 || y >= buffer.height) continue
    buffer.drawText(text, x, y, palette[label.tone], undefined, label.bold ? TextAttributes.BOLD : 0)
  }
}
