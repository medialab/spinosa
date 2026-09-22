/**
 * Legacy-shape adapter over the Spinosa V2 hey-api client.
 *
 * The app's `ServerApi`/`CompatibleApi` surface speaks the legacy promise
 * shape. The generated Spinosa client instead resolves hey-api transport
 * envelopes: `{ data, request, response }` on success and
 * `{ error, request, response }` on non-throwing failure (the app creates
 * clients with `throwOnError: true`, so transport and non-2xx failures throw
 * instead — the error branch below is defensive). The legacy opencode client
 * resolved the older `{ data, error }` envelope. This proxy unwraps exactly
 * one transport layer to bare data (throwing the parsed error body when the
 * envelope carries one) and passes namespaces, streams, and primitives
 * through untouched, so existing consumers keep working without logic
 * changes.
 *
 * Exactly one layer: domain payloads that themselves contain `data`/`error`
 * fields are returned as-is unless they also carry the hey-api
 * `request`/`response` transport markers. Subscription results shaped
 * `{ stream }` resolve to the async iterable itself so `for await` consumers
 * keep working (callers must still `await` the subscription promise).
 */
export function adaptToLegacy<T extends object>(client: T): unknown {
  return adapt(client)
}

function isObject(value: unknown): value is Record<string | symbol, unknown> {
  return value !== null && (typeof value === "object" || typeof value === "function")
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    isObject(value) &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  )
}

export function unwrapEnvelope(result: unknown): unknown {
  if (!isObject(result)) return result
  if (isAsyncIterable(result)) return result
  if ("stream" in result && Object.keys(result).length === 1 && isAsyncIterable(result.stream)) {
    return result.stream
  }
  if ("request" in result && "response" in result && ("data" in result || "error" in result)) {
    const envelope = result as { data?: unknown; error?: unknown }
    if (envelope.error !== undefined) throw envelope.error
    return (envelope as { data?: unknown }).data
  }
  if ("data" in result && "error" in result) {
    const envelope = result as { data: unknown; error: unknown }
    if (envelope.error !== undefined) throw envelope.error
    return envelope.data
  }
  return result
}

function adapt(value: unknown): unknown {
  if (isObject(value)) {
    return new Proxy(value as object, {
      get(target, property, receiver) {
        if (property === "then") return Reflect.get(target, property, receiver)
        const current = Reflect.get(target, property, receiver)
        if (typeof current === "function") {
          return (...args: Array<unknown>) =>
            Promise.resolve(Reflect.apply(current, receiver, args)).then(unwrapEnvelope)
        }
        return adapt(current)
      },
    })
  }
  return value
}
