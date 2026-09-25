import type { RawGraphPoint } from "./raw-workspace-graph-layout"
import type { RawWorkspaceGraph } from "./raw-workspace-graph"

type Viewport = { x: number; y: number; width: number; height: number }
type Size = { width: number; height: number }

export function graphScreenPoint(point: RawGraphPoint, viewport: Viewport, size: Size) {
  const scale = Math.min(size.width / viewport.width, size.height / viewport.height)
  return {
    x: (point.x - viewport.x) * scale + (size.width - viewport.width * scale) / 2,
    y: (point.y - viewport.y) * scale + (size.height - viewport.height * scale) / 2,
  }
}

export function graphWorldPoint(x: number, y: number, viewport: Viewport, size: Size) {
  const scale = Math.min(size.width / viewport.width, size.height / viewport.height)
  return {
    x: viewport.x + (x - (size.width - viewport.width * scale) / 2) / scale,
    y: viewport.y + (y - (size.height - viewport.height * scale) / 2) / scale,
  }
}

export function graphHitTest(
  graph: RawWorkspaceGraph,
  points: Map<string, RawGraphPoint>,
  viewport: Viewport,
  size: Size,
  x: number,
  y: number,
) {
  let hit: string | undefined
  let distance = 10 * 10
  for (const node of graph.nodes) {
    const point = points.get(node.path)
    if (!point) continue
    const screen = graphScreenPoint(point, viewport, size)
    const next = (screen.x - x) ** 2 + (screen.y - y) ** 2
    if (next >= distance) continue
    distance = next
    hit = node.path
  }
  return hit
}

type PaintInput = {
  graph: RawWorkspaceGraph
  points: Map<string, RawGraphPoint>
  viewport: Viewport
  size: Size
  clusters: Map<string, { index: number; size: number }>
  degrees: Map<string, number>
  neighbors?: Set<string>
  hovered?: string
  labels: number
  nodeSize: number
  linkThickness: number
  arrows: boolean
  baseColor: string
  textColor: string
}

const COLORS = ["#7488a9", "#788f94", "#9588a4", "#a18e83"]

export function paintRawWorkspaceGraph(ctx: CanvasRenderingContext2D, input: PaintInput) {
  const { graph, points, viewport, size } = input
  ctx.clearRect(0, 0, size.width, size.height)
  const screen = new Map<string, { x: number; y: number }>()
  for (const node of graph.nodes) {
    const point = points.get(node.path)
    if (point) screen.set(node.path, graphScreenPoint(point, viewport, size))
  }
  ctx.lineCap = "round"
  for (const edge of graph.edges) {
    const from = screen.get(edge.source)
    const to = screen.get(edge.target)
    if (!from || !to) continue
    if ((from.x < 0 && to.x < 0) || (from.x > size.width && to.x > size.width)
      || (from.y < 0 && to.y < 0) || (from.y > size.height && to.y > size.height)) continue
    const emphasized = input.hovered === edge.source || input.hovered === edge.target
    ctx.globalAlpha = input.hovered ? (emphasized ? 0.8 : 0.1) : 0.36
    ctx.strokeStyle = input.baseColor
    ctx.lineWidth = (emphasized ? 2 : 1.25) * input.linkThickness
    ctx.setLineDash(edge.directions?.length === 0 ? [3, 3] : [])
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    if (input.arrows && edge.directions?.length) {
      ctx.setLineDash([])
      const arrow = (start: typeof from, end: typeof from) => {
        const angle = Math.atan2(end.y - start.y, end.x - start.x)
        const x = end.x - 7 * Math.cos(angle)
        const y = end.y - 7 * Math.sin(angle)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x - 5 * Math.cos(angle - 0.5), y - 5 * Math.sin(angle - 0.5))
        ctx.moveTo(x, y)
        ctx.lineTo(x - 5 * Math.cos(angle + 0.5), y - 5 * Math.sin(angle + 0.5))
        ctx.stroke()
      }
      if (edge.directions.includes(edge.source)) arrow(from, to)
      if (edge.directions.includes(edge.target)) arrow(to, from)
    }
  }
  ctx.setLineDash([])
  const threshold = (1.3 - input.labels) * 1000 * (graph.nodes.length > 500 ? 0.6 : 1)
  const labelOpacity = Math.min(0.8, (threshold - viewport.width) / (threshold * 0.25))
  const showLabels = viewport.width < threshold
  ctx.font = "12px sans-serif"
  for (const node of graph.nodes) {
    const point = screen.get(node.path)
    if (!point || point.x < -80 || point.x > size.width + 80 || point.y < -20 || point.y > size.height + 20) continue
    const related = !input.hovered || input.neighbors?.has(node.path)
    const cluster = input.clusters.get(node.path)
    const color = cluster && cluster.size > 1 ? COLORS[cluster.index % COLORS.length] : input.baseColor
    const radius = (2.5 + Math.min(input.degrees.get(node.path) ?? 0, 5) * 0.4) * input.nodeSize
    ctx.globalAlpha = related ? 0.8 : 0.2
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
    ctx.fill()
    if (!showLabels && node.path !== input.hovered) continue
    ctx.globalAlpha = node.path === input.hovered ? 1 : Math.max(0, labelOpacity) * (related ? 1 : 0.2)
    ctx.fillStyle = input.textColor
    ctx.fillText(node.title || node.fileName.replace(/\.(md|markdown)$/i, ""), point.x + 6, point.y + 4)
  }
  ctx.globalAlpha = 1
}
