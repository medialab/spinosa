// Deterministic Unicode figures for spinosa-writer.
// The model supplies kind, numbers, and labels. This module owns scale,
// zero baseline, frame width, caption, and source/units footer.

export const FIGURE_WIDTH = 52
export const SPARKLINE_CHARS = "▁▂▃▄▅▆▇█"
export const BAR_FILLED = "▓"
export const BAR_EMPTY = "░"
export const STACKED_CHARS = ["█", "▓", "▒", "░"] as const

const INNER_WIDTH = FIGURE_WIDTH - 2
const LABEL_WIDTH = 10
const VALUE_WIDTH = 10
const BAR_WIDTH = INNER_WIDTH - LABEL_WIDTH - VALUE_WIDTH - 2
const STACKED_BAR_WIDTH = INNER_WIDTH - LABEL_WIDTH - 1
const SPARKLINE_WIDTH = 28

const FENCE_RE = /```(?:text)?[ \t]*\r?\n([\s\S]*?)```/
const GLYPH_RE = /[┌┐└┘│─┤▓░█▒▁▂▃▄▅▆▇✓⚠✗○◉]/
const SOURCE_RE = /\bsource\s*:/i
const UNITS_RE = /\bunits\s*:/i

export type FigureKind = "bar" | "sparkline" | "stacked_bar" | "status_matrix"

export type StatusCell = "pass" | "warning" | "fail" | "pending" | "active"

export type BarItem = {
  label: string
  value: number
}

export type StackedSegment = {
  label: string
  value: number
}

export type StatusRow = {
  label: string
  cells: readonly StatusCell[]
}

export type FigureMeta = {
  title: string
  caption: string
  source: string
  units: string
}

export type FigureInput =
  | (FigureMeta & { kind: "bar"; items: readonly BarItem[] })
  | (FigureMeta & { kind: "sparkline"; values: readonly number[]; label?: string })
  | (FigureMeta & { kind: "stacked_bar"; segments: readonly StackedSegment[] })
  | (FigureMeta & { kind: "status_matrix"; columns: readonly string[]; rows: readonly StatusRow[] })

export type MarkdownFigureResult = { ok: true; markdown: string } | { ok: false; reason: string }

const STATUS_GLYPH: Record<StatusCell, string> = {
  pass: "✓",
  warning: "⚠",
  fail: "✗",
  pending: "○",
  active: "◉",
}

export function spinosaFigure(input: FigureInput): MarkdownFigureResult {
  const meta = checkMeta(input)
  if (!meta.ok) return meta
  switch (input.kind) {
    case "bar":
      return finish(meta.value, renderBar(input.items))
    case "sparkline":
      return finish(meta.value, renderSparkline(input.values, input.label))
    case "stacked_bar":
      return finish(meta.value, renderStacked(input.segments))
    case "status_matrix":
      return finish(meta.value, renderStatus(input.columns, input.rows))
  }
}

export function looksLikeMarkdownFigure(text: string): boolean {
  const fence = text.match(FENCE_RE)
  if (!fence?.[1] || !GLYPH_RE.test(fence[1])) return false
  const after = text.slice((fence.index ?? 0) + fence[0].length)
  const lines = after.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const caption = lines.find((line) => !SOURCE_RE.test(line) && !UNITS_RE.test(line))
  if (!caption) return false
  return SOURCE_RE.test(after) && UNITS_RE.test(after)
}

function finish(meta: FigureMeta, body: MarkdownFigureResult): MarkdownFigureResult {
  if (!body.ok) return body
  return { ok: true, markdown: wrapFigure(meta, body.markdown) }
}

function checkMeta(input: FigureMeta): { ok: true; value: FigureMeta } | { ok: false; reason: string } {
  const title = input.title.trim()
  const caption = input.caption.trim()
  const source = input.source.trim()
  const units = input.units.trim()
  if (!title) return { ok: false, reason: "title is required" }
  if (!caption) return { ok: false, reason: "caption is required" }
  if (!source) return { ok: false, reason: "source is required" }
  if (!units) return { ok: false, reason: "units are required" }
  return { ok: true, value: { title, caption, source, units } }
}

