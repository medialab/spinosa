import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app } from "electron"
import { describeSidecarLaunch, formatDiagnosticErrorChain, serializeDiagnosticError } from "./diagnostics"
import { resolveDevelopmentFrameworkRoot, withDevelopmentFrameworkRoot } from "./framework-root"
import { getLogger } from "./logging"
import { getUserShell, loadShellEnv } from "./shell-env"
import { desktopSidecarCorsOrigins } from "./server-cors"
import { getStore } from "./store"
import { DEFAULT_SERVER_URL_KEY } from "./store-keys"

export type HealthCheck = { wait: Promise<void> }

export type SidecarListener = { stop: () => Promise<void> }

const SIDECAR_START_TIMEOUT = 60_000
const SIDECAR_STOP_TIMEOUT = 6_000
const SIDECAR_READY_MARKER = "spinosa-sidecar-ready"

type SpawnLocalServerOptions = {
  userDataPath: string
  onStdout?: (message: string) => void
  onStderr?: (message: string) => void
  onExit?: (code: number | null, signal?: NodeJS.Signals | null) => void
  onDiagnostic?: (event: string, fields?: Record<string, unknown>, level?: "info" | "warn" | "error") => void
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

export function preferAppEnv(userDataPath: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? loadShellEnv(shell, getLogger()) : null
  Object.assign(process.env, {
    ...shellEnv,
    SPINOSA_EXPERIMENTAL_ICON_DISCOVERY: "true",
    SPINOSA_EXPERIMENTAL_FILEWATCHER: "true",
    SPINOSA_CLIENT: "desktop",
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
  })
  return shellEnv
}

export { describeSidecarLaunch } from "./diagnostics"

function emitDiagnostic(
  options: SpawnLocalServerOptions,
  event: string,
  fields: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info",
) {
  options.onDiagnostic?.(event, fields, level)
}

export async function spawnLocalServer(
  hostname: string,
  port: number,
  password: string,
  options: SpawnLocalServerOptions,
) {
  const launchID = randomUUID()
  const startedAt = Date.now()
  const appPath = safeAppPath()
  const resourcesPath = safeResourcesPath()
  const bunBin = resolveBunBin()
  const bunSource = process.env.SPINOSA_BUN_BIN ? "SPINOSA_BUN_BIN" : app.isPackaged ? "resources-or-path" : "path"
  const sidecarScript = resolveSidecarScript()
  const developmentRoot = app.isPackaged ? undefined : resolveDevelopmentFrameworkRoot(appPath)
  const env = createSidecarEnv(hostname, port, password, options.userDataPath, launchID, appPath, resourcesPath, sidecarScript)
  if (developmentRoot) env.SPINOSA_DESKTOP_DEVELOPMENT_ROOT = developmentRoot
  const launch = describeSidecarLaunch({
    launchID,
    packaged: app.isPackaged,
    cwd: process.cwd(),
    appPath,
    resourcesPath,
    userDataPath: options.userDataPath,
    bunBin,
    bunSource,
    sidecarScript,
    env,
    developmentRoot,
  })
  emitDiagnostic(options, "sidecar.launch", { ...launch, elapsedMs: 0 })

  let child: ChildProcess
  try {
    child = spawn(bunBin, [sidecarScript], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    emitDiagnostic(options, "sidecar.spawn.error", { launchID, error: serializeDiagnosticError(error) }, "error")
    throw new Error(`Failed to spawn Bun sidecar: ${formatDiagnosticErrorChain(error)}`, { cause: error })
  }

  let exited = false
  let stderrTail = ""
  const exit = defer<{ code: number | null; signal: NodeJS.Signals | null }>()
  emitDiagnostic(options, "sidecar.spawned", { launchID, pid: child.pid, bunBin, sidecarScript })

  child.once("exit", (code, signal) => {
    exited = true
    emitDiagnostic(
      options,
      "sidecar.exit",
      { launchID, pid: child.pid, code, signal, durationMs: Date.now() - startedAt },
      code === 0 ? "info" : "warn",
    )
    options.onExit?.(code, signal)
    exit.resolve({ code, signal })
  })
  child.once("error", (error) => {
    emitDiagnostic(options, "sidecar.process.error", { launchID, pid: child.pid, error: serializeDiagnosticError(error) }, "error")
    options.onStderr?.(`bun sidecar spawn error: ${formatDiagnosticErrorChain(error)}`)
    if (!exited) {
      exited = true
      exit.resolve({ code: null, signal: null })
    }
  })

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8")
    for (const line of text.split("\n")) {
      const trimmed = line.trimEnd()
      if (trimmed) options.onStdout?.(trimmed)
    }
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trimEnd()
    if (!text) return
    stderrTail = `${stderrTail}\n${text}`.trim().slice(-8_000)
    options.onStderr?.(text)
  })

  try {
    await waitForReadyMarker(child, bunBin, sidecarScript, options, () => stderrTail)
  } catch (error) {
    emitDiagnostic(
      options,
      "sidecar.ready.error",
      { launchID, pid: child.pid, durationMs: Date.now() - startedAt, error: serializeDiagnosticError(error), stderrTail },
      "error",
    )
    if (!exited) child.kill("SIGTERM")
    throw error
  }
  emitDiagnostic(options, "sidecar.ready", { launchID, pid: child.pid, durationMs: Date.now() - startedAt })

  const wait = (async () => {
    const url = `http://${hostname}:${port}`
    let healthy = false
    const gone = exit.promise.then(({ code, signal }) => {
      if (healthy) return
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
      throw new Error(`Sidecar exited before health check passed with ${reason}`)
    })

    let healthProbeErrorLogged = false
    const ready = async () => {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (await checkHealth(url, password, (error, endpoint) => {
          if (healthProbeErrorLogged) return
          healthProbeErrorLogged = true
          emitDiagnostic(options, "sidecar.health.probe.error", { launchID, endpoint, error: serializeDiagnosticError(error) }, "warn")
        })) {
          healthy = true
          emitDiagnostic(options, "sidecar.health", { launchID, url, durationMs: Date.now() - startedAt })
          return
        }
      }
    }

    await Promise.race([ready(), gone])
  })()

  let stopping: Promise<void> | undefined

  return {
    listener: {
      stop: () => {
        if (stopping) return stopping
        if (exited) return Promise.resolve()
        emitDiagnostic(options, "sidecar.stop", { launchID, pid: child.pid })
        child.kill("SIGTERM")
        stopping = Promise.race([
          exit.promise.then(() => undefined),
          delay(SIDECAR_STOP_TIMEOUT).then(() => {
            if (!exited) {
              emitDiagnostic(options, "sidecar.stop.timeout", { launchID, pid: child.pid, durationMs: SIDECAR_STOP_TIMEOUT }, "warn")
              child.kill("SIGKILL")
            }
          }),
        ])
        return stopping
      },
    },
    health: { wait },
  }
}

