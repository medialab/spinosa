#!/usr/bin/env node
/**
 * Probe the built desktop sidecar server bundle under plain Node.
 *
 * Usage:
 *   node packages/desktop/scripts/probe-server.mjs [bundle-path]
 *
 * Defaults to ../spinosa-kernel/dist/node/server-entry.js relative to the
 * desktop package. Imports the bundle from its original output directory so
 * source maps and sibling assets (.wasm/.node) resolve exactly as packaged.
 * Starts, probes, and stops the server in one owned process with isolated
 * temp HOME/config/data/state/cache/workspace directories and no inherited
 * provider credentials. Exits nonzero on any probe failure.
 */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(process.argv[2] ?? resolve(here, "../../spinosa-kernel/dist/node/server-entry.js"))

const root = mkdtempSync(resolve(tmpdir(), "spinosa-probe-"))
const home = resolve(root, "home")
const workspace = resolve(root, "workspace")
mkdirSync(home, { recursive: true })
mkdirSync(workspace, { recursive: true })
mkdirSync(resolve(workspace, ".spinosa"), { recursive: true })

// Full isolation: temp identity dirs, logging on, no provider credentials.
process.env.HOME = home
process.env.USERPROFILE = home
process.env.XDG_CONFIG_HOME = resolve(root, "config")
process.env.XDG_DATA_HOME = resolve(root, "data")
process.env.XDG_STATE_HOME = resolve(root, "state")
process.env.XDG_CACHE_HOME = resolve(root, "cache")
process.env.SPINOSA_PRINT_LOGS = "1"
process.env.SPINOSA_LOG_LEVEL = "DEBUG"
for (const key of Object.keys(process.env)) {
  if (/^(ANTHROPIC|OPENAI|OPENCODE|SPINOSA|MODELS_DEV|CUSTOM)_?(API_)?KEY/i.test(key)) delete process.env[key]
  if (/^(ANTHROPIC|OPENAI|OPENCODE)_/i.test(key)) delete process.env[key]
}
const password = "probe"
process.env.SPINOSA_SERVER_PASSWORD = password

const started = Date.now()
let listener
try {
  const { Server } = await import(pathToFileURL(bundlePath).href)
  listener = await Server.listen({ port: 0, hostname: "127.0.0.1" })
} catch (error) {
  console.error(`BOOT FAIL (${Date.now() - started}ms):`, error?.message ?? error)
  rmSync(root, { recursive: true, force: true })
  process.exit(2)
}

const auth = "Basic " + Buffer.from(`spinosa:${password}`).toString("base64")
const headers = { authorization: auth, "x-spinosa-directory": encodeURIComponent(workspace) }
const paths = [
  "/global/health",
  "/api/health",
  "/provider",
  "/provider/auth",
  "/agent",
  "/command",
  "/config",
  "/api/model",
  "/api/provider",
  "/api/integration",
  "/session",
  "/project",
]

let failed = 0
for (const path of paths) {
  const deadline = AbortSignal.timeout(30_000)
  const begin = Date.now()
  try {
    const response = await fetch(new URL(path, listener.url), { headers, signal: deadline })
    const text = await response.text()
    let summary = text.slice(0, 300).replace(/\s+/g, " ")
    let ref
    try {
      const body = JSON.parse(text)
      const data = body.data ?? body
      if (data && typeof data === "object") {
        if (typeof data.ref === "string") ref = data.ref
        if (Array.isArray(data)) summary = `array[${data.length}] ${summary}`
        else if (typeof data.length === "number") summary = `length=${data.length} ${summary}`
      }
    } catch {
      // keep raw summary
    }
    const ok = response.status === 200
    if (!ok) failed += 1
    console.log(`${ok ? "PASS" : "FAIL"} ${path} ${response.status} ${Date.now() - begin}ms ${ref ? `ref=${ref} ` : ""}${summary}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${path} ERROR ${Date.now() - begin}ms ${error?.message ?? error}`)
  }
}

try {
  await listener.stop()
} catch (error) {
  console.log(`STOP WARN ${error?.message ?? error}`)
}
rmSync(root, { recursive: true, force: true })
console.log(`done failures=${failed} total=${Date.now() - started}ms bundle=${bundlePath}`)
process.exit(failed === 0 ? 0 : 1)
