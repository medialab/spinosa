/**
 * Stage the embedded `@napi-rs/canvas` skia.<triple>.node and point
 * `NAPI_RS_NATIVE_LIBRARY_PATH` at it before any canvas import.
 *
 * Bun --compile on Linux cannot `require("@napi-rs/canvas-linux-*-gnu")` from
 * nested chunks. Doctor's direct ESM import may still succeed while the
 * bundled chunk fails with "Cannot find native binding". Staging a real
 * filesystem path and setting the napi-rs env override makes every load path
 * use the same binding.
 */
import { createHash, randomBytes } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, renameSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { isCompiledBinaryDistribution, spinosaHome } from "@spinosa/core/distribution/bootstrap"
import { CANVAS_NATIVE_BINDING } from "../generated/canvas-native.gen"

export type CanvasNativeBindingFile = {
  name: string
  file: string
}

export type EnsureCanvasNativeBindingOptions = {
  binding?: CanvasNativeBindingFile | null
  spinosaHomeDir?: string
  xdgCacheHome?: string
  tmpDir?: string
  platform?: NodeJS.Platform
  canExec?: (dir: string) => boolean
  /** Force stage directory (skips resolve). */
  stageDir?: string
  env?: NodeJS.ProcessEnv
}

function xdgCacheHome(override?: string): string {
  if (override) return override
  const env = process.env.XDG_CACHE_HOME?.trim()
  if (env) return env
  return path.join(homedir(), ".cache")
}

