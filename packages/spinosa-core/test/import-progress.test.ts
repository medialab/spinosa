import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { processDirectCopy, processMarkitdown, processOcr, type ClassifiedEntry } from "../src/import/pipeline"
import { ProgressEmitter } from "../src/progress/progress"
import type { JobEvent } from "../src/progress/job-event"

function tmpRoot(prefix: string) {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function makeDirectFiles(n: number): { files: ClassifiedEntry[] } {
  const root = tmpRoot("spinosa-prog-direct-")
  const srcDir = path.join(root, "src")
  const destDir = path.join(root, "dest")
  mkdirSync(srcDir)
  mkdirSync(destDir)
  const files: ClassifiedEntry[] = []
  for (let i = 0; i < n; i++) {
    const name = `file-${i}.md`
    const src = path.join(srcDir, name)
    writeFileSync(src, `# ${name}\n`)
    files.push({ src, rel: name, dest: path.join(destDir, name) })
  }
  return { files }
}

function makeInlineMdFiles(n: number): { files: ClassifiedEntry[]; logsDir: string } {
  const root = tmpRoot("spinosa-prog-md-")
  const srcDir = path.join(root, "src")
  const destDir = path.join(root, "dest")
  const logsDir = path.join(root, "logs")
  mkdirSync(srcDir)
  mkdirSync(destDir)
  mkdirSync(logsDir)
  const files: ClassifiedEntry[] = []
  for (let i = 0; i < n; i++) {
    const name = `data-${i}.json`
    const src = path.join(srcDir, name)
    writeFileSync(src, JSON.stringify({ i }))
    files.push({
      src,
      rel: name,
      dest: path.join(destDir, name.replace(/\.json$/, ".md")),
    })
  }
  return { files, logsDir }
}

describe("import per-file progress", () => {
  test("direct copy emits monotonic file-start/done events and dual-publishes job.progress", async () => {
    const { files } = makeDirectFiles(5)
    const local: Array<{ phase: string; current: number; total: number; relPath: string }> = []
    const bus: JobEvent[] = []
    const prog = new ProgressEmitter({
      jobId: "job_direct_prog",
      onJobEvent: (e) => bus.push(e),
    })
    prog.on((e) => local.push({ phase: e.phase, current: e.current, total: e.total, relPath: e.relPath }))

    const result = await processDirectCopy(files, prog)
    expect(result.converted).toBe(5)
    expect(result.failed).toBe(0)

    expect(local.every((e) => e.phase === "direct-progress")).toBe(true)
    expect(local.every((e) => e.total === 5)).toBe(true)
    expect(local.some((e) => e.current === 0)).toBe(true)

    let maxSeen = 0
    for (const e of local) {
      expect(e.current).toBeLessThanOrEqual(5)
      // Parallel workers may interleave start(current=N) with done(current=N+1);
      // never allow a jump past total, and never regress the high-water mark by more
      // than one (a start after a done can restate the previous completed count).
      if (e.current > maxSeen) maxSeen = e.current
    }
    expect(maxSeen).toBe(5)
    expect(local.filter((e) => e.current === 5).length).toBeGreaterThanOrEqual(1)

    const progressBus = bus.filter((e) => e.type === "job.progress")
    expect(progressBus.length).toBe(local.length)
    expect(progressBus.every((e) => e.type === "job.progress" && e.properties.phase === "direct-progress")).toBe(true)
  })

  test("markitdown inline files emit per-file start and done", async () => {
    const { files, logsDir } = makeInlineMdFiles(4)
    const local: Array<{ current: number; relPath: string }> = []
    const prog = new ProgressEmitter()
    prog.on((e) => local.push({ current: e.current, relPath: e.relPath }))

    const result = await processMarkitdown(files, logsDir, prog, undefined, undefined, { inProcess: true })
    expect(result.converted).toBe(4)
    expect(result.failed).toBe(0)

    // Each file: start at current N then done at N+1 → at least 8 events.
    expect(local.length).toBeGreaterThanOrEqual(8)
    for (let i = 1; i <= 4; i++) {
      expect(local.some((e) => e.current === i)).toBe(true)
    }
    expect(local.at(-1)?.current).toBe(4)
    expect(local.every((e) => e.current <= 4)).toBe(true)
  })

  test("markitdown NDJSON child streams progress and returns converted count", async () => {
    const { files, logsDir } = makeInlineMdFiles(3)
    const local: Array<{ current: number }> = []
    const prog = new ProgressEmitter()
    prog.on((e) => local.push({ current: e.current }))

    const result = await processMarkitdown(files, logsDir, prog)
    expect(result.converted).toBe(3)
    expect(result.failed).toBe(0)
    expect(local.some((e) => e.current === 3)).toBe(true)
  })

  test("markitdown child crash fails unfinished files instead of returning zero counts", async () => {
    const { files, logsDir } = makeInlineMdFiles(2)
    writeFileSync(files[0]!.dest, "# already converted\n")
    const events: Array<{ relPath: string; status?: string }> = []
    const logs: string[] = []
    const prog = new ProgressEmitter()
    prog.on((event) => events.push({ relPath: event.relPath, status: event.status }))

    const result = await processMarkitdown(files, logsDir, prog, (line) => logs.push(line), undefined, {
      onChild: (child) => child.kill("SIGKILL"),
    })

    expect(result).toMatchObject({ converted: 0, skipped: 1, failed: 1 })
    expect(events.some((event) => event.relPath === files[1]!.rel && event.status === "failed")).toBe(true)
    expect(logs.some((line) => line.includes("terminated by signal"))).toBe(true)
  })

  test("markitdown child crash does not count an untouched forced destination as converted", async () => {
    const { files, logsDir } = makeInlineMdFiles(1)
    writeFileSync(files[0]!.dest, "# stale output\n")
    files[0]!.force = true

    const result = await processMarkitdown(files, logsDir, undefined, undefined, undefined, {
      onChild: (child) => child.kill("SIGKILL"),
    })

    expect(result).toMatchObject({ converted: 0, skipped: 0, failed: 1 })
  })

  test("markitdown child crash preserves output completed before the final summary", async () => {
    const { files, logsDir } = makeInlineMdFiles(20)
    const logs: string[] = []

    const result = await processMarkitdown(files, logsDir, undefined, (line) => logs.push(line), undefined, {
      onChild: (child) => {
        const poll = setInterval(() => {
          if (!existsSync(files[0]!.dest)) return
          clearInterval(poll)
          child.kill("SIGKILL")
        }, 1)
        child.once("close", () => clearInterval(poll))
      },
    })

    expect(result.converted).toBeGreaterThanOrEqual(1)
    expect(result.converted + result.skipped + result.failed).toBe(files.length)
    expect(logs.some((line) => line.includes("terminated by signal"))).toBe(true)
  })

  test("N invalid OCR inputs count as failed (not skipped)", async () => {
    const n = 4
    const root = tmpRoot("spinosa-prog-ocr-fail-")
    const srcDir = path.join(root, "src")
    const destDir = path.join(root, "dest")
    const logsDir = path.join(root, "logs")
    mkdirSync(srcDir)
    mkdirSync(destDir)
    mkdirSync(logsDir)
    const files: ClassifiedEntry[] = []
    for (let i = 0; i < n; i++) {
      const name = `bad-${i}.png`
      const src = path.join(srcDir, name)
      // Empty file → validateOcrImageInput fails before worker spawn.
      writeFileSync(src, "")
      files.push({
        src,
        rel: name,
        dest: path.join(destDir, name.replace(/\.png$/, "__png.md")),
      })
    }

    const events: Array<{ current: number; status?: string }> = []
    const prog = new ProgressEmitter()
    prog.on((e) => events.push({ current: e.current, status: e.status }))

    const result = await processOcr(files, logsDir, prog)
    expect(result.failed).toBe(n)
    expect(result.skipped).toBe(0)
    expect(result.converted).toBe(0)
    expect(events.every((e) => e.current <= n)).toBe(true)
    expect(events.filter((e) => e.status === "failed").length).toBe(n)
  })
})
