#!/usr/bin/env bun
/**
 * Local rebuild + reinstall for day-to-day testing on this machine.
 *
 * Rebuilds the host binary from the working tree, stages it into
 * dist/v<VERSION>/, then reinstalls into SPINOSA_HOME via the real
 * install.sh served over a local HTTP server (same path end users take,
 * pointed at local assets with SPINOSA_RELEASE_BASE_URL).
 *
 * The staged installer gate runs unchanged so this exercises the same
 * verification and activation path as an end-user installation.
 *
 * Dirty trees are fine — that is the point (test your checkout).
 *
 * Usage:
 *   bun scripts/rebuild-install.ts [--version X.Y.Z] [--home DIR]
 *     [--bin-dir DIR] [--skip-build] [--no-activate]
 *
 *   --version X   Build + install version X. When it differs from
 *                 package.json, `scripts/set-version.ts` runs first so the
 *                 binary, installer pin, and metadata all agree.
 *   --skip-build  Skip the compile; stage + install the existing dist build.
 *   --no-activate Build (and stage) only; do not touch SPINOSA_HOME.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { $ } from "bun"
import { releaseChannel } from "../packages/spinosa-core/src/utils/version.ts"

const root = path.resolve(import.meta.dir, "..")

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i < 0 || i + 1 >= process.argv.length) return undefined
  return process.argv[i + 1]
}
const hasFlag = (flag: string): boolean => process.argv.includes(flag)

if (hasFlag("--help") || hasFlag("-h")) {
  const help = readFileSync(import.meta.path, "utf-8").match(/\/\*\*([\s\S]*?)\*\//)?.[1] ?? ""
  console.log(help.replace(/^\s*\* ?/gm, "").trim())
  process.exit(0)
}

const home = path.resolve(process.env.SPINOSA_HOME ?? argValue("--home") ?? path.join(homedir(), ".spinosa"))
const binDir = path.resolve(process.env.SPINOSA_BIN_DIR ?? argValue("--bin-dir") ?? path.join(homedir(), ".local", "bin"))
const log = (...args: unknown[]): void => console.log("→", ...args)

function readPkgVersion(): string {
  return (JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as { version: string }).version
}

// --- 1. Version (optional bump via set-version.ts) ---------------------------
let version = argValue("--version") ?? readPkgVersion()
if (argValue("--version") && argValue("--version") !== readPkgVersion()) {
  log(`syncing repo version to ${version} via set-version.ts`)
  const synced = await $`bun scripts/set-version.ts ${version}`.cwd(root).nothrow()
  if (synced.exitCode !== 0) throw new Error(`set-version.ts failed for ${version}`)
  version = readPkgVersion()
}
const channel = releaseChannel(version)
const tag = `v${version}`
const outDir = path.resolve(root, `dist/v${version}`)
log(`version ${version} (${channel}, ${tag}) → ${outDir}`)

// --- 2. Host binary build ----------------------------------------------------
if (!hasFlag("--skip-build")) {
  log("building host binary (template pack + Bun --compile + smoke)")
  const build = await $`bun scripts/build-release-binaries.ts --host-only --out-dir ${outDir} --version ${version}`.cwd(root).nothrow()
  if (build.exitCode !== 0) throw new Error("host binary build failed")
} else {
  log("skipping build (--skip-build)")
}

// --- 3. Stage dist assets (mirror scripts/release/stages.ts, host-local) ----
mkdirSync(outDir, { recursive: true })
const patchInstaller = (source: string): string =>
  source
    .replace(/^PINNED_VERSION=".*"/m, `PINNED_VERSION="${version}"`)
    .replace(/^PINNED_TAG=".*"/m, `PINNED_TAG="${tag}"`)
writeFileSync(path.join(outDir, "install.sh"), patchInstaller(readFileSync(path.join(root, "install.sh"), "utf-8")))
chmodSync(path.join(outDir, "install.sh"), 0o755)
log("staged install.sh")

const hostOs = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform
const hostArch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch
for (const required of [`spinosa-${hostOs}-${hostArch}`, "install.sh", "build-manifest.json"]) {
  if (!existsSync(path.join(outDir, required))) {
    throw new Error(`missing staged asset ${required} in ${outDir}`)
  }
}
const stagedFiles = ["install.sh", "build-manifest.json"]
for (const target of [`spinosa-${hostOs}-${hostArch}`]) {
  stagedFiles.push(target)
}
// Keep existing entries for other platforms when present (harmless, real hashes).
{
  const { readdirSync } = await import("node:fs")
  for (const name of readdirSync(outDir)) {
    if (/^spinosa-(darwin|linux)-(arm64|x64)(\.tar\.gz)?$/.test(name) || /^spinosa-tools-.+\.tar\.gz$/.test(name)) {
      if (!stagedFiles.includes(name)) stagedFiles.push(name)
    }
  }
}
const checksums = await $`shasum -a 256 ${stagedFiles}`.cwd(outDir).text()
writeFileSync(path.join(outDir, "checksums.txt"), checksums)
log(`checksums.txt refreshed (${stagedFiles.length} assets)`)

if (hasFlag("--no-activate")) {
  console.log(`✓ staged only (no activation) → ${outDir}`)
  process.exit(0)
}

// --- 4. Serve dist + run the real installer ----------------------------------
const installLog = path.join(home, "logs", "spinosa.log")

function serveDist(dir: string): { baseUrl: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      let rel = decodeURIComponent(url.pathname.replace(/^\//, ""))
      if (!rel || rel.endsWith("/")) rel = path.posix.join(rel, "install.sh")
      const abs = path.resolve(dir, rel)
      const resolvedDir = path.resolve(dir)
      if (abs !== resolvedDir && !abs.startsWith(resolvedDir + path.sep)) {
        return new Response("forbidden", { status: 403 })
      }
      const file = Bun.file(abs)
      if (!(await file.exists())) return new Response("not found", { status: 404 })
      return new Response(file)
    },
  })
  return { baseUrl: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}


const { baseUrl, stop } = serveDist(outDir)
log(`serving ${outDir} at ${baseUrl}`)
const installer = Bun.spawn(
  ["bash", path.join(outDir, "install.sh"), "--yes", "--no-launch", "--reinstall"],
  {
    cwd: root,
    env: { ...process.env, SPINOSA_HOME: home, SPINOSA_RELEASE_BASE_URL: baseUrl, SPINOSA_BIN_DIR: binDir },
    stdout: "inherit",
    stderr: "inherit",
  },
)

let installerDone: "ok" | "failed" | "running" = "running"
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const startedAt = Date.now()

for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 2000))
  if (installer.exitCode !== null) {
    installerDone = installer.exitCode === 0 ? "ok" : "failed"
    break
  }
  if (Date.now() - startedAt > INSTALL_TIMEOUT_MS) break
}

if (installerDone !== "ok") {
  if (installerDone === "failed") {
    stop()
    throw new Error(`installer failed with exit ${installer.exitCode} — see ${installLog}`)
  }
  installer.kill()
  await Promise.race([
    installer.exited,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ])
  stop()
  throw new Error("installer still running past timeout — see " + installLog)
}

stop()

const activeBin = path.join(home, "bin", "spinosa")
const activeProbe = Bun.spawnSync([activeBin, "version"], { timeout: 30_000 })
const activeOutput = `${activeProbe.stdout ?? ""}`.trim() + `${activeProbe.stderr ?? ""}`.trim()
if (activeProbe.exitCode !== 0 || !activeOutput.includes(version)) {
  throw new Error(`active binary failed version probe after installer run (want ${version}): ${activeOutput.slice(0, 200)}`)
}

const shim = path.join(binDir, "spinosa")
const smoke = Bun.spawnSync([shim, "version"], { timeout: 30_000 })
const smokeOutput = `${smoke.stdout ?? ""}`.trim() + `${smoke.stderr ?? ""}`.trim()
if (smoke.exitCode !== 0) throw new Error(`post-install smoke failed: ${smokeOutput.slice(0, 200)}`)

console.log(`✓ rebuilt + reinstalled: ${smokeOutput} (${shim})`)
