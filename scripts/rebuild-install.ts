#!/usr/bin/env bun
/**
 * Local rebuild + reinstall for day-to-day testing on this machine.
 *
 * Rebuilds the host binary from the working tree, stages it into
 * dist/v<VERSION>/, then reinstalls into SPINOSA_HOME via the real
 * install.sh served over a local HTTP server (same path end users take,
 * pointed at local assets with SPINOSA_RELEASE_BASE_URL).
 *
 * The installer's staged `doctor` gate currently hangs on this machine
 * (no output, no timeout — see install.sh run_staged_binary_checks), so by
 * default this script intercepts right after template verification passes
 * and performs the installer's own activation steps manually
 * (checksum-verify → backup → activate → version-probe → shim →
 * metadata). Pass --strict to let install.sh run to completion instead.
 *
 * Dirty trees are fine — that is the point (test your checkout).
 *
 * Usage:
 *   bun scripts/rebuild-install.ts [--version X.Y.Z] [--home DIR]
 *     [--bin-dir DIR] [--skip-build] [--no-activate] [--strict] [--verbose]
 *
 *   --version X   Build + install version X. When it differs from
 *                 package.json, `scripts/set-version.ts` runs first so the
 *                 binary, installer pin, and metadata all agree.
 *   --skip-build  Skip the compile; stage + install the existing dist build.
 *   --no-activate Build (and stage) only; do not touch SPINOSA_HOME.
 *   --strict      Do not intercept the doctor gate (hangs until fixed).
 */
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
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

const verbose = hasFlag("--verbose")
const home = path.resolve(process.env.SPINOSA_HOME ?? argValue("--home") ?? path.join(homedir(), ".spinosa"))
const binDir = path.resolve(process.env.SPINOSA_BIN_DIR ?? argValue("--bin-dir") ?? path.join(homedir(), ".local", "bin"))
const log = (...args: unknown[]): void => console.log("→", ...args)
const detail = (...args: unknown[]): void => {
  if (verbose) console.log("  ", ...args)
}

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
const stagingDir = path.join(home, ".staging")
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

function installLogSize(): number {
  try {
    return (Bun.file(installLog).size as number) ?? 0
  } catch {
    return 0
  }
}

async function installLogSince(offset: number): Promise<string> {
  try {
    const text = await Bun.file(installLog).text()
    return text.slice(offset)
  } catch {
    return ""
  }
}

function killPattern(pattern: string, signal: NodeJS.Signals = "SIGTERM"): void {
  const result = spawnSync("pkill", [`-${signal === "SIGKILL" ? "9" : "TERM"}`, "-f", pattern])
  detail(`pkill ${pattern}: exit ${result.status}`)
}

const { baseUrl, stop } = serveDist(outDir)
log(`serving ${outDir} at ${baseUrl}`)
const logOffset = installLogSize()
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
const GATE_GRACE_MS = 15_000
let gateSeenAt: number | undefined

for (;;) {
  await new Promise((r) => setTimeout(r, 2000))
  if (installer.exitCode !== null) {
    installerDone = installer.exitCode === 0 ? "ok" : "failed"
    break
  }
  if (Date.now() - startedAt > INSTALL_TIMEOUT_MS) break
  if (!hasFlag("--strict") && gateSeenAt === undefined) {
    const tail = await installLogSince(logOffset)
    if (tail.includes("template verify output")) {
      gateSeenAt = Date.now()
      log("template verification passed — installer is at the doctor gate")
    }
  }
  if (!hasFlag("--strict") && gateSeenAt !== undefined && Date.now() - gateSeenAt > GATE_GRACE_MS) {
    log("intercepting before the hanging doctor gate")
    break
  }
}

if (installerDone === "ok") {
  log("installer completed on its own (doctor gate passed)")
} else if (installerDone === "failed") {
  stop()
  throw new Error(`installer failed with exit ${installer.exitCode} — see ${installLog}`)
} else if (hasFlag("--strict")) {
  stop()
  throw new Error("installer still running past timeout under --strict — see " + installLog)
} else {
  // Intercept: terminate the installer, then the stuck doctor child it
  // spawned (matches the staging binary path), then clear the stale
  // install lock. Activation below replaces _install_activate.
  try {
    process.kill(installer.pid, "SIGTERM")
  } catch { /* already exited */ }
  await new Promise((r) => setTimeout(r, 2000))
  try {
    process.kill(installer.pid, "SIGKILL")
  } catch { /* already exited */ }
  killPattern(path.join(stagingDir, "spinosa-"))
  await new Promise((r) => setTimeout(r, 1000))
  killPattern(path.join(stagingDir, "spinosa-"), "SIGKILL")
  await installer.exited.catch(() => {})
  rmSync(path.join(stagingDir, ".install.lock"), { recursive: true, force: true })
  log("installer intercepted, stale lock cleared")
}
stop()

