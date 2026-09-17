import { describe, expect, test } from "bun:test"
import { wrapSSE } from "../src/sse"

const sseResponse = (body: ReadableStream<Uint8Array>) =>
  new Response(body, {
    headers: { "content-type": "text/event-stream" },
  })

describe("wrapSSE", () => {
  test("leaves non-SSE responses and disabled timeouts untouched", () => {
    const response = new Response("ok")
    const controller = new AbortController()
    const disabled = sseResponse(new ReadableStream<Uint8Array>())

    expect(wrapSSE(response, 10, controller)).toBe(response)
    expect(wrapSSE(disabled, 0, controller)).toBe(disabled)
  })

  test("aborts and reports the configured error when a read stalls", async () => {
    const controller = new AbortController()
    const response = sseResponse(
      new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}),
      }),
    )
    const wrapped = wrapSSE(
      response,
      1,
      controller,
      (timeoutMs) => new Error(`timeout:${timeoutMs}`),
    )
    const reader = wrapped.body!.getReader()

    await expect(reader.read()).rejects.toThrow("timeout:1")
    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toBeInstanceOf(Error)
  })
})
