import type { RawGraphEdge, RawGraphNode } from "./raw-workspace-graph"

export type RawGraphPoint = { x: number; y: number }
export type RawGraphCluster = { id: string; nodePaths: string[] }
export type RawGraphForces = { center: number; repel: number; link: number; distance: number }

export const DEFAULT_GRAPH_FORCES: RawGraphForces = { center: 1, repel: 1, link: 1, distance: 1 }

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const NODE_CLEARANCE = 32
const LINK_LENGTH = 76

export function clusterRawWorkspaceGraph(
  nodes: readonly RawGraphNode[],
  edges: readonly RawGraphEdge[],
): RawGraphCluster[] {
  if (nodes.length === 0) return []
  if (edges.length === 0) {
    const folders = new Map<string, string[]>()
    for (const node of nodes) {
      const folder = node.path.slice(0, node.path.lastIndexOf("/"))
      const paths = folders.get(folder) ?? []
      paths.push(node.path)
      folders.set(folder, paths)
    }
    return [...folders.values()]
      .map((paths) => {
        paths.sort((a, b) => a.localeCompare(b))
        return { id: paths[0]!, nodePaths: paths }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  const indexByPath = new Map(nodes.map((node, index) => [node.path, index]))
  const adjacency = nodes.map(() => new Map<number, number>())
  for (const edge of edges) {
    const source = indexByPath.get(edge.source)
    const target = indexByPath.get(edge.target)
    if (source === undefined || target === undefined || source === target) continue
    const weight = edgeWeight(edge)
    adjacency[source]!.set(target, (adjacency[source]!.get(target) ?? 0) + weight)
    adjacency[target]!.set(source, (adjacency[target]!.get(source) ?? 0) + weight)
  }

  let graph = adjacency
  let members = nodes.map((_, index) => [index])
  let groups = members
  // Coarsen communities between passes so a long linked chain does not settle into pairs.
  for (let level = 0; level < 32; level++) {
    const community = moveIntoCommunities(graph)
    const memberGroups = new Map<number, number[]>()
    community.forEach((group, index) => {
      const indexes = memberGroups.get(group) ?? []
      indexes.push(index)
      memberGroups.set(group, indexes)
    })
    const orderedGroups = [...memberGroups.values()]
      .map((indexes) => ({ indexes, key: groupKey(indexes, members, nodes) }))
      .sort((left, right) => left.key.localeCompare(right.key))
    const groupByIndex = new Map<number, number>()
    groups = orderedGroups.map(({ indexes }, groupIndex) => {
      const originals = indexes.flatMap((index) => members[index]!)
      for (const index of indexes) groupByIndex.set(index, groupIndex)
      return originals
    })
    if (groups.length === graph.length) break
    graph = aggregateCommunities(graph, groupByIndex, groups.length)
    members = groups
  }

  return groups
    .map((indexes) => {
      const nodePaths = indexes.map((index) => nodes[index]!.path).sort((a, b) => a.localeCompare(b))
      return { id: nodePaths[0]!, nodePaths }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function groupKey(
  group: readonly number[],
  members: readonly number[][],
  nodes: readonly RawGraphNode[],
): string {
  let key: string | undefined
  for (const index of group) {
    for (const member of members[index]!) {
      const path = nodes[member]!.path
      if (!key || path.localeCompare(key) < 0) key = path
    }
  }
  return key ?? ""
}

function moveIntoCommunities(graph: readonly Map<number, number>[]): number[] {
  const degree = graph.map((neighbors) => [...neighbors.values()].reduce((sum, weight) => sum + weight, 0))
  const totalWeight = degree.reduce((sum, value) => sum + value, 0)
  const community = graph.map((_, index) => index)
  if (totalWeight === 0) return community

  const communityWeight = [...degree]
  for (let pass = 0; pass < 8; pass++) {
    let moved = false
    for (let index = 0; index < graph.length; index++) {
      const nodeDegree = degree[index]!
      if (nodeDegree === 0) continue

      const ownCommunity = community[index]!
      communityWeight[ownCommunity] = communityWeight[ownCommunity]! - nodeDegree
      const neighboringWeight = new Map<number, number>()
      for (const [neighbor, weight] of graph[index]!) {
        if (neighbor === index) continue
        const neighborCommunity = community[neighbor]!
        neighboringWeight.set(neighborCommunity, (neighboringWeight.get(neighborCommunity) ?? 0) + weight)
      }

      let bestCommunity = ownCommunity
      let bestGain = 0
      for (const [candidate, weight] of neighboringWeight) {
        const gain = weight - (nodeDegree * (communityWeight[candidate] ?? 0)) / totalWeight
        if (gain > bestGain + 1e-9) {
          bestGain = gain
          bestCommunity = candidate
        }
      }

      community[index] = bestCommunity
      communityWeight[bestCommunity] = communityWeight[bestCommunity]! + nodeDegree
      if (bestCommunity !== ownCommunity) moved = true
    }
    if (!moved) break
  }
  return community
}

function aggregateCommunities(
  graph: readonly Map<number, number>[],
  groupByIndex: ReadonlyMap<number, number>,
  groupCount: number,
): Array<Map<number, number>> {
  const aggregate = Array.from({ length: groupCount }, () => new Map<number, number>())
  const add = (from: number, to: number, weight: number) => {
    aggregate[from]!.set(to, (aggregate[from]!.get(to) ?? 0) + weight)
  }

  graph.forEach((neighbors, index) => {
    const from = groupByIndex.get(index)!
    for (const [neighbor, weight] of neighbors) {
      if (neighbor < index) continue
      const to = groupByIndex.get(neighbor)!
      if (from === to) add(from, from, index === neighbor ? weight : weight * 2)
      else {
        add(from, to, weight)
        add(to, from, weight)
      }
    }
  })
  return aggregate
}

export function layoutRawWorkspaceGraph(
  nodes: readonly RawGraphNode[],
  edges: readonly RawGraphEdge[],
  width = 1000,
  height = 680,
  clusters = clusterRawWorkspaceGraph(nodes, edges),
  forces: RawGraphForces = DEFAULT_GRAPH_FORCES,
): Map<string, RawGraphPoint> {
  if (nodes.length === 0) return new Map()

  const positions: Array<RawGraphPoint & { path: string; cluster: number; vx: number; vy: number }> = []
  const clusterCenters = new Map<number, RawGraphPoint>()
  const clusterByPath = new Map(clusters.flatMap((cluster, index) => cluster.nodePaths.map((path) => [path, index] as const)))
  const relations = clusters.map(() => new Map<number, number>())
  for (const edge of edges) {
    const source = clusterByPath.get(edge.source)
    const target = clusterByPath.get(edge.target)
    if (source === undefined || target === undefined || source === target) continue
    relations[source]!.set(target, (relations[source]!.get(target) ?? 0) + edgeWeight(edge))
    relations[target]!.set(source, (relations[target]!.get(source) ?? 0) + edgeWeight(edge))
  }
  const degree = relations.map((neighbors) => [...neighbors.values()].reduce((sum, weight) => sum + weight, 0))
  const ranked = clusters.map((_, index) => index).sort((a, b) =>
    degree[b]! - degree[a]! || clusters[b]!.nodePaths.length - clusters[a]!.nodePaths.length || a - b,
  )
  const order: number[] = []
  const seen = new Set<number>()
  for (const root of ranked) {
    if (seen.has(root)) continue
    const queue = [root]
    seen.add(root)
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head]!
      order.push(index)
      const neighbors = [...relations[index]!].sort((a, b) => b[1] - a[1] || a[0] - b[0])
      for (const [neighbor] of neighbors) {
        if (seen.has(neighbor)) continue
        seen.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  const largestCluster = clusters.reduce((largest, cluster) => Math.max(largest, cluster.nodePaths.length), 0)
  const spacing = Math.max(90, Math.sqrt(largestCluster) * NODE_CLEARANCE * 1.4) / Math.max(0.25, forces.center)
  order.forEach((index, rank) => {
    const angle = rank * GOLDEN_ANGLE
    const distance = Math.sqrt(rank) * spacing
    const jitterAngle = pathAngle(clusters[index]!.id)
    const jitter = rank === 0 ? 0 : spacing * 0.35
    clusterCenters.set(index, {
      x: width / 2 + Math.cos(angle) * distance + Math.cos(jitterAngle) * jitter,
      y: height / 2 + Math.sin(angle) * distance + Math.sin(jitterAngle) * jitter,
    })
  })

  clusters.forEach((cluster, clusterIndex) => {
    const center = clusterCenters.get(clusterIndex)!

    cluster.nodePaths.forEach((path, nodeIndex) => {
      const angle = nodeIndex * GOLDEN_ANGLE + pathAngle(path)
      const distance =
        cluster.nodePaths.length === 1 ? 0 : Math.sqrt(nodeIndex + 0.5) * NODE_CLEARANCE * 0.65
      positions.push({
        path,
        cluster: clusterIndex,
        x: center.x + Math.cos(angle) * distance,
        y: center.y + Math.sin(angle) * distance,
        vx: 0,
        vy: 0,
      })
    })
  })

  const indexByPath = new Map(positions.map((point, index) => [point.path, index]))
  const springs = edges.flatMap((edge) => {
    const source = indexByPath.get(edge.source)
    const target = indexByPath.get(edge.target)
    if (source === undefined || target === undefined) return []
    return [{ source, target, weight: edgeWeight(edge) }]
  })
  const count = positions.length
  const allIndexes = positions.map((_, index) => index)
  const iterations = edges.length === 0 ? 1 : Math.max(4, Math.min(64, Math.floor(1_600_000 / (count * count))))

  for (let iteration = 0; iteration < iterations; iteration++) {
    const cooling = 1 - iteration / iterations
    repelNearNeighbors(positions, allIndexes, cooling, forces.repel)

    for (const spring of springs) {
      const a = positions[spring.source]!
      const b = positions[spring.target]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.max(0.01, Math.hypot(dx, dy))
      const force = ((distance - LINK_LENGTH * forces.distance) / distance) * 0.012 * spring.weight * cooling * forces.link
      a.vx += dx * force
      a.vy += dy * force
      b.vx -= dx * force
      b.vy -= dy * force
    }

    for (const point of positions) {
      const center = clusterCenters.get(point.cluster)!
      point.vx = (point.vx + (center.x - point.x) * 0.0015 * forces.center) * 0.78
      point.vy = (point.vy + (center.y - point.y) * 0.0015 * forces.center) * 0.78
      point.x += point.vx
      point.y += point.vy
    }
  }

  const xs = positions.map((point) => point.x)
  const ys = positions.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const scale = Math.min(1, (width - 40) / Math.max(1, maxX - minX), (height - 40) / Math.max(1, maxY - minY))
  const offsetX = width / 2 - ((minX + maxX) / 2) * scale
  const offsetY = height / 2 - ((minY + maxY) / 2) * scale
  return new Map(positions.map(({ path, x, y }) => [path, { x: x * scale + offsetX, y: y * scale + offsetY }]))
}

function repelNearNeighbors(
  points: Array<RawGraphPoint & { path: string; cluster: number; vx: number; vy: number }>,
  indexes: readonly number[],
  cooling: number,
  repel: number,
) {
  const buckets = new Map<string, number[]>()
  for (const index of indexes) {
    const point = points[index]!
    const x = Math.floor(point.x / NODE_CLEARANCE)
    const y = Math.floor(point.y / NODE_CLEARANCE)
    const key = `${x}:${y}`
    const bucket = buckets.get(key) ?? []
    bucket.push(index)
    buckets.set(key, bucket)
  }

  for (let left = 0; left < indexes.length; left++) {
    const aIndex = indexes[left]!
    const a = points[aIndex]!
    const cellX = Math.floor(a.x / NODE_CLEARANCE)
    const cellY = Math.floor(a.y / NODE_CLEARANCE)
    for (let x = cellX - 1; x <= cellX + 1; x++) {
      for (let y = cellY - 1; y <= cellY + 1; y++) {
        for (const bIndex of buckets.get(`${x}:${y}`) ?? []) {
          if (bIndex <= aIndex) continue
          const b = points[bIndex]!
          let dx = b.x - a.x
          let dy = b.y - a.y
          let distance = Math.hypot(dx, dy)
          if (distance < 0.01) {
            dx = (aIndex + 1) * 0.01
            dy = (bIndex + 1) * -0.01
            distance = Math.hypot(dx, dy)
          }
          if (distance >= NODE_CLEARANCE) continue
          const force = ((NODE_CLEARANCE - distance) / distance) * 0.035 * cooling * repel
          a.vx -= dx * force
          a.vy -= dy * force
          b.vx += dx * force
          b.vy += dy * force
        }
      }
    }
  }
}

function pathAngle(path: string): number {
  let hash = 0
  for (let index = 0; index < path.length; index++) hash = (hash * 31 + path.charCodeAt(index)) | 0
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2
}

function edgeWeight(edge: RawGraphEdge): number {
  // Explicit file links carry more signal than inferred shared-header links.
  return edge.kinds.reduce((weight, kind) => weight + (kind === "header" ? 1 : 2), 0)
}
