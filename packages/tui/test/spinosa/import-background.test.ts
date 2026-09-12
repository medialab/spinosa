import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createBackgroundImportService } from "../../src/spinosa/import-background"

function makeService() {
  return createRoot((dispose) => ({ svc: createBackgroundImportService(), dispose }))
}

function startRun(svc: ReturnType<typeof createBackgroundImportService>) {
  const started = svc.start({
    kind: "onboarding",
    title: "test import",
    directory: "/tmp/ws",
    workspacePath: "/tmp/ws",
    modelId: "openai/gpt-4o-mini",
  })
  expect(started).toBeDefined()
  return started!
}

describe("background import service", () => {
  test("single-flight: second start while active is refused", () => {
    const { svc, dispose } = makeService()
    try {
      expect(svc.active()).toBe(false)
      expect(startRun(svc)).toBeDefined()
      expect(svc.active()).toBe(true)
      expect(svc.start({ kind: "add-files", title: "x", modelId: "tesseract-local" })).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("foreground gate waits; resolveGate(true) proceeds", async () => {
    const { svc, dispose } = makeService()
    try {
      startRun(svc)
      const pending = svc.requestGate("vision", 3, "Transcribe")
      expect(svc.pendingGate()?.label).toBe("Transcribe")
      svc.resolveGate(true)
      await expect(pending).resolves.toBe(true)
      expect(svc.pendingGate()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("background gate auto-passes; detach resolves a waiting gate", async () => {
    const { svc, dispose } = makeService()
    try {
      startRun(svc)
      const pending = svc.requestGate("ocr", 2, "OCR")
      svc.detach()
      await expect(pending).resolves.toBe(true)
      expect(svc.background()).toBe(true)
      // Subsequent gates auto-pass with no pending state.
      await expect(svc.requestGate("vision", 1, "V")).resolves.toBe(true)
      expect(svc.pendingGate()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("empty vision results skip without pausing", async () => {
    const { svc, dispose } = makeService()
    try {
      startRun(svc)
      await expect(svc.onVisionFailure("a.png", "openai/gpt-4o", "Vision model returned no text")).resolves.toBe("skip")
      expect(svc.visionPause()).toBeUndefined()
      expect(svc.visionError()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("auth failure pauses; retry resolves and clears, skip keeps error", async () => {
    const { svc, dispose } = makeService()
    try {
      startRun(svc)
      const first = svc.onVisionFailure("a.png", "openai/gpt-4o", "401 Incorrect API key")
      expect(svc.visionPause()?.rel).toBe("a.png")
      expect(svc.visionPause()?.isAuth).toBe(true)
      expect(svc.visionError()).toContain("Authentication failed")
      expect(svc.lastAuthFailedProvider()).toBe("openai")
      svc.resolvePause("retry")
      await expect(first).resolves.toBe("retry")
      expect(svc.visionPause()).toBeUndefined()
      expect(svc.visionError()).toBeUndefined()

      const second = svc.onVisionFailure("b.png", "openai/gpt-4o", "500 boom")
      expect(svc.visionPause()?.isAuth).toBe(false)
      svc.resolvePause("skip")
      await expect(second).resolves.toBe("skip")
      // Skip keeps the error visible for the next file.
      expect(svc.visionError()).toContain("Vision openai/gpt-4o failed")
    } finally {
      dispose()
    }
  })

  test("page-suffixed progress maps to the file row without phantom rows", () => {
    const { svc, dispose } = makeService()
    try {
      startRun(svc)
      svc.seedQueue(["memo.pdf"])
      svc.reportProgress({ relPath: "memo.pdf", status: "processing" })
      svc.reportProgress({ relPath: "memo.pdf (page 2)", status: "processing" })
      svc.reportProgress({ relPath: "memo.pdf (page 3/12)", status: "processing" })
      // One row only: page ticks update the file row in place.
      expect(svc.snapshot().files).toEqual([{ rel: "memo.pdf", status: "processing", page: 3, pageTotal: 12 }])
      // The live current file keeps the full rel so the UI shows (PG: 3/12).
      expect(svc.currentFile()).toBe("memo.pdf (page 3/12)")
      // A tick without a total keeps the previously known total.
      svc.reportProgress({ relPath: "memo.pdf (page 4)", status: "processing" })
      expect(svc.snapshot().files).toEqual([{ rel: "memo.pdf", status: "processing", page: 4, pageTotal: 12 }])
      svc.reportProgress({ relPath: "memo.pdf", status: "done" })
      expect(svc.snapshot().files).toEqual([{ rel: "memo.pdf", status: "done" }])
      expect(svc.currentFile()).toBe("")
    } finally {
      dispose()
    }
  })

  test("cancel while paused resolves abort", async () => {
    const { svc, dispose } = makeService()
    try {
      startRun(svc)
      const waiting = svc.onVisionFailure("a.png", "x/y", "500 boom")
      svc.cancel()
      await expect(waiting).resolves.toBe("abort")
      expect(svc.done()).toBe(true)
      expect(svc.cancelled()).toBe(true)
      expect(svc.shouldAbort()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("setModel updates live id and clears auth marker", () => {
    const { svc, dispose } = makeService()
    try {
      startRun(svc)
      void svc.onVisionFailure("a.png", "openai/gpt-4o", "401 no")
      expect(svc.lastAuthFailedProvider()).toBe("openai")
      svc.setModel("openrouter/qwen:free")
      expect(svc.getModel()).toBe("openrouter/qwen:free")
      expect(svc.lastAuthFailedProvider()).toBeUndefined()
      svc.resolvePause("skip")
    } finally {
      dispose()
    }
  })

  test("progress/files/logs mirror the run; finish records summary", () => {
    const { svc, dispose } = makeService()
    try {
      startRun(svc)
      svc.seedQueue(["a.txt", "b.png"])
      svc.reportProgress({ relPath: "a.txt", status: "processing" })
      expect(svc.currentFile()).toBe("a.txt")
      svc.reportProgress({ relPath: "a.txt", status: "done" })
      svc.reportProgress({ relPath: "b.png", status: "failed" })
      expect(svc.currentFile()).toBe("")
      const snap = svc.snapshot()
      expect(snap.total).toBe(2)
      expect(snap.finished).toBe(2)
      expect(snap.failed).toBe(1)
      svc.appendLog("hello")
      expect(svc.logLines()).toContain("hello")
      svc.finish({ converted: 1, skipped: 0, failed: 1, renamed: 0, recovered: 0, stillMissing: 0, text: "1 failed", success: false })
      expect(svc.done()).toBe(true)
      expect(svc.success()).toBe(false)
      expect(svc.summary()?.text).toBe("1 failed")
      expect(svc.active()).toBe(false)
      // Dismiss resets for the next run.
      svc.dismiss()
      expect(svc.done()).toBe(false)
      expect(svc.summary()).toBeUndefined()
      expect(startRun(svc)).toBeDefined()
    } finally {
      dispose()
    }
  })
})

describe("background import service guards", () => {
  test("finish is single-writer: cancel then finish keeps cancelled outcome", () => {
    const { svc, dispose } = makeService()
    try {
      startRun(svc)
      svc.cancel()
      expect(svc.done()).toBe(true)
      expect(svc.cancelled()).toBe(true)
      svc.finish({ converted: 9, skipped: 0, failed: 0, renamed: 0, recovered: 0, stillMissing: 0, text: "late", success: true })
      expect(svc.success()).toBe(false)
      expect(svc.summary()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("runSeq increments per run for toast epoch keying", () => {
    const { svc, dispose } = makeService()
    try {
      expect(svc.snapshot().runSeq).toBe(0)
      startRun(svc)
      expect(svc.snapshot().runSeq).toBe(1)
      svc.cancel()
      startRun(svc)
      expect(svc.snapshot().runSeq).toBe(2)
    } finally {
      dispose()
    }
  })
})
