import { describe, expect, test } from "bun:test"
import { graphHitTest, graphScreenPoint, graphWorldPoint } from "./raw-workspace-graph-canvas"

describe("graph canvas coordinates", () => {
  const viewport = { x: 100, y: 100, width: 200, height: 100 }
  const size = { width: 800, height: 400 }

  test("maps layout positions into the visible canvas", () => {
    expect(graphScreenPoint({ x: 200, y: 150 }, viewport, size)).toEqual({ x: 400, y: 200 })
    expect(graphScreenPoint({ x: 200, y: 150 }, viewport, { width: 1000, height: 400 })).toEqual({ x: 500, y: 200 })
    expect(graphWorldPoint(500, 200, viewport, { width: 1000, height: 400 })).toEqual({ x: 200, y: 150 })
  })

  test("hits the nearest node in screen pixels", () => {
    const graph = { nodes: [
      { path: "raw/one.md", title: "one", fileName: "one.md" },
      { path: "raw/two.md", title: "two", fileName: "two.md" },
    ], edges: [], unreadable: 0 }
    const points = new Map([["raw/one.md", { x: 200, y: 150 }], ["raw/two.md", { x: 250, y: 150 }]])
    expect(graphHitTest(graph, points, viewport, size, 404, 201)).toBe("raw/one.md")
    expect(graphHitTest(graph, points, viewport, size, 430, 201)).toBeUndefined()
  })
})
