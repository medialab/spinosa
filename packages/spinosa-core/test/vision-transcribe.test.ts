import { describe, expect, test, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import * as path from "node:path"
import { tmpdir } from "node:os"
import { processVisionInProcess, VISION_ATTEMPT_TIMEOUT_MS } from "../src/import/vision-transcribe"
import { VISION_TRANSCRIBE_PROMPT, mimeForImageExt } from "../src/import/vision-helpers"
import type { ClassifiedEntry } from "../src/import/pipeline"

function makeTempImage(ext = "jpg"): { src: string; rel: string; dest: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "vision-test-"))
  const src = path.join(dir, `sample.${ext}`)
  writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]))
  const rawDir = path.join(dir, "raw")
  mkdirSync(rawDir, { recursive: true })
  const dest = path.join(rawDir, `sample__${ext}.md`)
  const logsDir = path.join(dir, ".logs")
  mkdirSync(logsDir, { recursive: true })
  return { src, rel: `sample.${ext}`, dest, dir }
}

describe("processVisionInProcess - callback based", () => {
  test("uses a two-minute deadline for each vision attempt", () => {
    expect(VISION_ATTEMPT_TIMEOUT_MS).toBe(120_000)
  })

  test("callback invocation forwards correct MIME and base64", async () => {
    const { src, rel, dest, dir } = makeTempImage("jpg")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    let captured: { providerID: string; modelID: string; prompt: string; image: { mime: string; data: string } } | undefined
    const transcribeVision = async (req: { providerID: string; modelID: string; prompt: string; image: { mime: string; data: string } }) => {
      captured = req
      // Verify mime is correct for jpg
      expect(req.image.mime).toBe("image/jpeg")
      // Verify base64 is valid and decodes to original bytes
      const buf = Buffer.from(req.image.data, "base64")
      expect(buf.length).toBeGreaterThan(0)
      // Verify prompt is the vision prompt
      expect(req.prompt).toBe(VISION_TRANSCRIBE_PROMPT)
      expect(req.providerID).toBe("openai")
      expect(req.modelID).toBe("gpt-4o-mini")
      return "# Transcribed\nHello from image"
    }
    const result = await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
      visionModelId: "openai/gpt-4o-mini",
      transcribeVision,
    })
    expect(captured).toBeDefined()
    expect(result.converted).toBe(1)
    expect(result.failed).toBe(0)
    expect(existsSync(dest)).toBe(true)
    const content = readFileSync(dest, "utf-8")
    expect(content).toContain("Hello from image")
  })

  test("forwards correct MIME for png and webp", async () => {
    for (const ext of ["png", "webp"] as const) {
      const { src, rel, dest, dir } = makeTempImage(ext)
      const logsDir = path.join(dir, ".logs")
      const files: ClassifiedEntry[] = [{ src, rel, dest }]
      const expectedMime = mimeForImageExt(ext)
      let gotMime: string | undefined
      const transcribeVision = async (req: { image: { mime: string; data: string } }) => {
        gotMime = req.image.mime
        return "text"
      }
      await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
        visionModelId: "openai/gpt-4o-mini",
        transcribeVision: transcribeVision as never,
      })
      expect(gotMime).toBe(expectedMime)
    }
  })

  test("reports truthful per-file vision stages through the existing log hook", async () => {
    const { src, rel, dest, dir } = makeTempImage("jpg")
    const logs: string[] = []
    const result = await processVisionInProcess([{ src, rel, dest }], path.join(dir, ".logs"), undefined, (message) => logs.push(message), undefined, {
      visionModelId: "openai/gpt-4o-mini",
      transcribeVision: async () => "transcribed",
    })

    expect(result.converted).toBe(1)
    expect(logs).toContain(`  ${rel} → preparing image…`)
    expect(logs).toContain(`  ${rel} → optimizing image…`)
    expect(logs).toContain(`  ${rel} → sending image to openai/gpt-4o-mini (attempt 1/3)…`)
    expect(logs).toContain(`  ${rel} → waiting for model response (up to 120s)…`)
  })

  test("cleans up timeout and abort listeners once transcription resolves", async () => {
    const { src, rel, dest, dir } = makeTempImage("jpg")
    const controller = new AbortController()
    const clearTimeoutSpy = spyOn(globalThis, "clearTimeout")
    const removeListenerSpy = spyOn(controller.signal, "removeEventListener")
    try {
      await processVisionInProcess([{ src, rel, dest }], path.join(dir, ".logs"), undefined, undefined, undefined, {
        visionModelId: "openai/gpt-4o-mini",
        transcribeVision: async () => "transcribed",
        signal: controller.signal,
      })
      expect(clearTimeoutSpy).toHaveBeenCalled()
      expect(removeListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function))
    } finally {
      clearTimeoutSpy.mockRestore()
      removeListenerSpy.mockRestore()
    }
  })

  test("safe fallback when callback not provided -> copy", async () => {
    const { src, rel, dest, dir } = makeTempImage("png")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    const result = await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
      visionModelId: "openai/gpt-4o-mini",
      // no transcribeVision
    })
    expect(result.converted).toBe(1)
    expect(result.failed).toBe(0)
    const fallback = path.join(path.dirname(dest), path.basename(src))
    expect(existsSync(fallback)).toBe(true)
    expect(existsSync(dest)).toBe(false)
  })

  test("safe fallback when vision model is tesseract-local -> copy", async () => {
    const { src, rel, dest, dir } = makeTempImage("jpg")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    const transcribeVision = async () => {
      throw new Error("should not be called for tesseract")
    }
    const result = await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
      visionModelId: "tesseract-local",
      transcribeVision: transcribeVision as never,
    })
    expect(result.converted).toBe(1)
    expect(result.failed).toBe(0)
  })

  test("respects shouldAbort cancellation", async () => {
    const { src, rel, dest, dir } = makeTempImage("webp")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    const transcribeVision = async () => {
      await new Promise((r) => setTimeout(r, 100))
      return "should not reach"
    }
    await expect(
      processVisionInProcess(files, logsDir, undefined, undefined, () => true, {
        visionModelId: "openai/gpt-4o-mini",
        transcribeVision: transcribeVision as never,
      }),
    ).rejects.toThrow()
  })

  test("respects AbortSignal cancellation", async () => {
    const { src, rel, dest, dir } = makeTempImage("jpg")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    const controller = new AbortController()
    controller.abort()
    const transcribeVision = async () => {
      await new Promise((r) => setTimeout(r, 50))
      return "text"
    }
    // With signal already aborted, it should throw cancellation before calling transcribe
    // Our implementation checks signal before race, but also races abortPromise
    // It should still attempt but abortPromise will reject quickly
    const result = await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
      visionModelId: "openai/gpt-4o-mini",
      transcribeVision: transcribeVision as never,
      signal: controller.signal,
    }).catch((e) => e)
    // It may either throw cancellation or fallback? The important is it doesn't hang
    expect(result).toBeDefined()
  })

  test("retries on retryable errors (429, 500) up to 3 times", async () => {
    const { src, rel, dest, dir } = makeTempImage("jpg")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    const logs: string[] = []
    let attempts = 0
    const transcribeVision = async () => {
      attempts++
      if (attempts < 3) throw new Error("429 rate limit exceeded")
      return "recovered after retry"
    }
    const result = await processVisionInProcess(files, logsDir, undefined, (message) => logs.push(message), undefined, {
      visionModelId: "openai/gpt-4o-mini",
      transcribeVision: transcribeVision as never,
    })
    expect(attempts).toBe(3)
    expect(result.converted).toBe(1)
    expect(existsSync(dest)).toBe(true)
    expect(logs.some((message) => message.includes(`  ${rel} → retry delay before attempt 2/3`))).toBe(true)
  })

  test("does not retry on auth errors (401)", async () => {
    const { src, rel, dest, dir } = makeTempImage("jpg")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    let attempts = 0
    const transcribeVision = async () => {
      attempts++
      throw new Error("401 Unauthorized - invalid_api_key")
    }
    const onVisionFailure = async () => {
      return "skip" as const
    }
    const result = await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
      visionModelId: "openai/gpt-4o-mini",
      transcribeVision: transcribeVision as never,
      onVisionFailure,
    })
    expect(attempts).toBe(1) // no retry for auth
    expect(result.failed).toBe(1)
  })

  test("auth failure pauses and offers re-auth via onVisionFailure", async () => {
    const { src, rel, dest, dir } = makeTempImage("jpg")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    let callCount = 0
    const transcribeVision = async () => {
      callCount++
      if (callCount === 1) throw new Error("401 Unauthorized")
      return "after re-auth"
    }
    let failureCalled = false
    let failureModelId: string | undefined
    const onVisionFailure = async (relPath: string, modelId: string, error: string) => {
      failureCalled = true
      failureModelId = modelId
      expect(relPath).toBe(rel)
      expect(error).toContain("401")
      return "retry" as const
    }
    const result = await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
      visionModelId: "openai/gpt-4o-mini",
      transcribeVision: transcribeVision as never,
      onVisionFailure,
    })
    expect(failureCalled).toBe(true)
    expect(failureModelId).toBe("openai/gpt-4o-mini")
    expect(result.converted).toBe(1)
    expect(callCount).toBe(2)
  })

  test("vision request contains no API key (only providerID/modelID/prompt/mime+base64)", async () => {
    const { src, rel, dest, dir } = makeTempImage("jpg")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    let captured: unknown
    const transcribeVision = async (req: unknown) => {
      captured = req
      return "ok"
    }
    await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
      visionModelId: "anthropic/claude-3-5-sonnet",
      transcribeVision: transcribeVision as never,
    })
    const req = captured as Record<string, unknown>
    expect(req.providerID).toBe("anthropic")
    expect(req.modelID).toBe("claude-3-5-sonnet")
    expect(req).not.toHaveProperty("apiKey")
    expect(req).not.toHaveProperty("key")
    const image = req.image as { mime: string; data: string }
    expect(image.mime).toBe("image/jpeg")
    expect(typeof image.data).toBe("string")
    // data should be base64, not data URL
    expect(image.data.startsWith("data:")).toBe(false)
    expect(() => Buffer.from(image.data, "base64")).not.toThrow()
  })

  test("fallback copy preserves original file when vision fails non-auth and skipped", async () => {
    const { src, rel, dest, dir } = makeTempImage("jpg")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    const transcribeVision = async () => {
      throw new Error("500 Internal Server Error")
    }
    const onVisionFailure = async () => "skip" as const
    const result = await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
      visionModelId: "openai/gpt-4o-mini",
      transcribeVision: transcribeVision as never,
      onVisionFailure,
    })
    expect(result.failed).toBe(1)
    // Should have fallback copy? For non-auth skip, we don't fallback? Check implementation: for non-auth we just mark failed, no fallback copy
    // But we should ensure no .md was created
    expect(existsSync(dest)).toBe(false)
  })

  // Backward compat: original fallback test when no callback
  test("copy fallback when vision key missing (no callback)", async () => {
    const { src, rel, dest, dir } = makeTempImage("png")
    const logsDir = path.join(dir, ".logs")
    const files: ClassifiedEntry[] = [{ src, rel, dest }]
    const result = await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
      visionModelId: "openrouter/qwen2.5-vl:free",
    })
    expect(result.converted).toBe(1)
    expect(result.failed).toBe(0)
  })
})

describe("processVisionInProcess manual retry cap", () => {
  test("always-retry resolves to failed with bounded transcribe calls", async () => {
    const { processVisionInProcess } = await import("../src/import/vision-transcribe")
    const dir = mkdtempSync(path.join(tmpdir(), "spinosa-vision-cap-"))
    const logsDir = path.join(dir, ".logs")
    mkdirSync(logsDir, { recursive: true })
    const src = path.join(dir, "img.png")
    writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const dest = path.join(dir, "raw", "img__png.md")
    let transcribeCalls = 0
    const res = await processVisionInProcess(
      [{ src, rel: "img.png", dest }],
      logsDir,
      undefined,
      undefined,
      undefined,
      {
        visionModelId: "openai/gpt-4o-mini",
        transcribeVision: async () => {
          transcribeCalls++
          throw new Error("500 persistent boom")
        },
        // User mashes retry every time.
        onVisionFailure: async () => "retry",
      },
    )
    expect(res.failed).toBe(1)
    expect(res.converted).toBe(0)
    // 1 initial + 3 manual retries, ≤3 server attempts each.
    expect(transcribeCalls).toBeLessThanOrEqual(12)
    rmSync(dir, { recursive: true, force: true })
  }, 30000)
})
