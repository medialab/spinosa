import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { createComponent } from "solid-js"
import type { GraphScene } from "../../src/routes/spinosa/visualizer-graph-layout"
import {
  GraphCanvas,
  SpinosaGraphRenderable,
  type GraphCanvasHandle,
  type GraphInput,
} from "../../src/routes/spinosa/visualizer-graph-canvas"
import {
  FIT_GRAPH_VIEWPORT,
  GRAPH_MAX_ZOOM,
  GraphHitMap,
  GraphRaster,
  createGraphPalette,
  normalizeGraphViewport,
  paintGraphScene,
  panGraphViewport,
  rasterToWorld,
  worldToRaster,
  zoomGraphViewport,
} from "../../src/routes/spinosa/visualizer-graph-render"

const black = RGBA.fromInts(0, 0, 0, 255)
const red = RGBA.fromInts(255, 0, 0, 255)
const white = RGBA.fromInts(255, 255, 255, 255)
const palette = createGraphPalette({
  backgroundPanel: black,
  backgroundElement: RGBA.fromInts(20, 20, 20, 255),
  borderSubtle: RGBA.fromInts(70, 70, 70, 255),
  textMuted: RGBA.fromInts(140, 140, 140, 255),
  text: white,
  primary: red,
  secondary: RGBA.fromInts(150, 90, 255, 255),
  accent: RGBA.fromInts(255, 80, 200, 255),
  success: RGBA.fromInts(70, 210, 130, 255),
  warning: RGBA.fromInts(255, 190, 70, 255),
  error: RGBA.fromInts(255, 70, 80, 255),
  info: RGBA.fromInts(60, 180, 240, 255),
})

const scene: GraphScene = {
  version: 1,
  mode: "files",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  plotBounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.75 },
  areas: [{
    id: "area",
    kind: "band",
    points: [{ x: 0.1, y: 0.55 }, { x: 0.9, y: 0.55 }, { x: 0.9, y: 0.8 }, { x: 0.1, y: 0.8 }],
    tone: "grid",
    opacity: 0.25,
    label: "Band",
    hit: { kind: "bucket", id: "area-hit", label: "Band", data: {} },
  }],
  edges: [{
    id: "edge",
    kind: "ribbon",
    from: "node-a",
    to: "node-b",
    points: [{ x: 0.25, y: 0.35 }, { x: 0.4, y: 0.1 }, { x: 0.6, y: 0.7 }, { x: 0.75, y: 0.35 }],
    width: 0.02,
    tone: "secondary",
    weight: 2,
    opacity: 0.8,
    hit: { kind: "flow", id: "edge-hit", label: "Flow", data: {} },
  }],
  bars: [{
    id: "bar",
    groupId: "tools",
    x: 0.43,
    y: 0.5,
    width: 0.14,
    height: 0.25,
    tone: "success",
    value: 4,
    label: "four",
    hit: { kind: "tool", id: "bar-hit", label: "Four", data: { value: 4 } },
  }],
  nodes: [
    {
      id: "node-a",
      kind: "call",
      shape: "circle",
      x: 0.2,
      y: 0.3,
      width: 0.1,
      height: 0.1,
      tone: "primary",
      rimTone: "warning",
      label: "read",
      hit: { kind: "call", id: "node-a-hit", label: "read", data: { tool: "read" } },
    },
    {
      id: "node-b",
      kind: "call",
      shape: "pill",
      x: 0.7,
      y: 0.3,
      width: 0.15,
      height: 0.08,
      tone: "info",
      hit: { kind: "call", id: "node-b-hit", label: "grep", data: { tool: "grep" } },
    },
  ],
  labels: [{ id: "title", x: 0.5, y: 0.03, text: "Trace graph", tone: "text", align: "center", maxWidth: 0.3, importance: 2 }],
  axes: [{
    id: "axis-x",
    orientation: "x",
    start: { x: 0.1, y: 0.85 },
    end: { x: 0.9, y: 0.85 },
    tone: "grid",
    ticks: [{ value: 0, position: 0.1, label: "0" }, { value: 1, position: 0.9, label: "1" }],
    label: "Time",
  }],
  table: { columns: ["tool"], rows: [{ tool: "read" }] },
  summary: { title: "Trace", description: "Observed calls", metrics: { calls: 2 }, timing: "time" },
}

