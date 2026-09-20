import { closeSync, existsSync, openSync, readFileSync, readSync, rmSync, statSync } from "node:fs"

import { writeTextAtomic } from "../utils/fs"

const COLD_SCAFFOLD_FIELDS = [
  "type",
  "summary",
  "concepts",
  "language",
  "people",
  "places",
  "organizations",
  "topics",
]

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

export function coldFrontmatterLines(extraFields: string[] = []): string[] {
  return [
    "---",
    ...COLD_SCAFFOLD_FIELDS.map((f) => `${f}:`),
    `created: ${todayUTC()}`,
    ...extraFields,
    "---",
    "",
  ]
}

export function withColdFrontmatterPrefix(body: string, extraFields: string[] = []): string {
  if (body.startsWith("---\n") || body.startsWith("---\r\n")) return body
  return `${coldFrontmatterLines(extraFields).join("\n")}${body}`
}

export function injectColdFrontmatter(mdFile: string): void {
  if (!existsSync(mdFile)) return

  const content = readFileSync(mdFile, "utf-8")
  const lines = content.split("\n")

  if (lines.length > 0 && lines[0].trim() === "---") {
    const merged = mergeMissingFields(lines)
    writeTextAtomic(mdFile, merged)
  } else {
    writeTextAtomic(mdFile, [...coldFrontmatterLines(), content].join("\n"))
  }
}

function mergeMissingFields(lines: string[]): string {
  const today = todayUTC()
  const seen = new Set<string>()
  let inFm = false
  let first = true
  const result: string[] = []

  for (const line of lines) {
    if (line.trim() === "---" && first) {
      result.push(line)
      inFm = true
      first = false
      continue
    }

    if (line.trim() === "---" && inFm) {
      for (const field of COLD_SCAFFOLD_FIELDS) {
        if (!seen.has(field)) result.push(`${field}:`)
      }
      if (!seen.has("created")) result.push(`created: ${today}`)
      result.push(line)
      inFm = false
      continue
    }

    if (inFm) {
      const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):/)
      if (match) seen.add(match[1])
    }

    result.push(line)
  }

  return result.join("\n")
}

/** True when a converted markdown path exists and is not a binary masquerading as `.md`. */
export function convertedOutputExists(outputPath: string): boolean {
  if (!existsSync(outputPath)) return false
  try {
    const stat = statSync(outputPath)
    if (!stat.isFile() || stat.size <= 0) return false
    if (outputPath.endsWith(".md") && looksLikeBinaryDocument(outputPath)) return false
    return true
  } catch {
    return false
  }
}

/** Detect PDF/JPEG/PNG/GIF/WEBP/BMP copied to a `.md` OCR/markitdown destination. */
export function looksLikeBinaryDocument(filePath: string): boolean {
  let fd: number | undefined
  try {
    fd = openSync(filePath, "r")
    const buf = Buffer.alloc(12)
    const n = readSync(fd, buf, 0, 12, 0)
    if (n < 2) return false
    if (n >= 4 && buf.subarray(0, 4).equals(Buffer.from("%PDF"))) return true
    if (n >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
    if (
      n >= 8
      && buf[0] === 0x89
      && buf[1] === 0x50
      && buf[2] === 0x4e
      && buf[3] === 0x47
      && buf[4] === 0x0d
      && buf[5] === 0x0a
      && buf[6] === 0x1a
      && buf[7] === 0x0a
    ) {
      return true
    }
    if (n >= 6) {
      const six = buf.subarray(0, 6).toString("ascii")
      if (six === "GIF87a" || six === "GIF89a") return true
    }
    if (
      n >= 12
      && buf.subarray(0, 4).equals(Buffer.from("RIFF"))
      && buf.subarray(8, 12).equals(Buffer.from("WEBP"))
    ) {
      return true
    }
    if (n >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return true // BM
    return false
  } catch {
    return false
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

export function removeConvertedOutput(outputPath: string): void {
  if (existsSync(outputPath)) rmSync(outputPath, { force: true })
  const pageDir = outputPath.endsWith(".md")
    ? outputPath.slice(0, -3)
    : outputPath + "_pages"
  if (existsSync(pageDir)) rmSync(pageDir, { recursive: true, force: true })
}
