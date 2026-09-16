/**
 * Compiled TUI worker path + fail-closed boot helpers.
 *
 * Bun --compile puts extra entrypoints at `/$bunfs/root/<entrypoint>.js`.
 * A cwd-relative `./src/cli/tui/worker.ts` define dies after `chdir` into
 * the user project (empty provider list, "Worker has been terminated").
 */

import { existsSync } from "node:fs"
import path from "node:path"

export const COMPILED_TUI_WORKER_RELATIVE = "src/cli/tui/worker.js"

/** Fail closed: a healthy snapshot `/provider` through a hermetic worker is fast. */
export const TUI_WORKER_PROVIDER_FETCH_MS = 30_000

/** Live TUI worker RPC. Matches the vision-provider budget; never hang forever. */
export const TUI_WORKER_FETCH_MS = 120_000

export const PARSER_WORKER_READY_MS = 15_000

const TUI_WORKER_SMOKE_ENV_KEYS = [
  "HOME",
  "SPINOSA_HOME",
  "SPINOSA_DISABLE_MODELS_FETCH",
  "SPINOSA_PURE",
  "SPINOSA_FAIL_ON_BOOT_NOISE",
] as const

export type TuiWorkerSmokeEnvSnapshot = Record<(typeof TUI_WORKER_SMOKE_ENV_KEYS)[number], string | undefined>

/** Isolate the worker from the host HOME catalog and models.dev. */
export function applyTuiWorkerSmokeEnv(env: NodeJS.ProcessEnv, homeDir: string): TuiWorkerSmokeEnvSnapshot {
  const previous = {} as TuiWorkerSmokeEnvSnapshot
  for (const key of TUI_WORKER_SMOKE_ENV_KEYS) previous[key] = env[key]
  env.HOME = homeDir
  env.SPINOSA_HOME = `${homeDir.replace(/\/+$/, "")}/.spinosa`
  env.SPINOSA_DISABLE_MODELS_FETCH = "1"
  env.SPINOSA_PURE = "1"
  env.SPINOSA_FAIL_ON_BOOT_NOISE = "1"
  return previous
}

export function restoreTuiWorkerSmokeEnv(env: NodeJS.ProcessEnv, previous: TuiWorkerSmokeEnvSnapshot): void {
  for (const key of TUI_WORKER_SMOKE_ENV_KEYS) {
    const value = previous[key]
    if (value === undefined) delete env[key]
    else env[key] = value
  }
}

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
  bootNoise?: readonly string[]
  ptyOk?: boolean
}): { ok: boolean; error?: string; providers?: number } {
  if (!input.pingOk) return { ok: false, error: "TUI worker ping failed" }
  if (input.bootNoise && input.bootNoise.length > 0) {
    return { ok: false, error: `TUI worker printed canvas/pdf.js boot noise: ${input.bootNoise[0]}` }
  }
  if (input.ptyOk === false) return { ok: false, error: "TUI worker pty native missing" }
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

export function resolveParserWorkerPath(input: {
  compiledPath?: string
  kernelCwd?: string
  exists?: (p: string) => boolean
}): string {
  if (input.compiledPath) return input.compiledPath
  const cwd = input.kernelCwd ?? process.cwd()
  const exists = input.exists ?? existsSync
  const local = path.resolve(cwd, "node_modules/@opentui/core/parser.worker.js")
  const root = path.resolve(cwd, "../../node_modules/@opentui/core/parser.worker.js")
  if (exists(local)) return local
  if (exists(root)) return root
  throw new Error("OpenTUI parser.worker.js not found")
}

export function evaluateParserWorkerSmoke(input: {
  ready: boolean
  error?: string
}): { ok: boolean; error?: string } {
  if (input.error) return { ok: false, error: input.error }
  if (!input.ready) return { ok: false, error: "parser worker did not respond" }
  return { ok: true }
}

export async function waitForParserWorkerReady(input: {
  post: (message: { type: string; messageId: number }) => void
  attachMessage: (handler: (data: { type?: string; error?: string }) => void) => () => void
  attachError: (handler: (error: unknown) => void) => () => void
  timeoutMs?: number
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? PARSER_WORKER_READY_MS
  let timeout: ReturnType<typeof setTimeout> | undefined
  let detachMessage = () => {}
  let detachError = () => {}
  const result = new Promise<void>((resolve, reject) => {
    detachMessage = input.attachMessage((data) => {
      if (data.type === "PERFORMANCE_RESPONSE") resolve()
      else if (data.type === "ERROR") reject(new Error(data.error ?? "parser worker error"))
    })
    detachError = input.attachError((error) => {
      const detail = error instanceof Error ? error.message : String(error)
      reject(new Error(`parser worker failed to start: ${detail}`))
    })
    timeout = setTimeout(() => {
      reject(new Error(`parser worker did not become ready within ${timeoutMs}ms`))
    }, timeoutMs)
    input.post({ type: "GET_PERFORMANCE", messageId: 1 })
  })
  try {
    await result
  } finally {
    if (timeout) clearTimeout(timeout)
    detachMessage()
    detachError()
  }
}

export function describeWorkerCallError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/worker has been terminated/i.test(message)) {
    return new Error("TUI background worker died. Restart Spinosa.")
  }
  return error instanceof Error ? error : new Error(message)
}
