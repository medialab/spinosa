import type { RawGraphEdge, RawGraphNode } from "./raw-workspace-graph"

export type RawGraphPoint = { x: number; y: number }
export type RawGraphCluster = { id: string; nodePaths: string[] }

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const NODE_CLEARANCE = 32
const LINK_LENGTH = 76

export function clusterRawWorkspaceGraph(
  nodes: readonly RawGraphNode[],
  edges: readonly RawGraphEdge[],
): RawGraphCluster[] {
  if (nodes.length === 0) return []

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
): Map<string, RawGraphPoint> {
  if (nodes.length === 0) return new Map()

  const columns = clusters.length === 1 ? 1 : Math.ceil(Math.sqrt((clusters.length * width) / height))
  const rows = Math.ceil(clusters.length / columns)
  const cellWidth = width / columns
  const cellHeight = height / rows
  const positions: Array<RawGraphPoint & { path: string; cluster: number; vx: number; vy: number }> = []
  const clusterCenters = new Map<number, RawGraphPoint>()

  clusters.forEach((cluster, clusterIndex) => {
    const column = clusterIndex % columns
    const row = Math.floor(clusterIndex / columns)
    const center = { x: (column + 0.5) * cellWidth, y: (row + 0.5) * cellHeight }
    clusterCenters.set(clusterIndex, center)
    const radius = Math.min(cellWidth, cellHeight) * 0.38

    cluster.nodePaths.forEach((path, nodeIndex) => {
      const angle = nodeIndex * GOLDEN_ANGLE + pathAngle(path)
      const distance =
        cluster.nodePaths.length === 1 ? 0 : Math.sqrt((nodeIndex + 0.5) / cluster.nodePaths.length) * radius
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
  const clusterPositions = clusters.map((cluster) =>
    cluster.nodePaths.flatMap((path) => {
      const index = indexByPath.get(path)
      return index === undefined ? [] : [index]
    }),
  )
  const count = positions.length
  const iterations = Math.max(1, Math.min(64, Math.floor(1_600_000 / (count * count))))

  for (let iteration = 0; iteration < iterations; iteration++) {
    const cooling = 1 - iteration / iterations
    for (const indexes of clusterPositions) repelNearNeighbors(positions, indexes, cooling)

    for (const spring of springs) {
      const a = positions[spring.source]!
      const b = positions[spring.target]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.max(0.01, Math.hypot(dx, dy))
      const force = ((distance - LINK_LENGTH) / distance) * 0.012 * spring.weight * cooling
      a.vx += dx * force
      a.vy += dy * force
      b.vx -= dx * force
      b.vy -= dy * force
    }

    for (const point of positions) {
      const center = clusterCenters.get(point.cluster)!
      const column = point.cluster % columns
      const row = Math.floor(point.cluster / columns)
      const left = column * cellWidth + 12
      const right = (column + 1) * cellWidth - 12
      const top = row * cellHeight + 12
      const bottom = (row + 1) * cellHeight - 12
      point.vx = (point.vx + (center.x - point.x) * 0.0015) * 0.78
      point.vy = (point.vy + (center.y - point.y) * 0.0015) * 0.78
      point.x = Math.min(right, Math.max(left, point.x + point.vx))
      point.y = Math.min(bottom, Math.max(top, point.y + point.vy))
    }
  }

  return new Map(positions.map(({ path, x, y }) => [path, { x, y }]))
}

function repelNearNeighbors(
  points: Array<RawGraphPoint & { path: string; cluster: number; vx: number; vy: number }>,
  indexes: readonly number[],
  cooling: number,
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
          const force = ((NODE_CLEARANCE - distance) / distance) * 0.035 * cooling
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