export async function checkHealth(
  url: string,
  password?: string | null,
  onFailure?: (error: unknown, endpoint: string) => void,
): Promise<boolean> {
  let healthUrls: URL[]
  try {
    healthUrls = [new URL("/api/health", url), new URL("/global/health", url)]
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`spinosa:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  for (const healthUrl of healthUrls) {
    try {
      const res = await fetch(healthUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) return true
    } catch (error) {
      onFailure?.(error, healthUrl.toString())
    }
  }
  return false
}

function createSidecarEnv(
  hostname: string,
  port: number,
  password: string,
  userDataPath: string,
  launchID: string,
  appPath: string,
  resourcesPath: string,
  sidecarScript: string,
): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  delete env.DEBUG
  if (process.platform === "linux") delete env.LD_PRELOAD
  if (!app.isPackaged) Object.assign(env, withDevelopmentFrameworkRoot(env, appPath))
  const corsOrigins = desktopSidecarCorsOrigins({
    packaged: app.isPackaged,
    rendererURL: process.env.ELECTRON_RENDERER_URL,
  })
  return {
    ...env,
    SPINOSA_SERVER_USERNAME: "spinosa",
    SPINOSA_SERVER_PASSWORD: password,
    SPINOSA_SIDECAR_HOSTNAME: hostname,
    SPINOSA_SIDECAR_PORT: String(port),
    SPINOSA_SIDECAR_PASSWORD: password,
    SPINOSA_SIDECAR_CORS: corsOrigins.join(","),
    SPINOSA_SIDECAR_USER_DATA_PATH: userDataPath,
    SPINOSA_DESKTOP_LAUNCH_ID: launchID,
    SPINOSA_DESKTOP_PACKAGED: String(app.isPackaged),
    SPINOSA_DESKTOP_APP_PATH: appPath,
    SPINOSA_DESKTOP_RESOURCES_PATH: resourcesPath,
    SPINOSA_DESKTOP_SIDECAR_SCRIPT: sidecarScript,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
  }
}

function safeAppPath() {
  try {
    return app.getAppPath()
  } catch {
    return join(dirname(fileURLToPath(import.meta.url)), "..", "..")
  }
}

function safeResourcesPath() {
  try {
    return process.resourcesPath
  } catch {
    return ""
  }
}

function resolveBunBin(): string {
  // Packaged override first, then a bundled bun binary next to resources,
  // then PATH. Packaged bundling of the bun binary is a follow-up; dev
  // always resolves via PATH.
  if (process.env.SPINOSA_BUN_BIN) return process.env.SPINOSA_BUN_BIN
  try {
    const bundled = join(safeResourcesPath(), "bun", process.platform === "win32" ? "bun.exe" : "bun")
    if (bundled && existsSync(bundled)) return bundled
  } catch {}
  return "bun"
}

function resolveSidecarScript(): string {
  // Packaged app serves the sidecar script from extraResources; dev runs it
  // from the package scripts directory via app.getAppPath().
  try {
    if (app.isPackaged) {
      return join(safeResourcesPath(), "spinosa-sidecar", "serve-bun-sidecar.ts")
    }
    return join(safeAppPath(), "scripts", "serve-bun-sidecar.ts")
  } catch {}
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "serve-bun-sidecar.ts")
}

function waitForReadyMarker(
  child: ChildProcess,
  bunBin: string,
  sidecarScript: string,
  options: SpawnLocalServerOptions,
  stderrTail: () => string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false
    let buffer = ""
    const timeout = setTimeout(() => {
      const detail = stderrTail()
      fail(new Error(`Bun sidecar did not become ready within ${SIDECAR_START_TIMEOUT}ms: ${bunBin} ${sidecarScript}${detail ? `\n${detail}` : ""}`))
    }, SIDECAR_START_TIMEOUT)

    const fail = (error: Error) => {
      if (done) return
      done = true
      cleanup()
      reject(error)
    }

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (line.includes(SIDECAR_READY_MARKER)) {
          if (done) return
          done = true
          cleanup()
          resolve()
          return
        }
      }
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
      const detail = stderrTail()
      fail(new Error(`Bun sidecar exited before ready with ${reason}${detail ? `\n${detail}` : ""}`))
    }
    const onError = (error: Error) => {
      options.onStderr?.(`bun sidecar error before ready: ${formatDiagnosticErrorChain(error)}`)
      fail(error)
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.stdout?.off("data", onData)
      child.off("exit", onExit)
      child.off("error", onError as (error: Error) => void)
    }

    child.stdout?.on("data", onData)
    child.once("exit", onExit)
    child.once("error", onError)
  })
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