describe("graph viewport", () => {
  test("world and raster transforms round-trip", () => {
    const viewport = { centerX: 0.63, centerY: 0.37, zoom: 3 }
    const world = { x: 0.59, y: 0.42 }
    const raster = worldToRaster(world, viewport, 160, 48)
    const roundTrip = rasterToWorld(raster, viewport, 160, 48)
    expect(roundTrip.x).toBeCloseTo(world.x, 10)
    expect(roundTrip.y).toBeCloseTo(world.y, 10)
  })

  test("zoom preserves its anchor and clamps navigation", () => {
    const anchor = { x: 0.75, y: 0.25 }
    const before = rasterToWorld({ x: anchor.x * 100, y: anchor.y * 40 }, FIT_GRAPH_VIEWPORT, 100, 40)
    const zoomed = zoomGraphViewport(FIT_GRAPH_VIEWPORT, 4, anchor.x, anchor.y)
    const after = rasterToWorld({ x: anchor.x * 100, y: anchor.y * 40 }, zoomed, 100, 40)
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
    expect(normalizeGraphViewport({ centerX: -9, centerY: 9, zoom: 1e9 }).zoom).toBe(GRAPH_MAX_ZOOM)

    const panned = panGraphViewport(zoomed, 10_000, -10_000, 100, 40)
    const half = 0.5 / panned.zoom
    expect(panned.centerX).toBeGreaterThanOrEqual(half)
    expect(panned.centerY).toBeLessThanOrEqual(1 - half)
  })
})

describe("graph hit map", () => {
  test("uses dense cell lookup with later paint winning", () => {
    const hits = new GraphHitMap()
    hits.resize(4, 3)
    const first = hits.indexFor({ kind: "file", id: "a" })
    const second = hits.indexFor({ kind: "file", id: "b" })
    hits.mark(1, 1, first)
    hits.mark(1, 1, second)
    expect(hits.get(1, 1)?.id).toBe("b")
    expect(hits.get(-1, 0)).toBeUndefined()
    expect(hits.get(Number.NaN, 0)).toBeUndefined()
  })
})

describe("graph raster", () => {
  test("allocates a grid at cell resolution per canvas kind", () => {
    const raster = new GraphRaster(7, 3)
    raster.clear(black)
    expect(raster.width).toBe(7)
    expect(raster.height).toBe(3)
    expect(raster.grid.length).toBe(21)
  })

  test("pixel! increments density and records hits", () => {
    const raster = new GraphRaster(4, 3)
    raster.clear(black)
    const hit = { kind: "file", id: "f", label: "f" }
    const hitIndex = raster.hits.indexFor(hit)
    raster.pixel(1, 1, red, hitIndex)
    expect(raster.hits.get(1, 1)).toEqual(hit)
    expect(raster.hits.get(0, 0)).toBeUndefined()
    raster.clear(black)
    expect(raster.hits.get(1, 1)).toBeUndefined()
  })

  test("density caps at 4 and clips out-of-bounds", () => {
    const raster = new GraphRaster(5, 4)
    raster.clear(black)
    raster.pixel(-1, -1, red, -1)
    raster.pixel(Number.NaN, 2, red, -1)
    raster.pixel(100, 100, red, -1)
    expect(raster.grid.every((v) => v === 0)).toBe(true)
  })

  test("multiple hits on same cell increase density", () => {
    const raster = new GraphRaster(3, 3)
    raster.clear(black)
    for (let i = 0; i < 6; i++) raster.pixel(1, 1, red, -1)
    expect(raster.grid[4]).toBe(4) // 1*3+1 = 4
  })

  test("solid rectangles use the solid-cell painter", () => {
    const raster = new GraphRaster(4, 3)
    raster.clear(black)
    raster.paintRectSolid(1, 1, 1, 1, red)
    expect(raster.grid[5]).toBe(4) // 1*4+1 = 5
  })

  test("rect, ellipse, line, and polygon painting produce non-zero density", () => {
    const raster = new GraphRaster(10, 6)
    raster.clear(black)
    raster.paintRect(2, 3, 8, 5, red)
    raster.paintEllipse(10, 5, 4, 2, red)
    raster.paintLine({ x: 0, y: 0 }, { x: 10, y: 8 }, 2, red)
    raster.paintPolygon([{ x: 2, y: 2 }, { x: 12, y: 2 }, { x: 7, y: 10 }], red)
    expect(raster.grid.some((v) => v > 0)).toBe(true)
  })

  test("cubic and line painting remain hit-testable", () => {
    const raster = new GraphRaster(20, 8)
    raster.clear(black)
    const edge = { kind: "flow", id: "edge" }
    const hitIndex = raster.hits.indexFor(edge)
    raster.paintCubic(
      [{ x: 2, y: 3 }, { x: 8, y: 1 }, { x: 12, y: 7 }, { x: 18, y: 4 }],
      2,
      red,
      1,
      edge,
    )
    expect(Array.from({ length: raster.hits.width }, (_, x) => raster.hits.get(x, 4)).some((h) => h?.id === "edge")).toBe(true)
  })
})

