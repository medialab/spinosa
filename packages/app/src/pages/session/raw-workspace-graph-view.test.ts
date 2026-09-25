import { describe, expect, test } from "bun:test"
import { buildRawWorkspaceGraph } from "./raw-workspace-graph"
import { filterRawWorkspaceGraph, incomingDegreeByPath, type RawGraphFilters } from "./raw-workspace-graph-view"

const graph = buildRawWorkspaceGraph([
  { path: "raw/a.md", content: "[[b]]" },
  { path: "raw/b.md", content: "[[c]]" },
  { path: "raw/c.md" },
  { path: "raw/orphan.md" },
  { path: "raw/photo.png" },
])
const defaults: RawGraphFilters = { search: "", attachments: true, orphans: true, depth: 1 }

describe("raw graph view", () => {
  test("limits a local graph by link depth", () => {
    expect(filterRawWorkspaceGraph(graph, { ...defaults, localPath: "raw/a.md" }).nodes.map((node) => node.path)).toEqual([
      "raw/a.md", "raw/b.md",
    ])
    expect(filterRawWorkspaceGraph(graph, { ...defaults, localPath: "raw/a.md", depth: 2 }).edges).toHaveLength(2)
  })

  test("filters attachments, orphans, and search without dangling edges", () => {
    const result = filterRawWorkspaceGraph(graph, { ...defaults, attachments: false, orphans: false, search: "b" })
    expect(result.nodes.map((node) => node.path)).toEqual(["raw/b.md"])
    expect(result.edges).toEqual([])
  })

  test("sizes nodes by incoming references, not outgoing or inferred metadata bonds", () => {
    const degrees = incomingDegreeByPath(graph)
    expect(degrees.get("raw/a.md")).toBeUndefined()
    expect(degrees.get("raw/b.md")).toBe(1)
    expect(degrees.get("raw/c.md")).toBe(1)
  })
})
