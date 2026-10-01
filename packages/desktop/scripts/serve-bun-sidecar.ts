#!/usr/bin/env bun
/**
 * Bun sidecar entry for the Electron thin shell.
 *
 * Spawned by `src/main/server.ts` via `child_process.spawn(bun, [...])` —
 * never bundled for plain Node, so the kernel always runs on its native
 * Bun runtime (bun:sqlite, no setReturnArrays shim, no jsonc-parser alias).
 *
 * Contract with the parent (over env + stdout, not utilityProcess messages):
 * - Env in: SPINOSA_SIDECAR_PORT, SPINOSA_SIDECAR_HOSTNAME,
 *   SPINOSA_SIDECAR_PASSWORD, SPINOSA_SIDECAR_USER_DATA_PATH,
 *   SPINOSA_SIDECAR_CORS (comma-separated renderer origins).
 *   SPINOSA_TEMPLATE_ROOT is set by the desktop parent in development when
 *   the checked-out framework root can be found above the app package.
 *   SPINOSA_SERVER_USERNAME/PASSWORD + XDG_STATE_HOME are set by the parent
 *   via createSidecarEnv(); this entry applies the same defaults defensively.
 * - Stdout: prints `spinosa-sidecar-ready <url>` once Server.listen resolves.
 *   The parent waits for that line (then runs its HTTP health check).
 * - Shutdown: SIGTERM/SIGINT stops the listener and exits 0.
 */

import { Server } from "@spinosa/kernel/server/server"

const port = Number(process.env.SPINOSA_SIDECAR_PORT ?? 4096)
const hostname = process.env.SPINOSA_SIDECAR_HOSTNAME ?? "127.0.0.1"
const password = process.env.SPINOSA_SIDECAR_PASSWORD ?? ""
const userDataPath = process.env.SPINOSA_SIDECAR_USER_DATA_PATH
const startedAt = Date.now()
const launchID = process.env.SPINOSA_DESKTOP_LAUNCH_ID
const cors = (process.env.SPINOSA_SIDECAR_CORS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

function serializeError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) }
  const result: Record<string, unknown> = { name: error.name, message: error.message }
  if (error.stack) result.stack = error.stack
  if (depth < 8 && error.cause !== undefined) result.cause = serializeError(error.cause, depth + 1)
  return result
}

function diagnostic(event: string, fields: Record<string, unknown> = {}) {
  process.stderr.write(`${JSON.stringify({ event, launchID, ...fields })}\n`)
}

if (!Number.isFinite(port) || port <= 0) {
  diagnostic("startup.invalid-port", { port: process.env.SPINOSA_SIDECAR_PORT })
  process.exit(2)
}

// Defensive defaults — the parent already sets these via createSidecarEnv().
if (!process.env.SPINOSA_SERVER_USERNAME) process.env.SPINOSA_SERVER_USERNAME = "spinosa"
if (password && !process.env.SPINOSA_SERVER_PASSWORD) process.env.SPINOSA_SERVER_PASSWORD = password
if (userDataPath && !process.env.XDG_STATE_HOME) process.env.XDG_STATE_HOME = userDataPath

diagnostic("startup", {
  pid: process.pid,
  runtime: "bun",
  bun: process.versions.bun,
  node: process.versions.node,
  cwd: process.cwd(),
  pwd: process.env.PWD,
  execPath: process.execPath,
  argv: process.argv,
  moduleUrl: import.meta.url,
  packaged: process.env.SPINOSA_DESKTOP_PACKAGED,
  appPath: process.env.SPINOSA_DESKTOP_APP_PATH,
  resourcesPath: process.env.SPINOSA_DESKTOP_RESOURCES_PATH,
  sidecarScript: process.env.SPINOSA_DESKTOP_SIDECAR_SCRIPT,
  templateRoot: process.env.SPINOSA_TEMPLATE_ROOT,
  frameworkRoot: process.env.SPINOSA_FRAMEWORK_ROOT,
  productHome: process.env.SPINOSA_HOME,
  xdgStateHome: process.env.XDG_STATE_HOME,
  hostname,
  port,
  corsOrigins: cors,
})

let listener: Awaited<ReturnType<typeof Server.listen>>
try {
  listener = await Server.listen({ port, hostname, ...(cors.length > 0 ? { cors } : {}) })
} catch (error) {
  diagnostic("startup.error", { durationMs: Date.now() - startedAt, error: serializeError(error) })
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
}

diagnostic("listening", { url: listener.url, durationMs: Date.now() - startedAt })
console.log(`spinosa-sidecar-ready ${listener.url}`)
process.stdout.write("", () => {})

const stop = async () => {
  diagnostic("stopping", { pid: process.pid })
  try {
    await listener.stop()
    diagnostic("stopped", { durationMs: Date.now() - startedAt })
    process.exit(0)
  } catch (error) {
    diagnostic("stop.error", { durationMs: Date.now() - startedAt, error: serializeError(error) })
    process.exit(1)
  }
}
process.on("SIGTERM", () => void stop())
process.on("SIGINT", () => void stop())
await new Promise(() => undefined)
