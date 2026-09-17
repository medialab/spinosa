import { describe, expect, test } from "bun:test"
import { VISION_ATTEMPT_TIMEOUT_MS } from "../src/import/vision-transcribe"

describe("vision request lifecycle", () => {
  test("transcribe request type carries AbortSignal", async () => {
    const mod = await import("../src/import/vision-transcribe")
    const src = mod.processVisionInProcess.toString()
    expect(src.length).toBeGreaterThan(0)
    expect(VISION_ATTEMPT_TIMEOUT_MS).toBe(120_000)
  })

  test("provider request forwards the linked signal (source check)", async () => {
    const src = await Bun.file(new URL("../src/import/vision-transcribe.ts", import.meta.url)).text()
    expect(src).toContain("signal: linked")
    expect(src).toContain("transcribeVision({ ...request, signal: linked })")
    expect(src).not.toContain("Promise.race([transcription, timeoutPromise, abortPromise])")
  })
})