function renderBar(items: readonly BarItem[]): MarkdownFigureResult {
  if (items.length === 0) {
    return { ok: true, markdown: frameRow(`${fit("—", LABEL_WIDTH)} ${BAR_EMPTY.repeat(BAR_WIDTH)} ${fit("?", VALUE_WIDTH, "right")}`) }
  }
  const values: number[] = []
  for (const item of items) {
    const label = item.label.trim()
    if (!label) return { ok: false, reason: "bar labels are required" }
    if (!Number.isFinite(item.value)) return { ok: false, reason: "bar values must be finite numbers" }
    if (item.value < 0) return { ok: false, reason: "bar values must be >= 0" }
    values.push(item.value)
  }
  const max = Math.max(...values)
  const rows = items.map((item, i) => {
    const filled = max === 0 ? 0 : Math.round((values[i]! / max) * BAR_WIDTH)
    const bar = BAR_FILLED.repeat(clamp(filled, 0, BAR_WIDTH)) + BAR_EMPTY.repeat(BAR_WIDTH - clamp(filled, 0, BAR_WIDTH))
    const mark = max === 0 && values[i] === 0 ? "?" : formatNumber(values[i]!)
    return frameRow(`${fit(item.label.trim(), LABEL_WIDTH)} ${bar} ${fit(mark, VALUE_WIDTH, "right")}`)
  })
  return { ok: true, markdown: rows.join("\n") }
}

