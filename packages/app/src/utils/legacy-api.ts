/**
 * Legacy-shape adapter over the Spinosa V2 hey-api client.
 *
 * The app's `ServerApi`/`CompatibleApi` surface speaks the legacy promise
 * shape (bare-data method results that throw on failure). The generated
 * Spinosa client instead resolves `{ data, error }` envelopes. This proxy
 * unwraps success envelopes to bare data (throwing the parsed error body
 * when the envelope carries one) and passes namespaces, streams, and
 * primitives through untouched, so every existing consumer keeps working
 * without logic changes. The underlying client is created with
 * `throwOnError: true`, matching legacy throw semantics for transport
 * and non-2xx failures.
 */
export function adaptToLegacy<T extends object>(client: T): unknown {
  return adapt(client)
}

function adapt(value: unknown): unknown {
  if (value !== null && (typeof value === "object" || typeof value === "function")) {
    return new Proxy(value as object, {
      get(target, property, receiver) {
        if (property === "then") return Reflect.get(target, property, receiver)
        const current = Reflect.get(target, property, receiver)
        if (typeof current === "function") {
          return (...args: Array<unknown>) =>
            Promise.resolve(Reflect.apply(current, receiver, args)).then(unwrap)
        }
        return adapt(current)
      },
    })
  }
  return value
}

function unwrap(result: unknown): unknown {
  if (result !== null && typeof result === "object") {
    if (Symbol.asyncIterator in result) return result
    if ("data" in result && "error" in result) {
      const envelope = result as { data: unknown; error: unknown }
      if (envelope.error !== undefined) throw envelope.error
      return envelope.data
    }
  }
  return result
}