/** Probe whether `dir` is writable and allows executing a file (not noexec). */
export function directoryAllowsWriteAndExec(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.spinosa-exec-probe-${process.pid}-${Date.now()}`)
    try {
      writeFileSync(probe, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
      const result = spawnSync(probe, [], { stdio: "ignore", timeout: 3000 })
      return result.status === 0
    } finally {
      try {
        rmSync(probe, { force: true })
      } catch {
        /* ignore */
      }
    }
  } catch {
    return false
  }
}

export type NativeStageDirOptions = {
  spinosaHomeDir?: string
  xdgCacheHome?: string
  tmpDir?: string
  /** Override platform ordering (tests). Default = `process.platform`. */
  platform?: NodeJS.Platform
  /** Override exec probe (tests). Default writes+runs a tiny script in `dir`. */
  canExec?: (dir: string) => boolean
}

/**
 * Resolve where the staged canvas binding should be written.
 *
 * - Linux: prefer `$SPINOSA_HOME/cache/canvas-native`, then XDG
 *   `…/spinosa/canvas-native`, then `os.tmpdir()`.
 * - Darwin: prefer `os.tmpdir()` first so `@rpath` stays adjacent to Bun's
 *   extracted `.node`, then home/XDG.
 *
 * Always returns a path (last resort = tmpdir).
 */
export function resolveNativeStageDir(options: NativeStageDirOptions = {}): string {
  const home = options.spinosaHomeDir ?? spinosaHome()
  const cache = xdgCacheHome(options.xdgCacheHome)
  const tmp = options.tmpDir ?? tmpdir()
  const canExec = options.canExec ?? directoryAllowsWriteAndExec
  const platformName = options.platform ?? process.platform

  const homeCache = path.join(home, "cache", "canvas-native")
  const xdgSpinosa = path.join(cache, "spinosa", "canvas-native")
  const candidates =
    platformName === "darwin" ? [tmp, homeCache, xdgSpinosa] : [homeCache, xdgSpinosa, tmp]

  for (const dir of candidates) {
    if (canExec(dir)) return dir
  }
  return tmp
}

function readEmbeddedBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(file))
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** Reject symlinks: never follow arbitrary links when staging natives. */
function assertNotSymlink(p: string): void {
  try {
    if (lstatSync(p).isSymbolicLink()) {
      throw new Error(`refusing to stage through symlink: ${p}`)
    }
  } catch (err) {
    if ((err as Error).message.startsWith("refusing to stage through symlink")) throw err
    // Missing file is fine (fresh stage).
  }
}

function stageOne(dest: string, bytes: Uint8Array): "staged" | "skipped" {
  assertNotSymlink(dest)
  if (existsSync(dest)) {
    try {
      assertNotSymlink(dest)
      const existing = readFileSync(dest)
      // Digest verification — never trust matching byte length alone.
      if (sha256Bytes(new Uint8Array(existing)) === sha256Bytes(bytes)) return "skipped"
    } catch (err) {
      if ((err as Error).message.startsWith("refusing to stage through symlink")) throw err
    }
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  // Atomic staging: write to a private temp file, verify, chmod, rename.
  const tmp = `${dest}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`
  try {
    writeFileSync(tmp, bytes, { mode: 0o755 })
    const written = new Uint8Array(readFileSync(tmp))
    if (sha256Bytes(written) !== sha256Bytes(bytes)) {
      throw new Error(`staged bytes failed digest verification: ${dest}`)
    }
    chmodSync(tmp, 0o755)
    renameSync(tmp, dest)
  } finally {
    try { rmSync(tmp, { force: true }) } catch {}
  }
  return "staged"
}

/**
 * Prefer `$SPINOSA_HOME/cache/canvas-native` (exec-capable), else the shared
 * native stage ordering (Linux: home → XDG → tmp; Darwin: tmp first).
 */
export function resolveCanvasNativeStageDir(
  options: Pick<
    EnsureCanvasNativeBindingOptions,
    "spinosaHomeDir" | "xdgCacheHome" | "tmpDir" | "platform" | "canExec"
  > = {},
): string {
  const home = options.spinosaHomeDir ?? spinosaHome()
  const preferred = path.join(home, "cache", "canvas-native")
  const canExec = options.canExec ?? directoryAllowsWriteAndExec
  if (canExec(preferred)) return preferred
  return resolveNativeStageDir({
    ...options,
    spinosaHomeDir: home,
  })
}

/** Idempotent: write embedded skia .node and set NAPI_RS_NATIVE_LIBRARY_PATH. */
export function ensureCanvasNativeBinding(
  options: EnsureCanvasNativeBindingOptions = {},
): { staged: string | null; skipped: boolean; stageDir: string; nativePath: string | null } {
  const binding = options.binding === undefined ? CANVAS_NATIVE_BINDING : options.binding
  const env = options.env ?? process.env
  if (!binding?.name || !binding?.file) {
    if (isCompiledBinaryDistribution()) {
      console.error(
        "[spinosa] canvas native binding was not embedded in this binary; OCR/@napi-rs/canvas may fail on Linux",
      )
    }
    return {
      staged: null,
      skipped: true,
      stageDir: options.stageDir ?? options.tmpDir ?? tmpdir(),
      nativePath: env.NAPI_RS_NATIVE_LIBRARY_PATH ?? null,
    }
  }

  const stageDir = options.stageDir ?? resolveCanvasNativeStageDir(options)
  const dest = path.join(stageDir, binding.name)
  try {
    const bytes = readEmbeddedBytes(binding.file)
    if (bytes.byteLength < 1024) {
      throw new Error(`embedded ${binding.name} is too small (${bytes.byteLength} bytes)`)
    }
    const result = stageOne(dest, bytes)
    // Always point napi-rs at the staged path so nested require() paths work.
    env.NAPI_RS_NATIVE_LIBRARY_PATH = dest
    return {
      staged: result === "staged" ? dest : null,
      skipped: result === "skipped",
      stageDir,
      nativePath: dest,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[spinosa] failed to stage canvas native binding ${binding.name}: ${detail}`)
    return {
      staged: null,
      skipped: false,
      stageDir,
      nativePath: env.NAPI_RS_NATIVE_LIBRARY_PATH ?? null,
    }
  }
}
