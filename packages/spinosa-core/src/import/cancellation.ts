export class SpinosaCancellationError extends Error {
  constructor(message = "Spinosa operation cancelled.") {
    super(message)
    this.name = "SpinosaCancellationError"
  }
}

export function isSpinosaCancellationError(error: unknown): error is SpinosaCancellationError {
  return error instanceof SpinosaCancellationError || (
    error instanceof Error && error.name === "SpinosaCancellationError"
  )
}

export function throwIfSpinosaCancelled(shouldAbort?: () => boolean, message?: string): void {
  if (!shouldAbort?.()) return
  throw new SpinosaCancellationError(message)
}

type SpawnedProc = { exited: Promise<number>; kill: () => void; stderr?: unknown; stdout?: unknown }

/**
 * Await a spawned child, killing it when cancellation flips (poll +
 * AbortSignal). Generic child-wait helper, not engine-specific.
 */
export async function waitAbortableChild(
  proc: SpawnedProc,
  opts?: { shouldAbort?: () => boolean; signal?: AbortSignal; label?: string },
): Promise<number> {
  if (opts?.shouldAbort?.() || opts?.signal?.aborted) {
    try { proc.kill() } catch {}
    throw new SpinosaCancellationError(`${opts?.label ?? "child process"} cancelled`)
  }
  if (!opts?.shouldAbort && !opts?.signal) return proc.exited
  return await new Promise<number>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearInterval(timer)
      opts?.signal?.removeEventListener("abort", onAbort)
    }
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      try { proc.kill() } catch {}
      reject(new SpinosaCancellationError(`${opts?.label ?? "child process"} cancelled`))
    }
    const onAbort = () => abort()
    const timer = setInterval(() => {
      if (opts?.shouldAbort?.() || opts?.signal?.aborted) abort()
    }, 200)
    opts?.signal?.addEventListener("abort", onAbort, { once: true })
    proc.exited.then(
      (code) => { if (!settled) { settled = true; cleanup(); resolve(code) } },
      (err) => { if (!settled) { settled = true; cleanup(); reject(err) } },
    )
  })
}
