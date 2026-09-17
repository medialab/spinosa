import { describe, expect, test } from "bun:test"
import {
  createJobId,
  emitJobCancelled,
  emitJobFinished,
  emitJobStarted,
  type JobEvent,
} from "../src/progress/job-event"
import { ProgressEmitter } from "../src/progress/progress"
import { consumeMarkitdownWorkerNdjsonLine } from "../src/import/pipeline"

describe("job progress bus bridge", () => {
  test("ProgressEmitter dual-publishes job.progress when jobId + onJobEvent are set", () => {
    const events: JobEvent[] = []
    const prog = new ProgressEmitter({
      jobId: "job_test_1",
      onJobEvent: (e) => events.push(e),
    })
    const local: Array<{ phase: string; current: number }> = []
    prog.on((e) => local.push({ phase: e.phase, current: e.current }))

    prog.file("OCR", 1, 3, "scan.pdf")

    expect(local).toEqual([{ phase: "OCR", current: 1 }])
    expect(events).toEqual([
      {
        type: "job.progress",
        properties: { jobId: "job_test_1", phase: "OCR", current: 1, total: 3, relPath: "scan.pdf" },
      },
    ])
  })

  test("MarkItDown NDJSON progress/log/done drive job.progress via ProgressEmitter bridge", () => {
    const events: JobEvent[] = []
    const jobId = createJobId("markitdown")
    const prog = new ProgressEmitter({
      jobId,
      onJobEvent: (e) => events.push(e),
    })
    emitJobStarted((e) => events.push(e), jobId, "import", "MarkItDown batch")

    const state = {
      converted: 0,
      skipped: 0,
      failed: 0,
      renamed: 0,
      recoverable: [] as Array<{ src: string; dest: string }>,
      errors: [] as string[],
    }
    let processed = 0
    const total = 1
    const onProgress = (c: number, t: number, rel: string) => prog.file("MarkItDown", c, t, rel, c === t ? "done" : "processing")

    for (const line of [
      `{"type":"progress","current":0,"total":1,"relPath":"doc.pdf","status":"processing"}`,
      `{"type":"log","message":"test log"}`,
      `{"type":"progress","current":1,"total":1,"relPath":"doc.pdf","status":"done"}`,
      `{"type":"done","converted":1,"skipped":0,"failed":0,"renamed":0,"recoverable":[]}`,
    ]) {
      consumeMarkitdownWorkerNdjsonLine(line, state, { onLog: () => {}, onProgress })
    }

    emitJobFinished((e) => events.push(e), jobId, "completed", "1 file")

    expect(events[0]?.type).toBe("job.started")
    expect(events.some((e) => e.type === "job.progress" && e.properties.relPath === "doc.pdf")).toBe(true)
    expect(state.converted).toBe(1)
  })

  test("cancel emits job.cancelled", () => {
    const events: JobEvent[] = []
    const jobId = "job_cancel"
    emitJobCancelled((e) => events.push(e), jobId)
    expect(events).toEqual([{ type: "job.cancelled", properties: { jobId } }])
  })
})