// --- 5. Manual activation (mirrors install.sh _install_activate) -------------
// Skipped when the installer completed on its own (it already activated).
const activeBin = path.join(home, "bin", "spinosa")
if (installerDone === "ok") {
  const probed = Bun.spawnSync([activeBin, "version"], { timeout: 30_000 })
  const out = `${probed.stdout ?? ""}`.trim() + `${probed.stderr ?? ""}`.trim()
  if (probed.exitCode !== 0 || !out.includes(version)) {
    throw new Error(`active binary failed version probe after installer run (want ${version}): ${out.slice(0, 200)}`)
  }
  log(`installer activated ${activeBin} (${version}) — nothing left to do`)
  process.exit(0)
}
const hostBinary = `spinosa-${hostOs}-${hostArch}`
const stagedBinary = path.join(stagingDir, hostBinary)
if (!existsSync(stagedBinary)) {
  throw new Error(`staged binary missing: ${stagedBinary} — see ${installLog}`)
}
const stagedHash = await $`shasum -a 256 ${stagedBinary}`.text().then((t) => t.split(/\s+/)[0])
const expectedHash = checksums
  .split("\n")
  .find((line) => line.endsWith(`  ${hostBinary}`))
  ?.split(/\s+/)[0]
if (!expectedHash || stagedHash !== expectedHash) {
  throw new Error(`staged checksum mismatch for ${hostBinary} (refusing to activate)`)
}
log(`staged checksum ok (${stagedHash.slice(0, 12)}…)`)

const active = path.join(home, "bin", "spinosa")
mkdirSync(path.join(home, "bin"), { recursive: true })
const backup = path.join(stagingDir, `spinosa.backup.${process.pid}`)
if (existsSync(active)) renameSync(active, backup)
try {
  renameSync(stagedBinary, active)
  chmodSync(active, 0o755)
  const probed = Bun.spawnSync([active, "version"], { timeout: 30_000 })
  const out = `${probed.stdout ?? ""}`.trim() + `${probed.stderr ?? ""}`.trim()
  if (probed.exitCode !== 0 || !out.includes(version)) {
    throw new Error(`active binary failed version probe (want ${version}): ${out.slice(0, 200)}`)
  }
  log(`activated ${active} (${version})`)
  rmSync(backup, { force: true })
} catch (err) {
  if (existsSync(backup)) {
    try {
      renameSync(backup, active)
    } catch { /* best effort rollback */ }
  }
  throw err
}

// Shim (install.sh template; version-independent forwarder).
mkdirSync(binDir, { recursive: true })
const shim = path.join(binDir, "spinosa")
if (!existsSync(shim)) {
  writeFileSync(
    shim,
    '#!/bin/sh\n# Managed by Spinosa install.sh\nhome="${SPINOSA_HOME:-$HOME/.spinosa}"\ntarget="$home/bin/spinosa"\nif [ ! -x "$target" ]; then\n  echo "spinosa: installation needs repair" >&2\n  exit 1\nfi\nexec "$target" "$@"\n',
  )
  chmodSync(shim, 0o755)
  log(`created shim ${shim}`)
}

// Metadata: keep last_installed_version in sync on bumps.
const configPath = path.join(home, "metadata", "config.yaml")
try {
  const config = readFileSync(configPath, "utf-8")
  if (!config.includes(`last_installed_version: "${version}"`)) {
    writeFileSync(configPath, config.replace(/^last_installed_version:.*$/m, `last_installed_version: "${version}"`))
    log("metadata last_installed_version updated")
  }
} catch {
  detail("metadata config.yaml untouched (missing?)")
}
rmSync(path.join(stagingDir, "checksums.txt"), { force: true })

// --- 6. Smoke -----------------------------------------------------------------
const smoke = Bun.spawnSync([shim, "version"], { timeout: 30_000 })
const smokeOut = `${smoke.stdout ?? ""}`.trim()
if (smoke.exitCode !== 0) throw new Error(`post-install smoke failed: ${smokeOut.slice(0, 200)}`)
console.log(`✓ rebuilt + reinstalled: ${smokeOut} (${shim})`)
