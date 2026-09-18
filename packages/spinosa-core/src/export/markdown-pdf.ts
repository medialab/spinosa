// Markdown → PDF export via the already-bundled @napi-rs/canvas PDF backend.
// No new dependencies: text renders through Skia system-font fallback at
// export time (glyph coverage depends on runtime fonts; structure is exact).

import { parseYamlFrontmatter } from "../artifacts/parser"

export type MarkdownPdfOptions = {
  /** Cover title override. Defaults to frontmatter title/topic, else none. */
  title?: string
}

type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean }

type Block =
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "list"; ordered: boolean; items: Span[][] }
  | { kind: "quote"; spans: Span[] }
  | { kind: "code"; lines: string[] }
  | { kind: "table"; headers: Span[][]; rows: Span[][][] }
  | { kind: "rule" }

const PAGE_W = 595
const PAGE_H = 842
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2

const INK = "#1a1a1a"
const MUTED = "#555555"
const RULE = "#999999"
const CODE_BG = "#f2f2f2"
const HEAD_FILL = "#e6e6e6"

/** Compact type so agent reports do not shout titles in export. */
export const PDF_COVER_SIZE = 16
export const PDF_BODY_SIZE = 10
export const PDF_CODE_SIZE = 9

export function pdfHeadingSize(level: number): number {
  if (level <= 1) return 13
  if (level === 2) return 12
  return 11
}

function spansText(spans: Span[]): string {
  return spans.map((s) => s.text).join("")
}

const SANS = "sans-serif"
const MONO = "monospace"

function fontFor(size: number, style: { bold?: boolean; italic?: boolean; code?: boolean }): string {
  if (style.code) return `${size}px ${MONO}`
  const weight = style.bold ? "bold " : ""
  const slant = style.italic ? "italic " : ""
  return `${weight}${slant}${size}px ${SANS}`
}

// --- inline parsing ---

function parseInline(text: string): Span[] {
  // Images become placeholders; links keep text plus absolute URLs.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "[image: $1]")
  const spans: Span[] = []
  const token = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  for (const m of text.matchAll(token)) {
    const idx = m.index ?? 0
    if (idx > last) spans.push({ text: text.slice(last, idx) })
    const tok = m[0]!
    if (tok.startsWith("`")) spans.push({ text: tok.slice(1, -1), code: true })
    else if (tok.startsWith("**")) spans.push({ text: tok.slice(2, -2), bold: true })
    else if (tok.startsWith("*")) spans.push({ text: tok.slice(1, -1), italic: true })
    else {
      const link = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link) {
        spans.push({ text: link[1]! })
        if (/^(https?:|mailto:)/i.test(link[2]!)) spans.push({ text: ` <${link[2]}>` })
      } else spans.push({ text: tok })
    }
    last = idx + tok.length
  }
  if (last < text.length) spans.push({ text: text.slice(last) })
  return spans.filter((s) => s.text.length > 0)
}

// --- block parsing ---

function isTableSeparator(line: string): boolean {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|")
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()))
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
}

function stripFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const fields = parseYamlFrontmatter(text)
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
  return { fields, body: body === text ? text : body }
}

