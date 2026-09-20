import { describe, expect, test } from "bun:test"
import {
  BAR_EMPTY,
  BAR_FILLED,
  FIGURE_WIDTH,
  looksLikeMarkdownFigure,
  SPARKLINE_CHARS,
  spinosaFigure,
} from "../src/application/markdown-figure"

const meta = {
  title: "Coverage by group",
  caption: "North has the largest share of mapped files.",
  source: "maps/corpus_overview.md",
  units: "file count",
}

describe("spinosaFigure", () => {
  test("renders a 52-character bar with a zero baseline", () => {
    const result = spinosaFigure({
      ...meta,
      kind: "bar",
      items: [
        { label: "North", value: 10 },
        { label: "South", value: 5 },
        { label: "East", value: 0 },
      ],
    })
    if (!result.ok) throw new Error(result.reason)
    const lines = result.markdown.split("\n")
    const framed = lines.filter((line) => line.startsWith("┌") || line.startsWith("│") || line.startsWith("└"))
    expect(framed.every((line) => [...line].length === FIGURE_WIDTH)).toBe(true)
    const north = lines.find((line) => line.includes("North"))!
    const south = lines.find((line) => line.includes("South"))!
    const east = lines.find((line) => line.includes("East"))!
    const northFill = (north.match(new RegExp(BAR_FILLED, "g")) ?? []).length
    const southFill = (south.match(new RegExp(BAR_FILLED, "g")) ?? []).length
    expect(northFill).toBe(southFill * 2)
    expect(east).toContain(BAR_EMPTY)
    expect(east).not.toContain(BAR_FILLED)
    expect(result.markdown).toContain("North has the largest share of mapped files.")
    expect(result.markdown).toContain("Source: maps/corpus_overview.md. Units: file count.")
  })

  test("empty bar data shows a question mark", () => {
    const result = spinosaFigure({ ...meta, kind: "bar", items: [] })
    if (!result.ok) throw new Error(result.reason)
    expect(result.markdown).toContain("?")
    expect(result.markdown).toContain(BAR_EMPTY)
  })

  test("rejects non-finite bar values and missing labels", () => {
    expect(spinosaFigure({ ...meta, kind: "bar", items: [{ label: "A", value: Number.NaN }] }).ok).toBe(false)
    expect(spinosaFigure({ ...meta, kind: "bar", items: [{ label: "A", value: Infinity }] }).ok).toBe(false)
    expect(spinosaFigure({ ...meta, kind: "bar", items: [{ label: "  ", value: 1 }] }).ok).toBe(false)
    expect(spinosaFigure({ ...meta, title: "  ", kind: "bar", items: [{ label: "A", value: 1 }] }).ok).toBe(false)
    expect(spinosaFigure({ ...meta, caption: "", kind: "bar", items: [{ label: "A", value: 1 }] }).ok).toBe(false)
  })

  test("sparkline maps min to the lowest glyph and max to the highest", () => {
    const result = spinosaFigure({
      ...meta,
      kind: "sparkline",
      label: "users",
      values: [1, 2, 4, 8],
    })
    if (!result.ok) throw new Error(result.reason)
    const chars = [...SPARKLINE_CHARS]
    expect(result.markdown).toContain(chars[0]!)
    expect(result.markdown).toContain(chars[chars.length - 1]!)
    expect(result.markdown).toContain("1 → 8")
  })

  test("stacked bar segments sum to the bar width", () => {
    const result = spinosaFigure({
      ...meta,
      kind: "stacked_bar",
      segments: [
        { label: "maps", value: 50 },
        { label: "raw", value: 50 },
      ],
    })
    if (!result.ok) throw new Error(result.reason)
    const barLine = result.markdown.split("\n").find((line) => line.includes("total"))!
    const inner = [...barLine].slice(1, -1).join("").trimStart().slice("total".length).trim()
    const filled = (inner.match(/[█▓▒░]/g) ?? []).length
    expect(filled).toBeGreaterThan(0)
    expect(result.markdown).toContain("maps:50%")
    expect(result.markdown).toContain("raw:50%")
  })

  test("status matrix keeps cell glyphs aligned to columns", () => {
    const result = spinosaFigure({
      ...meta,
      kind: "status_matrix",
      columns: ["Maps", "Dict"],
      rows: [
        { label: "North", cells: ["pass", "warning"] },
        { label: "West", cells: ["fail", "pending"] },
      ],
    })
    if (!result.ok) throw new Error(result.reason)
    expect(result.markdown).toContain("✓")
    expect(result.markdown).toContain("⚠")
    expect(result.markdown).toContain("✗")
    expect(result.markdown).toContain("○")
    expect(spinosaFigure({ ...meta, kind: "status_matrix", columns: ["Maps"], rows: [{ label: "North", cells: ["pass", "fail"] }] }).ok).toBe(false)
  })

  test("snapshots each kind", () => {
    const bar = spinosaFigure({ ...meta, kind: "bar", items: [{ label: "A", value: 4 }, { label: "B", value: 2 }] })
    const spark = spinosaFigure({ ...meta, kind: "sparkline", values: [1, 3, 2, 5] })
    const stacked = spinosaFigure({
      ...meta,
      kind: "stacked_bar",
      segments: [{ label: "grants", value: 40 }, { label: "other", value: 10 }],
    })
    const status = spinosaFigure({
      ...meta,
      kind: "status_matrix",
      columns: ["Maps", "Valid"],
      rows: [{ label: "North", cells: ["pass", "active"] }],
    })
    expect(bar).toMatchSnapshot()
    expect(spark).toMatchSnapshot()
    expect(stacked).toMatchSnapshot()
    expect(status).toMatchSnapshot()
  })
})

describe("looksLikeMarkdownFigure", () => {
  test("accepts renderer output", () => {
    const result = spinosaFigure({ ...meta, kind: "bar", items: [{ label: "A", value: 1 }] })
    if (!result.ok) throw new Error(result.reason)
    expect(looksLikeMarkdownFigure(result.markdown)).toBe(true)
    expect(looksLikeMarkdownFigure("# Report\n\n" + result.markdown)).toBe(true)
  })

  test("rejects prose that only mentions a chart", () => {
    expect(looksLikeMarkdownFigure("This chart shows growth.")).toBe(false)
    expect(looksLikeMarkdownFigure("```\nnot a figure\n```\n\nA caption.\n\nSource: x. Units: y.")).toBe(false)
  })
})
