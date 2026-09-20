import { appendFileSync } from "node:fs"

const FLUSH_EVERY = 32
const buffers = new Map<string, string[]>()

/** Buffer NDJSON diagnostic lines and flush in batches. */
export function appendNdjson(file: string, obj: Record<string, unknown>): void {
  let lines = buffers.get(file)
  if (!lines) {
    lines = []
    buffers.set(file, lines)
  }
  lines.push(JSON.stringify(obj) + "\n")
  if (lines.length >= FLUSH_EVERY) flushNdjson(file)
}

export function flushNdjson(file?: string): void {
  if (file) {
    flushOne(file)
    return
  }
  for (const path of [...buffers.keys()]) flushOne(path)
}

function flushOne(file: string): void {
  const lines = buffers.get(file)
  if (!lines?.length) return
  buffers.delete(file)
  try {
    appendFileSync(file, lines.join(""), "utf-8")
  } catch {}
}
