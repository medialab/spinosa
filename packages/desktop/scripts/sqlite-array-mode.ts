/**
 * Array-mode patch for `node:sqlite` prepared statements. Pure logic, no
 * platform imports, so it stays unit-testable under any runtime.
 *
 * See `sqlite-node-shim.ts` for why this exists.
 */
export type ArrayModeStatement = {
  all: (...args: Array<never>) => unknown
  get: (...args: Array<never>) => unknown
  iterate: (...args: Array<never>) => unknown
  setReturnArrays?: (enabled: boolean) => unknown
}

function toArrayRow(row: unknown): unknown {
  if (row === null || typeof row !== "object") return row
  if (Array.isArray(row)) return row
  // node:sqlite returns one object per row with keys in column order for
  // string keys. Integer-like keys sort numerically per JS semantics; the
  // kernel's value-mode queries select named columns, so this holds.
  return Object.values(row)
}

/** Test seam: patch one prepared statement; exported for unit tests. */
export function patchStatement<T extends ArrayModeStatement>(statement: T): T {
  if (typeof statement.setReturnArrays === "function") return statement
  let arrayMode = false
  const original = {
    all: statement.all.bind(statement),
    get: statement.get.bind(statement),
    iterate: statement.iterate.bind(statement),
  }
  const apply = (name: "all" | "get" | "iterate", args: Array<never>) => {
    const result = original[name](...args)
    if (!arrayMode) return result
    if (name === "iterate") {
      const iterator = result as Iterable<unknown>
      return (function* () {
        for (const row of iterator) yield toArrayRow(row)
      })()
    }
    if (Array.isArray(result)) return result.map(toArrayRow)
    return toArrayRow(result)
  }
  // Own data properties shadow the prototype without a Proxy, so native
  // getters and internal slots keep their real receiver.
  const patched = statement as T & Record<"setReturnArrays" | "all" | "get" | "iterate", unknown>
  patched.setReturnArrays = (enabled: boolean) => void (arrayMode = enabled !== false)
  patched.all = (...args: Array<never>) => apply("all", args)
  patched.get = (...args: Array<never>) => apply("get", args)
  patched.iterate = (...args: Array<never>) => apply("iterate", args)
  return statement
}