function parseBlocks(body: string): Block[] {
  const blocks: Block[] = []
  const lines = body.split(/\r?\n/)
  let i = 0
  let para: string[] = []
  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "paragraph", spans: parseInline(para.join(" ")) })
      para = []
    }
  }
  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      flushPara()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        code.push(lines[i]!)
        i++
      }
      i++ // consume closing fence (or EOF)
      blocks.push({ kind: "code", lines: code })
      continue
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushPara()
      blocks.push({ kind: "heading", level: heading[1]!.length, spans: parseInline(heading[2]!) })
      i++
      continue
    }
    if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) {
      flushPara()
      blocks.push({ kind: "rule" })
      i++
      continue
    }
    if (trimmed.startsWith(">")) {
      flushPara()
      const quote: string[] = []
      while (i < lines.length && lines[i]!.trim().startsWith(">")) {
        quote.push(lines[i]!.trim().replace(/^>\s?/, ""))
        i++
      }
      blocks.push({ kind: "quote", spans: parseInline(quote.join(" ")) })
      continue
    }
    const listItem = trimmed.match(/^([-*+]\s+|\d+[.)]\s+)(.*)$/)
    if (listItem) {
      flushPara()
      const ordered = /^\d/.test(trimmed)
      const items: Span[][] = []
      while (i < lines.length) {
        const m = lines[i]!.trim().match(/^([-*+]\s+|\d+[.)]\s+)(.*)$/)
        if (!m) break
        items.push(parseInline(m[2]!))
        i++
      }
      blocks.push({ kind: "list", ordered, items })
      continue
    }
    if (trimmed.startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      flushPara()
      const headers = splitRow(trimmed).map((c) => parseInline(c))
      i += 2
      const rows: Span[][][] = []
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        rows.push(splitRow(lines[i]!.trim()).map((c) => parseInline(c)))
        i++
      }
      // Normalize ragged rows to the header width.
      const width = headers.length
      for (const row of rows) {
        while (row.length < width) row.push([{ text: "" }])
        row.length = width
      }
      blocks.push({ kind: "table", headers, rows })
      continue
    }
    if (trimmed === "") {
      flushPara()
      i++
      continue
    }
    para.push(trimmed)
    i++
  }
  flushPara()
  return blocks
}

// --- layout + drawing ---

type Word = { text: string; font: string; fill: string }
type Measurer = { measureText(text: string): { width: number } }

function spansToWords(spans: Span[], size: number, fill: string, measurer: Measurer & { font: string }): Word[] {
  const words: Word[] = []
  for (const span of spans) {
    const font = fontFor(span.code ? PDF_CODE_SIZE : size, span)
    for (const part of span.text.split(/(\s+)/)) {
      if (part.length === 0) continue
      words.push({ text: part, font, fill: span.code ? INK : fill })
    }
  }
  return words
}

function wrapWords(words: Word[], maxWidth: number, measurer: Measurer & { font: string }): Word[][] {
  const lines: Word[][] = []
  let line: Word[] = []
  let width = 0
  const spaceWidth = (font: string) => {
    measurer.font = font
    return measurer.measureText(" ").width
  }
  for (const word of words) {
    measurer.font = word.font
    const w = measurer.measureText(word.text === "" ? "" : word.text).width
    const gap = line.length === 0 || /^\s+$/.test(word.text) ? 0 : spaceWidth(line[line.length - 1]!.font)
    if (line.length > 0 && width + gap + w > maxWidth && !/^\s+$/.test(word.text)) {
      lines.push(line)
      line = []
      width = 0
    }
    if (/^\s+$/.test(word.text)) {
      if (line.length > 0) {
        line.push(word)
        width += spaceWidth(word.font)
      }
      continue
    }
    line.push(word)
    width += (line.length > 1 ? gap : 0) + w
  }
  if (line.length > 0) lines.push(line)
  return lines
}

function cellLines(cell: Span[], colWidth: number, measurer: Measurer & { font: string }): Word[][] {
  return wrapWords(spansToWords(cell, PDF_BODY_SIZE, INK, measurer), Math.max(20, colWidth - 8), measurer)
}

