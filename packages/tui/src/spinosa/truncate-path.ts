const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function graphemes(text: string): string[] {
  return [...graphemeSegmenter.segment(text)].map((segment) => segment.segment)
}

/** Terminal cell width of one grapheme cluster (wide/CJK/emoji aware). */
function clusterCells(cluster: string): number {
  return Bun.stringWidth(cluster)
}

function fits(cells: number, maxCells: number): boolean {
  return cells <= maxCells
}

/**
 * Keep the tail (basename end) within a cell budget, prefixed with ….
 * Grapheme-safe: never splits surrogates, combining marks, or emoji sequences.
 */
export function truncatePathTail(filePath: string, maxLen = 48): string {
  const clusters = graphemes(filePath)
  const total = clusters.reduce((sum, cluster) => sum + clusterCells(cluster), 0)
  if (fits(total, maxLen)) return filePath
  // Reserve one cell for the ellipsis, then take the newest fitting suffix.
  const kept: string[] = []
  let used = 1
  for (let at = clusters.length - 1; at >= 0; at--) {
    const width = clusterCells(clusters[at]!)
    if (used + width > maxLen) break
    kept.unshift(clusters[at]!)
    used += width
  }
  return `…${kept.join("")}`
}

/**
 * Keep the head within a cell budget, suffixed with ….
 * Same grapheme/cell rules as truncatePathTail, for labels and counters.
 */
export function truncateHead(text: string, maxCells: number): string {
  const clusters = graphemes(text)
  const total = clusters.reduce((sum, cluster) => sum + clusterCells(cluster), 0)
  if (fits(total, maxCells)) return text
  const kept: string[] = []
  let used = 1
  for (const cluster of clusters) {
    const width = clusterCells(cluster)
    if (used + width > maxCells) break
    kept.push(cluster)
    used += width
  }
  return `${kept.join("")}…`
}