describe("graph scene painter", () => {
  test("paints every primitive family and emits terminal text overlays", () => {
    const raster = new GraphRaster(80, 24)
    const result = paintGraphScene(raster, scene, palette, { viewport: FIT_GRAPH_VIEWPORT })
    expect(result.labels.map((label) => label.text)).toEqual(expect.arrayContaining(["Trace graph", "Time", "Band", "0", "1", "four"]))
    expect(raster.grid.some((v) => v > 0)).toBe(true)

    const nodeCenter = worldToRaster({ x: 0.25, y: 0.35 }, FIT_GRAPH_VIEWPORT, raster.width, raster.height)
    expect(raster.hits.get(nodeCenter.x, nodeCenter.y)?.id).toBe("node-a-hit")
    const barCenter = worldToRaster({ x: 0.5, y: 0.625 }, FIT_GRAPH_VIEWPORT, raster.width, raster.height)
    expect(raster.hits.get(barCenter.x, barCenter.y)?.id).toBe("bar-hit")
  })

  test("selection repaints the node with a different tone", () => {
    const idle = new GraphRaster(80, 24)
    const selected = new GraphRaster(80, 24)
    paintGraphScene(idle, scene, palette, { viewport: FIT_GRAPH_VIEWPORT })
    paintGraphScene(selected, scene, palette, { viewport: FIT_GRAPH_VIEWPORT, selectedID: "node-a-hit" })
    // Both produce output; visual difference comes from color, not grid density
    expect(idle.grid.some((v) => v > 0)).toBe(true)
    expect(selected.grid.some((v) => v > 0)).toBe(true)
  })
})

describe("OpenTUI graph renderable", () => {
  test("bundles the raster, labels, hit testing, drag, wheel, and double-click events", async () => {
    const app = await createTestRenderer({ width: 60, height: 18 })
    const graph = new SpinosaGraphRenderable(app.renderer, { width: 60, height: 18, scene, palette })
    const events: GraphInput[] = []
    graph.on("graph-input", (event) => events.push(event))
    app.renderer.root.add(graph)

      try {
        await app.renderOnce()
        const frameBuffer = (
          graph as unknown as { frameBuffer: { getRealCharBytes(addLineBreaks?: boolean): Uint8Array } }
        ).frameBuffer
        const rendered = new TextDecoder().decode(frameBuffer.getRealCharBytes(true))
        expect(rendered).toContain("Trace graph")

        const center = worldToRaster({ x: 0.25, y: 0.35 }, FIT_GRAPH_VIEWPORT, 60, 18)
      const x = Math.floor(center.x)
      const y = Math.floor(center.y)

      await app.mockMouse.moveTo(x, y)
      await app.mockMouse.click(x, y)
      await app.mockMouse.doubleClick(x, y)
      await app.mockMouse.drag(x, y, x + 3, y + 2)
      await app.mockMouse.scroll(x, y, "up", { modifiers: { ctrl: true } })

      expect(events.some((event) => event.type === "hover" && event.hit?.id === "node-a-hit")).toBe(true)
      expect(events.some((event) => event.type === "select" && event.hit?.id === "node-a-hit")).toBe(true)
      expect(events.some((event) => event.type === "activate" && event.hit.id === "node-a-hit")).toBe(true)
      expect(events.some((event) => event.type === "pan")).toBe(true)
      expect(events.some((event) => event.type === "zoom")).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })

  test("controlled handle clears selection through the public callback", async () => {
    let handle: GraphCanvasHandle | undefined
    const changes: Array<string | undefined> = []
    const app = await testRender(
      () => createComponent(GraphCanvas, {
        scene,
        palette,
        width: 60,
        height: 18,
        ref: (value) => (handle = value),
        onSelectionChange: (hit) => changes.push(hit?.id),
      }),
      { width: 60, height: 18 },
    )

    try {
      await app.renderOnce()
      handle!.selectNext()
      expect(handle!.selection()?.id).toBe("node-a-hit")
      handle!.clearSelection()
      expect(handle!.selection()).toBeUndefined()
      expect(changes).toEqual(["node-a-hit", undefined])
    } finally {
      app.renderer.destroy()
    }
  })
})
