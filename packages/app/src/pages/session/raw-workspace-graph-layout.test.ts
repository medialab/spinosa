import { describe, expect, test } from "bun:test"
import { buildRawWorkspaceGraph, type RawGraphEdge } from "./raw-workspace-graph"
import { clusterRawWorkspaceGraph, DEFAULT_GRAPH_FORCES, layoutRawWorkspaceGraph } from "./raw-workspace-graph-layout"

describe("raw workspace graph layout", () => {
  test("lays out every file deterministically within the graph viewport", () => {
    const graph = buildRawWorkspaceGraph([
      { path: "raw/a.md", content: "---\nconnects_to: raw/b.md\n---" },
      { path: "raw/b.md" },
      { path: "raw/c.md" },
    ])

    const first = layoutRawWorkspaceGraph(graph.nodes, graph.edges, 800, 500)
    const second = layoutRawWorkspaceGraph(graph.nodes, graph.edges, 800, 500)

    expect([...first]).toEqual([...second])
    expect(first.size).toBe(graph.nodes.length)
    for (const point of first.values()) {
      expect(point.x).toBeGreaterThanOrEqual(20)
      expect(point.x).toBeLessThanOrEqual(780)
      expect(point.y).toBeGreaterThanOrEqual(20)
      expect(point.y).toBeLessThanOrEqual(480)
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
    }
  })

  test("centers a single-community graph in the viewport", () => {
    const point = layoutRawWorkspaceGraph([{ path: "raw/only.md", fileName: "only.md" }], [], 800, 500).get(
      "raw/only.md",
    )

    expect(point).toEqual({ x: 400, y: 250 })
  })

  test("places disconnected communities around a circle instead of on grid rows", () => {
    const nodes = Array.from({ length: 9 }, (_, index) => ({ path: `raw/${index}.md`, fileName: `${index}.md` }))
    const points = [...layoutRawWorkspaceGraph(nodes, [], 800, 500).values()]

    expect(new Set(points.map((point) => Math.round(point.x))).size).toBeGreaterThan(6)
    expect(new Set(points.map((point) => Math.round(point.y))).size).toBeGreaterThan(6)
    expect(points.some((point) => Math.hypot(point.x - 400, point.y - 250) < 75)).toBe(true)
  })

  test("places related communities closer than disconnected communities", () => {
    const nodes = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((name) => ({ path: `raw/${name}.md`, fileName: `${name}.md` }))
    const clusters = nodes.map((node) => ({ id: node.path, nodePaths: [node.path] }))
    const edges: RawGraphEdge[] = [{ source: "raw/a.md", target: "raw/i.md", kinds: ["header"] }]
    const points = layoutRawWorkspaceGraph(nodes, edges, 800, 500, clusters)
    const distance = (left: string, right: string) => {
      const a = points.get(`raw/${left}.md`)!
      const b = points.get(`raw/${right}.md`)!
      return Math.hypot(a.x - b.x, a.y - b.y)
    }

    expect(distance("a", "i")).toBeLessThan(distance("a", "b"))
    expect(distance("a", "i")).toBeLessThan(distance("a", "c"))
  })

  test("link distance changes the geometry rather than only the control value", () => {
    const nodes = ["a", "b", "c"].map((name) => ({ path: `raw/${name}.md`, fileName: `${name}.md` }))
    const edges: RawGraphEdge[] = [{ source: nodes[0]!.path, target: nodes[1]!.path, kinds: ["wikilink"] }]
    const normal = layoutRawWorkspaceGraph(nodes, edges)
    const longer = layoutRawWorkspaceGraph(nodes, edges, 1000, 680, undefined, { ...DEFAULT_GRAPH_FORCES, distance: 2 })
    const separation = (points: Map<string, { x: number; y: number }>) => {
      const a = points.get(nodes[0]!.path)!
      const b = points.get(nodes[1]!.path)!
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    expect(separation(longer)).toBeGreaterThan(separation(normal))
  })

  test("groups unlinked files by immediate folder without adding file links", () => {
    const nodes = ["a", "b", "c", "d"].map((name, index) => ({
      path: `raw/Ex${index < 2 ? 1 : 2}/${name}.md`,
      fileName: `${name}.md`,
    }))
    const clusters = clusterRawWorkspaceGraph(nodes, [])
    expect(clusters.map((cluster) => cluster.nodePaths)).toEqual([
      ["raw/Ex1/a.md", "raw/Ex1/b.md"], ["raw/Ex2/c.md", "raw/Ex2/d.md"],
    ])
  })

  test("separates dense communities from one another and leaves unrelated files as their own clusters", () => {
    const graph = buildRawWorkspaceGraph([
      { path: "raw/a.md" },
      { path: "raw/b.md" },
      { path: "raw/c.md" },
      { path: "raw/d.md" },
      { path: "raw/e.md" },
      { path: "raw/f.md" },
      { path: "raw/isolated.md" },
    ])
    const edges = [
      ["raw/a.md", "raw/b.md"],
      ["raw/a.md", "raw/c.md"],
      ["raw/b.md", "raw/c.md"],
      ["raw/d.md", "raw/e.md"],
      ["raw/d.md", "raw/f.md"],
      ["raw/e.md", "raw/f.md"],
    ].map(([source, target]) => ({ source: source!, target: target!, kinds: ["wikilink"] as RawGraphEdge["kinds"] }))
    edges.push({ source: "raw/c.md", target: "raw/d.md", kinds: ["header"] })

    expect(clusterRawWorkspaceGraph(graph.nodes, edges).map((cluster) => cluster.nodePaths)).toEqual([
      ["raw/a.md", "raw/b.md", "raw/c.md"],
      ["raw/d.md", "raw/e.md", "raw/f.md"],
      ["raw/isolated.md"],
    ])
  })

  test("groups a long relation chain into larger communities rather than one cluster per edge", () => {
    const files = Array.from({ length: 30 }, (_, index) => ({ path: `raw/${String(index).padStart(2, "0")}.md` }))
    const graph = buildRawWorkspaceGraph(files)
    const edges = files.slice(1).map((file, index) => ({
      source: files[index]!.path,
      target: file.path,
      kinds: ["header"] as RawGraphEdge["kinds"],
    }))
    const clusters = clusterRawWorkspaceGraph(graph.nodes, edges)

    expect(clusters.length).toBeGreaterThan(1)
    expect(clusters.length).toBeLessThan(10)
    expect(clusters.every((cluster) => cluster.nodePaths.length > 2)).toBe(true)
  })
})
