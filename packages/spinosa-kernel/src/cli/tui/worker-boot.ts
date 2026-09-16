/**
 * Compiled TUI worker path + fail-closed boot helpers.
 *
 * Bun --compile puts extra entrypoints at `/$bunfs/root/<entrypoint>.js`.
 * A cwd-relative `./src/cli/tui/worker.ts` define dies after `chdir` into
 * the user project (empty provider list, "Worker has been terminated").
 */

export const COMPILED_TUI_WORKER_RELATIVE = "src/cli/tui/worker.js"

export function compiledTuiWorkerPath(bunfsRoot: string): string {
  return `${bunfsRoot}${COMPILED_TUI_WORKER_RELATIVE}`
}

export async function waitForWorkerReady(input: {
  ping: () => Promise<unknown>
  attachError: (handler: (error: unknown) => void) => () => void
  timeoutMs?: number
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 30_000
  let timeout: ReturnType<typeof setTimeout> | undefined
  let detach = () => {}
  const failed = new Promise<never>((_, reject) => {
    detach = input.attachError((error) => {
      const detail = error instanceof Error ? error.message : String(error)
      reject(new Error(`TUI worker failed to start: ${detail}`))
    })
    timeout = setTimeout(() => {
      reject(new Error(`TUI worker did not become ready within ${timeoutMs}ms`))
    }, timeoutMs)
  })
  try {
    await Promise.race([input.ping(), failed])
  } finally {
    if (timeout) clearTimeout(timeout)
    detach()
  }
}

export function evaluateTuiWorkerSmoke(input: {
  pingOk: boolean
  fetchError?: string
  status?: number
  providerCount?: number
}): { ok: boolean; error?: string; providers?: number } {
  if (!input.pingOk) return { ok: false, error: "TUI worker ping failed" }
  if (input.fetchError) {
    if (/worker has been terminated/i.test(input.fetchError)) {
      return { ok: false, error: "TUI worker was terminated before /provider returned" }
    }
    return { ok: false, error: input.fetchError }
  }
  if (input.status !== 200) {
    return { ok: false, error: `provider fetch HTTP ${input.status ?? "unknown"}` }
  }
  const providers = input.providerCount ?? 0
  if (providers <= 0) return { ok: false, error: "empty provider catalog from TUI worker" }
  return { ok: true, providers }
}

export function describeWorkerCallError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/worker has been terminated/i.test(message)) {
    return new Error("TUI background worker died. Restart Spinosa.")
  }
  return error instanceof Error ? error : new Error(message)
}
