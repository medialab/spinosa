/**
 * Stage onnxruntime companion shared libraries before any
 * `onnxruntime_binding.node` dlopen.
 *
 * Bun --compile extracts the `.node` addon into the process temp dir as a hashed
 * `.<id>.node`; the loader resolves `@rpath` / `$ORIGIN` libs next to that
 * extraction (tmpdir root). Staging into tmpdir therefore preserves adjacency.
 *
 * On Linux hosts where `/tmp` (or TMPDIR) is mounted `noexec`, staging `.so`
 * next to the extract can still fail PROT_EXEC. Prefer a writable+executable
 * directory under `$SPINOSA_HOME/cache/onnx-runtime` (then XDG cache), and
 * prepend that directory to `LD_LIBRARY_PATH` so the dynamic linker finds
 * companion libs even when they are not `$ORIGIN`-adjacent. Darwin keeps
 * tmpdir-first for `@rpath` adjacency (SIP may strip `DYLD_LIBRARY_PATH`) and
 * still prepends the stage dir as a belt-and-suspenders. Fall back through the
 * candidate list when preferred locations are unusable.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { isCompiledBinaryDistribution, spinosaHome } from "@spinosa/core/distribution/bootstrap"
import { isOcrPlatformSupported } from "@spinosa/core/tools/ocr-support"
import { ONNX_SHARED_LIB_FILES } from "../generated/onnx-native.gen"

export type OnnxSharedLibFile = {
  name: string
  file: string
}

export type OnnxStageDirOptions = {
  spinosaHomeDir?: string
  xdgCacheHome?: string
  tmpDir?: string
  /** Override platform ordering (tests). Default = `process.platform`. */
  platform?: NodeJS.Platform
  /** Override exec probe (tests). Default writes+runs a tiny script in `dir`. */
  canExec?: (dir: string) => boolean
}

function readEmbeddedBytes(file: string): Uint8Array {
  // Compiled binaries expose `with { type: "file" }` paths under /$bunfs; Bun's
  // readFileSync materializes them. Dev/source uses real filesystem paths.
  return new Uint8Array(readFileSync(file))
}

