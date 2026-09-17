/**
 * Add an inactivity timeout to an SSE response while preserving its headers
 * and aborting the caller's controller when a read stalls.
 */
export function wrapSSE(
  response: Response,
  timeoutMs: number,
  controller: AbortController,
  createTimeoutError: (timeoutMs: number) => Error = () =>
    new Error("SSE read timed out"),
): Response {
  if (typeof timeoutMs !== "number" || timeoutMs <= 0) return response
  if (!response.body) return response
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return response

  const reader = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>(
        (resolve, reject) => {
          const timer = setTimeout(() => {
            const error = createTimeoutError(timeoutMs)
            controller.abort(error)
            void reader.cancel(error)
            reject(error)
          }, timeoutMs)

          reader.read().then(
            (result) => {
              clearTimeout(timer)
              resolve(result)
            },
            (error) => {
              clearTimeout(timer)
              reject(error)
            },
          )
        },
      )

      if (part.done) {
        streamController.close()
        return
      }

      streamController.enqueue(part.value)
    },
    async cancel(reason) {
      controller.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(response.headers),
    status: response.status,
    statusText: response.statusText,
  })
}