function renderSparkline(values: readonly number[], label: string | undefined): MarkdownFigureResult {
  if (values.length === 0) {
    return { ok: true, markdown: frameRow(`${fit(label?.trim() || "—", LABEL_WIDTH)} ${"?".repeat(Math.min(8, SPARKLINE_WIDTH))} ${fit("?", VALUE_WIDTH, "right")}`) }
  }
  for (const value of values) {
    if (!Number.isFinite(value)) return { ok: false, reason: "sparkline values must be finite numbers" }
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const chars = [...SPARKLINE_CHARS]
  const spark = values
    .map((value) => {
      if (max === min) return chars[3]!
      return chars[Math.round(((value - min) / (max - min)) * (chars.length - 1))]!
    })
    .join("")
  const trimmed = spark.length > SPARKLINE_WIDTH ? spark.slice(0, SPARKLINE_WIDTH) : spark
  const ends = `${formatNumber(values[0]!)} → ${formatNumber(values[values.length - 1]!)}`
  return {
    ok: true,
    markdown: frameRow(`${fit(label?.trim() || "trend", LABEL_WIDTH)} ${fit(trimmed, SPARKLINE_WIDTH)} ${fit(ends, INNER_WIDTH - LABEL_WIDTH - SPARKLINE_WIDTH - 2, "right")}`),
  }
}

function renderStacked(segments: readonly StackedSegment[]): MarkdownFigureResult {
  if (segments.length === 0) {
    return { ok: true, markdown: frameRow(`${fit("—", LABEL_WIDTH)} ${BAR_EMPTY.repeat(STACKED_BAR_WIDTH)}`) }
  }
  if (segments.length > STACKED_CHARS.length) {
    return { ok: false, reason: `stacked_bar supports at most ${STACKED_CHARS.length} segments` }
  }
  const values: number[] = []
  for (const segment of segments) {
    if (!segment.label.trim()) return { ok: false, reason: "stacked_bar labels are required" }
    if (!Number.isFinite(segment.value)) return { ok: false, reason: "stacked_bar values must be finite numbers" }
    if (segment.value < 0) return { ok: false, reason: "stacked_bar values must be >= 0" }
    values.push(segment.value)
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total === 0) {
    return { ok: true, markdown: [frameRow(`${fit("total", LABEL_WIDTH)} ${BAR_EMPTY.repeat(STACKED_BAR_WIDTH)}`), frameRow(fit("?", INNER_WIDTH))].join("\n") }
  }
  const lengths = allocate(values, STACKED_BAR_WIDTH)
  let bar = ""
  for (let i = 0; i < segments.length; i++) {
    bar += STACKED_CHARS[i]!.repeat(lengths[i]!)
  }
  const legend = segments
    .map((segment, i) => `${segment.label.trim()}:${Math.round((values[i]! / total) * 100)}%`)
    .join("  ")
  return {
    ok: true,
    markdown: [frameRow(`${fit("total", LABEL_WIDTH)} ${bar}`), frameRow(fit(legend, INNER_WIDTH))].join("\n"),
  }
}

function renderStatus(columns: readonly string[], rows: readonly StatusRow[]): MarkdownFigureResult {
  if (columns.length === 0) return { ok: false, reason: "status_matrix columns are required" }
  for (const column of columns) {
    if (!column.trim()) return { ok: false, reason: "status_matrix column labels are required" }
  }
  const colWidth = Math.max(6, Math.floor((INNER_WIDTH - LABEL_WIDTH - 1) / columns.length))
  const header = `${fit("", LABEL_WIDTH)} ${columns.map((column) => fit(column.trim(), colWidth)).join("")}`
  const body = rows.map((row) => {
    if (!row.label.trim()) return { ok: false as const, reason: "status_matrix row labels are required" }
    if (row.cells.length !== columns.length) {
      return { ok: false as const, reason: "status_matrix cells must match column count" }
    }
    for (const cell of row.cells) {
      if (!(cell in STATUS_GLYPH)) return { ok: false as const, reason: `unknown status cell: ${cell}` }
    }
    const cells = row.cells.map((cell) => fit(STATUS_GLYPH[cell], colWidth)).join("")
    return { ok: true as const, line: frameRow(`${fit(row.label.trim(), LABEL_WIDTH)} ${cells}`) }
  })
  for (const row of body) {
    if (!row.ok) return row
  }
  if (body.length === 0) {
    return { ok: true, markdown: [frameRow(fit(header, INNER_WIDTH)), frameRow(fit("?", INNER_WIDTH))].join("\n") }
  }
  return {
    ok: true,
    markdown: [frameRow(fit(header, INNER_WIDTH)), ...body.map((row) => (row.ok ? row.line : ""))].join("\n"),
  }
}

function wrapFigure(meta: FigureMeta, inner: string): string {
  return [
    "```text",
    topBorder(meta.title),
    inner,
    bottomBorder(),
    "```",
    "",
    meta.caption,
    "",
    `Source: ${meta.source}. Units: ${meta.units}.`,
    "",
  ].join("\n")
}

function topBorder(title: string): string {
  const head = `┌─ ${title} `
  if (visibleLength(head) >= FIGURE_WIDTH - 1) {
    const clipped = `┌─ ${fit(title, FIGURE_WIDTH - 5)} `
    return clipped + "┐"
  }
  return head + "─".repeat(FIGURE_WIDTH - 1 - visibleLength(head)) + "┐"
}

function bottomBorder(): string {
  return `└${"─".repeat(INNER_WIDTH)}┘`
}

function frameRow(content: string): string {
  return `│${padVisible(content, INNER_WIDTH)}│`
}

function allocate(values: readonly number[], width: number): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  const raw = values.map((value) => (value / total) * width)
  const lengths = raw.map((value) => Math.floor(value))
  let leftover = width - lengths.reduce((sum, value) => sum + value, 0)
  const order = raw
    .map((value, i) => ({ i, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac)
  for (const item of order) {
    if (leftover <= 0) break
    lengths[item.i]! += 1
    leftover -= 1
  }
  return lengths
}

function formatNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 10_000) return String(value)
  if (Math.abs(value) >= 1_000_000) return `${trimFloat(value / 1_000_000)}M`
  if (Math.abs(value) >= 1_000) return `${trimFloat(value / 1_000)}k`
  return trimFloat(value)
}

function trimFloat(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "")
}

function fit(input: string, width: number, align: "left" | "right" = "left"): string {
  return padVisible(input.replace(/\s+/g, " ").trim(), width, align)
}

function padVisible(input: string, width: number, align: "left" | "right" = "left"): string {
  const chars = [...input]
  if (chars.length > width) return chars.slice(0, width).join("")
  const pad = " ".repeat(width - chars.length)
  return align === "right" ? pad + chars.join("") : chars.join("") + pad
}

function visibleLength(input: string): number {
  return [...input].length
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