function stageOne(dest: string, bytes: Uint8Array): "staged" | "skipped" {
  if (existsSync(dest)) {
    const existing = statSync(dest)
    if (existing.size === bytes.byteLength) return "skipped"
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, bytes)
  return "staged"
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
    const probe = path.join(dir, `.spinosa-onnx-exec-probe-${process.pid}-${Date.now()}`)
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

/**
 * Resolve where companion libs should be written.
 *
 * - Linux: prefer `$SPINOSA_HOME/cache/onnx-runtime`, then XDG
 *   `…/spinosa/onnx-runtime`, then `os.tmpdir()` (Lima/`noexec` tmp).
 * - Darwin: prefer `os.tmpdir()` first so `@rpath` stays adjacent to Bun’s
 *   extracted `.node` (SIP may strip `DYLD_LIBRARY_PATH`), then home/XDG.
 *
 * Always returns a path (last resort = tmpdir).
 */
export function resolveOnnxRuntimeStageDir(options: OnnxStageDirOptions = {}): string {
  const home = options.spinosaHomeDir ?? spinosaHome()
  const cache = xdgCacheHome(options.xdgCacheHome)
  const tmp = options.tmpDir ?? tmpdir()
  const canExec = options.canExec ?? directoryAllowsWriteAndExec
  const platformName = options.platform ?? process.platform

  const homeCache = path.join(home, "cache", "onnx-runtime")
  const xdgSpinosa = path.join(cache, "spinosa", "onnx-runtime")
  const candidates =
    platformName === "darwin" ? [tmp, homeCache, xdgSpinosa] : [homeCache, xdgSpinosa, tmp]

  for (const dir of candidates) {
    if (canExec(dir)) return dir
  }
  return tmp
}

/** Prepend stage dir to the platform library path so non-$ORIGIN staging still loads. */
export function prependOnnxLibraryPath(
  stageDir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  const key = platform === "darwin" ? "DYLD_LIBRARY_PATH" : platform === "linux" ? "LD_LIBRARY_PATH" : null
  if (!key) return
  const parts = (env[key] ?? "").split(path.delimiter).filter(Boolean)
  if (parts.includes(stageDir)) return
  env[key] = parts.length ? `${stageDir}${path.delimiter}${parts.join(path.delimiter)}` : stageDir
}

/**
 * Marker set on the one-shot Linux re-exec so we do not loop.
 * glibc reads `LD_LIBRARY_PATH` only at process start — mutating `process.env`
 * after launch does not make `libonnxruntime.so.1` visible to dlopen.
 */
export const SPINOSA_NATIVE_LIBS_READY = "SPINOSA_NATIVE_LIBS_READY"

export type LinuxNativeReexecDecision = {
  hasEmbeddedLibs: boolean
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

/** True when this Linux boot must re-exec with an inherited library path. */
export function shouldReexecLinuxForNativeLibs(options: LinuxNativeReexecDecision): boolean {
  const platform = options.platform ?? process.platform
  if (platform !== "linux") return false
  if (!options.hasEmbeddedLibs) return false
  const env = options.env ?? process.env
  return env[SPINOSA_NATIVE_LIBS_READY] !== "1"
}

/** Child env for the Linux native-lib re-exec (LD_LIBRARY_PATH + ready marker). */
export function prepareLinuxNativeReexecEnv(
  stageDir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env }
  prependOnnxLibraryPath(stageDir, next, platform)
  next[SPINOSA_NATIVE_LIBS_READY] = "1"
  return next
}

export type LinuxNativeReexecOptions = LinuxNativeReexecDecision & {
  stageDir: string
  execPath?: string
  argv?: readonly string[]
  /** Injected for tests. Default: spawnSync + process.exit. */
  reexec?: (execPath: string, argv: string[], env: NodeJS.ProcessEnv) => void
}

/**
 * User argv to forward on Linux native-lib re-exec.
 *
 * Bun `--compile` places `/$bunfs/root/...` at `process.argv[1]`. Re-passing that
 * path makes Bun inject another bunfs entry and treat the first as a user arg
 * (hideBin then sees `"/$bunfs/root/src/index.js version"` → help / wrong command).
 * Forward only real user args (same cut as yargs `hideBin` → `slice(2)`).
 */
export function nativeReexecUserArgv(argv: readonly string[] = process.argv): string[] {
  if (typeof argv[1] === "string" && argv[1].includes("/$bunfs/")) {
    return [...argv].slice(2)
  }
  // Non-bunfs binaries: [exec, ...userArgs]
  return [...argv].slice(1)
}

/**
 * On Linux binary boots, stage companion libs then re-exec once so glibc sees
 * `LD_LIBRARY_PATH` (and any `NAPI_RS_NATIVE_LIBRARY_PATH` already set on env).
 * No-op on Darwin, when libs were not embedded, or when already re-exec'd.
 */
export function reexecLinuxForNativeLibsIfNeeded(options: LinuxNativeReexecOptions): void {
  if (!shouldReexecLinuxForNativeLibs(options)) return
  const platform = options.platform ?? process.platform
  const env = prepareLinuxNativeReexecEnv(options.stageDir, options.env ?? process.env, platform)
  const execPath = options.execPath ?? process.execPath
  const argv = options.argv ? nativeReexecUserArgv(options.argv) : nativeReexecUserArgv()
  if (options.reexec) {
    options.reexec(execPath, argv, env)
    return
  }
  const result = spawnSync(execPath, argv, { env, stdio: "inherit" })
  if (result.signal) {
    try {
      process.kill(process.pid, result.signal)
    } catch {
      process.exit(1)
    }
    return
  }
  process.exit(result.status ?? 1)
}

export type EnsureOnnxRuntimeSharedLibsOptions = OnnxStageDirOptions & {
  files?: readonly OnnxSharedLibFile[]
  /** Force stage directory (skips resolve). */
  stageDir?: string
  env?: NodeJS.ProcessEnv
}

/** Idempotent: write each embedded shared lib into the resolved stage dir when missing/stale. */
export function ensureOnnxRuntimeSharedLibs(
  filesOrOptions: readonly OnnxSharedLibFile[] | EnsureOnnxRuntimeSharedLibsOptions = ONNX_SHARED_LIB_FILES,
): { staged: string[]; skipped: string[]; stageDir: string } {
  const options: EnsureOnnxRuntimeSharedLibsOptions = Array.isArray(filesOrOptions)
    ? { files: filesOrOptions }
    : (filesOrOptions as EnsureOnnxRuntimeSharedLibsOptions)
  const files = options.files ?? ONNX_SHARED_LIB_FILES
  const staged: string[] = []
  const skipped: string[] = []
  if (!files.length) {
    // ONNX/ppu-paddle-ocr removed — tesseract is sole OCR engine, no companion libs needed.
    return { staged, skipped, stageDir: options.stageDir ?? options.tmpDir ?? tmpdir() }
  }

  const destDir = options.stageDir ?? resolveOnnxRuntimeStageDir(options)
  const env = options.env ?? process.env
  // Always advertise the stage dir to the dynamic linker. Required when staging
  // off tmpdir (no $ORIGIN adjacency to Bun's extracted `.node`); harmless when
  // staging into tmpdir alongside that extract. On Linux binary boots this alone
  // is not enough (glibc ignores in-process LD_LIBRARY_PATH) — see re-exec.
  prependOnnxLibraryPath(destDir, env, options.platform ?? process.platform)

  // Bun extracts onnxruntime_binding.node into os.tmpdir() as `.<hash>.node` and
  // the loader resolves companion libs via $ORIGIN (that tmpdir). LD_LIBRARY_PATH
  // set in-process is ignored by glibc for this dlopen path — so when the primary
  // stage dir is not tmpdir (Linux home/XDG preference for noexec /tmp), also
  // mirror libs into tmpdir for $ORIGIN adjacency.
  const originDir = options.tmpDir ?? tmpdir()
  const mirrorOrigin = path.resolve(originDir) !== path.resolve(destDir)

  for (const entry of files) {
    if (!entry?.name || !entry?.file) continue
    const dest = path.join(destDir, entry.name)
    try {
      const bytes = readEmbeddedBytes(entry.file)
      if (bytes.byteLength < 1024) {
        throw new Error(`embedded ${entry.name} is too small (${bytes.byteLength} bytes)`)
      }
      const result = stageOne(dest, bytes)
      if (result === "staged") staged.push(dest)
      else skipped.push(dest)
      if (mirrorOrigin) {
        try {
          stageOne(path.join(originDir, entry.name), bytes)
        } catch {
          /* fail open: primary stage + LD_LIBRARY_PATH may still work on some hosts */
        }
      }
    } catch (error) {
      // Fail open at runtime: version/doctor should still run if OCR natives are
      // absent; OCR feature paths will surface the original dlopen error.
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`[spinosa] failed to stage onnxruntime lib ${entry.name}: ${detail}`)
    }
  }
  return { staged, skipped, stageDir: destDir }
}
