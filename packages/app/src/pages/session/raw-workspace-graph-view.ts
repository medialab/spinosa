import type { RawWorkspaceGraph } from "./raw-workspace-graph"

export const GRAPH_SETTINGS_MIN_WIDTH = 640
export const GRAPH_SETTINGS_MIN_HEIGHT = 480

/** Settings panel needs the full pane when the graph viewport is constrained. Pure (testable without the canvas). */
export function graphSettingsNeedFullPane(width: number, height: number) {
  return width < GRAPH_SETTINGS_MIN_WIDTH || height < GRAPH_SETTINGS_MIN_HEIGHT
}

export type RawGraphFilters = {
  search: string
  attachments: boolean
  orphans: boolean
  localPath?: string
  depth: number
}

export function filterRawWorkspaceGraph(graph: RawWorkspaceGraph, filters: RawGraphFilters): RawWorkspaceGraph {
  const paths = new Set(graph.nodes.map((node) => node.path))
  const adjacency = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    if (!paths.has(edge.source) || !paths.has(edge.target)) continue
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set())
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set())
    adjacency.get(edge.source)!.add(edge.target)
    adjacency.get(edge.target)!.add(edge.source)
  }

  let local: Set<string> | undefined
  if (filters.localPath && paths.has(filters.localPath)) {
    local = new Set([filters.localPath])
    let frontier = [filters.localPath]
    for (let step = 0; step < filters.depth; step++) {
      frontier = frontier.flatMap((path) => [...(adjacency.get(path) ?? [])].filter((neighbor) => !local!.has(neighbor)))
      frontier.forEach((path) => local!.add(path))
    }
  }

  const query = filters.search.trim().toLocaleLowerCase()
  const nodes = graph.nodes.filter((node) => {
    if (local && !local.has(node.path)) return false
    if (!filters.attachments && !/\.(?:md|markdown)$/i.test(node.path)) return false
    if (!filters.orphans && !adjacency.has(node.path)) return false
    if (query && !`${node.path} ${node.title ?? ""}`.toLocaleLowerCase().includes(query)) return false
    return true
  })
  const visible = new Set(nodes.map((node) => node.path))
  return {
    nodes,
    edges: graph.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
    unreadable: graph.unreadable,
  }
}

export function incomingDegreeByPath(graph: RawWorkspaceGraph): Map<string, number> {
  const degrees = new Map<string, number>()
  for (const edge of graph.edges) {
    const targets = edge.directions?.map((source) => source === edge.source ? edge.target : edge.source)
      ?? [edge.source, edge.target]
    for (const target of targets) degrees.set(target, (degrees.get(target) ?? 0) + 1)
  }
  return degrees
}