export async function exportMarkdownToPdf(markdown: string, opts?: MarkdownPdfOptions): Promise<Buffer> {
  const { ensureDocumentConverters } = await import("../tools/detection")
  await ensureDocumentConverters()
  const { PDFDocument, createCanvas } = await import("@napi-rs/canvas")
  const { fields, body } = stripFrontmatter(markdown)
  const title = opts?.title ?? fields.title ?? fields.topic
  const blocks = parseBlocks(body)

  const doc = new PDFDocument({ creator: "spinosa" })
  const measurer = createCanvas(8, 8).getContext("2d")
  let ctx = doc.beginPage(PAGE_W, PAGE_H)
  let y = MARGIN

  const newPage = () => {
    doc.endPage()
    ctx = doc.beginPage(PAGE_W, PAGE_H)
    y = MARGIN
  }
  const ensure = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) newPage()
  }

  const drawLine = (line: Word[], x: number, lineY: number) => {
    let cx = x
    for (const word of line) {
      ctx.font = word.font
      ctx.fillStyle = word.fill
      if (!/^\s+$/.test(word.text)) {
        ctx.fillText(word.text, cx, lineY)
        cx += ctx.measureText(word.text).width + ctx.measureText(" ").width
      } else {
        cx += ctx.measureText(" ").width
      }
    }
  }

  const drawSpansBlock = (spans: Span[], size: number, fill: string, indent: number, lineHeight: number, gapAfter: number) => {
    const lines = wrapWords(spansToWords(spans, size, fill, measurer), CONTENT_W - indent, measurer)
    for (const line of lines) {
      ensure(lineHeight)
      drawLine(line, MARGIN + indent, y + lineHeight * 0.8)
      y += lineHeight
    }
    y += gapAfter
  }

  let coverTitle = title?.trim() || undefined
  if (coverTitle) {
    ctx.font = fontFor(PDF_COVER_SIZE, { bold: true })
    ctx.fillStyle = INK
    const titleLines = wrapWords(
      [{ text: coverTitle, font: ctx.font, fill: INK }].flatMap((w) =>
        w.text.split(/(\s+)/).filter((p) => p.length > 0).map((p) => ({ text: p, font: w.font, fill: w.fill })),
      ),
      CONTENT_W,
      measurer,
    )
    for (const line of titleLines) {
      ensure(22)
      drawLine(line, MARGIN, y + PDF_COVER_SIZE)
      y += 22
    }
    ctx.fillStyle = RULE
    ctx.fillRect(MARGIN, y + 2, CONTENT_W, 1)
    y += 12
  }

  let sawH1 = Boolean(coverTitle)

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const heading = spansText(block.spans).trim()
        if (coverTitle && heading.toLowerCase() === coverTitle.toLowerCase()) {
          coverTitle = undefined
          break
        }
        const level = block.level <= 1 && sawH1 ? 2 : block.level
        if (level <= 1) sawH1 = true
        const size = pdfHeadingSize(level)
        const lh = size + 6
        y += level === 1 ? 8 : 6
        drawSpansBlock(block.spans, size, INK, 0, lh, 4)
        break
      }
      case "paragraph":
        drawSpansBlock(block.spans, PDF_BODY_SIZE, INK, 0, 14, 6)
        break
      case "quote": {
        const lines = wrapWords(spansToWords(block.spans, PDF_BODY_SIZE, MUTED, measurer), CONTENT_W - 16, measurer)
        const h = lines.length * 15
        ensure(h + 6)
        const top = y
        for (const line of lines) {
          drawLine(line, MARGIN + 12, y + 12)
          y += 15
        }
        ctx.fillStyle = RULE
        ctx.fillRect(MARGIN, top, 2, h)
        y += 8
        break
      }
      case "code": {
        ctx.font = fontFor(PDF_CODE_SIZE, { code: true })
        const wrapped: string[] = []
        for (const raw of block.lines) {
          let rest = raw === "" ? " " : raw
          while (rest.length > 0) {
            let n = rest.length
            while (n > 0 && ctx.measureText(rest.slice(0, n)).width > CONTENT_W - 16) n--
            if (n === 0) n = 1
            wrapped.push(rest.slice(0, n))
            rest = rest.slice(n)
          }
        }
        const h = wrapped.length * 14 + 12
        ensure(Math.min(h, PAGE_H - MARGIN * 2))
        let remaining = [...wrapped]
        while (remaining.length > 0) {
          const room = Math.max(1, Math.floor((PAGE_H - MARGIN - y - 6) / 14))
          const chunk = remaining.slice(0, room)
          remaining = remaining.slice(room)
          const ch = chunk.length * 14 + 12
          ctx.fillStyle = CODE_BG
          ctx.fillRect(MARGIN, y, CONTENT_W, ch)
          ctx.fillStyle = INK
          ctx.font = fontFor(PDF_CODE_SIZE, { code: true })
          let cy = y + 6 + 11
          for (const text of chunk) {
            ctx.fillText(text, MARGIN + 8, cy)
            cy += 14
          }
          y += ch + 8
          if (remaining.length > 0) newPage()
        }
        break
      }
      case "list": {
        block.items.forEach((item, idx) => {
          const marker = block.ordered ? `${idx + 1}.` : "•"
          const words = spansToWords(item, PDF_BODY_SIZE, INK, measurer)
          measurer.font = fontFor(PDF_BODY_SIZE, {})
          const markerW = measurer.measureText(`${marker} `).width
          const lines = wrapWords(words, CONTENT_W - 20 - markerW, measurer)
          lines.forEach((line, li) => {
            ensure(15)
            if (li === 0) {
              ctx.font = fontFor(PDF_BODY_SIZE, {})
              ctx.fillStyle = INK
              ctx.fillText(marker, MARGIN + 16, y + 12)
            }
            drawLine(line, MARGIN + 16 + markerW, y + 12)
            y += 15
          })
          y += 3
        })
        y += 4
        break
      }
      case "table": {
        // Natural column widths from unwrapped content, scaled to fit.
        measurer.font = fontFor(PDF_BODY_SIZE, {})
        const colCount = block.headers.length
        const natural: number[] = new Array(colCount).fill(0)
        const allRows = [block.headers, ...block.rows]
        for (const row of allRows) {
          row.forEach((cell, ci) => {
            const flat = cell.map((s) => s.text).join(" ")
            measurer.font = fontFor(PDF_BODY_SIZE, { bold: row === block.headers })
            natural[ci] = Math.max(natural[ci]!, measurer.measureText(flat).width + 10)
          })
        }
        const total = natural.reduce((a, b) => a + b, 0) || 1
        const scale = total > CONTENT_W ? CONTENT_W / total : 1
        const colW = natural.map((w) => Math.max(36, w * scale))
        const adjust = CONTENT_W / colW.reduce((a, b) => a + b, 0)
        const widths = colW.map((w) => w * Math.min(1, adjust) || w)

        const drawHeader = () => {
          const lh = 14
          const linesPerCell = block.headers.map((c) => cellLines(c, widths[block.headers.indexOf(c)]!, measurer))
          const h = Math.max(...linesPerCell.map((l) => l.length)) * lh + 8
          ensure(h)
          drawRow(block.headers, linesPerCell, h, true)
        }
        const drawRow = (row: Span[][], cellWrapped: Word[][][], h: number, header: boolean) => {
          let cx = MARGIN
          ctx.fillStyle = header ? HEAD_FILL : "#ffffff"
          ctx.fillRect(MARGIN, y, CONTENT_W, h)
          row.forEach((cell, ci) => {
            const w = widths[ci]!
            const lines = cellWrapped[ci]!
            let cy = y + 4 + 11
            for (const line of lines) {
              let lx = cx + 5
              for (const word of line) {
                ctx.font = header ? fontFor(PDF_BODY_SIZE, { bold: true }) : word.font
                ctx.fillStyle = INK
                if (!/^\s+$/.test(word.text)) {
                  ctx.fillText(word.text, lx, cy)
                  lx += ctx.measureText(word.text).width + ctx.measureText(" ").width
                } else {
                  lx += ctx.measureText(" ").width
                }
              }
              cy += 14
            }
            cx += w
          })
          ctx.strokeStyle = RULE
          ctx.lineWidth = 0.5
          let sx = MARGIN
          ctx.strokeRect(MARGIN, y, CONTENT_W, h)
          for (const w of widths.slice(0, -1)) {
            sx += w
            ctx.beginPath()
            ctx.moveTo(sx, y)
            ctx.lineTo(sx, y + h)
            ctx.stroke()
          }
          y += h
        }
        drawHeader()
        for (const row of block.rows) {
          const wrapped = row.map((c, ci) => cellLines(c, widths[ci]!, measurer))
          const h = Math.max(...wrapped.map((l) => l.length)) * 14 + 8
          if (y + h > PAGE_H - MARGIN) {
            newPage()
            drawHeader()
          }
          drawRow(row, wrapped, h, false)
        }
        y += 10
        break
      }
      case "rule":
        ensure(14)
        ctx.fillStyle = RULE
        ctx.fillRect(MARGIN, y + 6, CONTENT_W, 1)
        y += 14
        break
    }
  }

  if (y === MARGIN) {
    // Empty input still yields a valid single page.
    ctx.font = fontFor(PDF_BODY_SIZE, {})
    ctx.fillStyle = MUTED
    ctx.fillText("(empty document)", MARGIN, y + 12)
  }
  doc.endPage()
  return doc.close()
}
