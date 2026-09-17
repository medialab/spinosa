import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  symlinkSync,
  unlinkSync,
} from "node:fs"
import { writeFileSync } from "node:fs"
import { copyFile as copyFileAsync, mkdir as mkdirAsync, rm as rmAsync } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import path from "node:path"

import { isCloudStoragePath } from "./path"
import { SpinosaCancellationError } from "../import/cancellation"

const DEFAULT_RETRIES = 3
const CLOUD_TIMEOUT_SEC = 60
const LOCAL_TIMEOUT_SEC = 30
const ASYNC_COPY_ATTEMPT_TIMEOUT_SEC = 3
const ASYNC_COPY_ATTEMPT_TIMEOUT_SEC_CLOUD = 5
const asyncCopyQueues = new Map<string, Promise<void>>()

export { isCloudStoragePath }

export function safeCopyTimeoutSecFor(p: string): number {
  return isCloudStoragePath(p) ? CLOUD_TIMEOUT_SEC : LOCAL_TIMEOUT_SEC
}

function asyncCopyAttemptTimeoutMs(src: string): number {
  return (isCloudStoragePath(src) ? ASYNC_COPY_ATTEMPT_TIMEOUT_SEC_CLOUD : ASYNC_COPY_ATTEMPT_TIMEOUT_SEC) * 1000
}

const MAX_NAME_BYTES = 250
const MAX_PATH_BYTES = 1000

/** Byte length of the `.spinosa-part-<pid>-<uuid>` temp suffix appended during copies. */
function tempSuffixReserveBytes(): number {
  return Buffer.byteLength(`.spinosa-part-${process.pid}-${"0".repeat(36)}`, "utf8")
}

function truncateUtf8ByBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let end = value.length
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > maxBytes) end--
  return end > 0 ? value.slice(0, end) : value.slice(0, 1)
}

// Truncate the longest path component(s) so the destination fits filesystem
// limits (macOS: 255 bytes/component, ~1024 for the full path). Used when a
// copy fails with ENAMETOOLONG so we reprocess under a safe name instead of
// dropping the file. `reserveBytes` keeps room for a temp suffix: the rescue
// copy writes `target + .spinosa-part-<pid>-<uuid>`, so without the reserve
// the temp file itself overflows and the rescue can never succeed.
export function truncateDestPath(dest: string, reserveBytes = 0): string {
  const parsed = path.parse(dest)
  const root = parsed.root
  const ext = parsed.ext
  const stemBudget = Math.max(1, MAX_NAME_BYTES - reserveBytes - Buffer.byteLength(ext, "utf8"))
  const safeStem = truncateUtf8ByBytes(parsed.name, stemBudget)
  const safeBase = safeStem + ext

  let dir = path.dirname(dest)
  let candidate = path.join(dir, safeBase)
  if (Buffer.byteLength(candidate, "utf8") <= MAX_PATH_BYTES) return candidate

  const relParts = root ? dir.slice(root.length).split(path.sep).filter(Boolean) : dir.split(path.sep).filter(Boolean)
  const parts = [...relParts]
  while (parts.length > 0 && Buffer.byteLength(path.join(root, ...parts, safeBase), "utf8") > MAX_PATH_BYTES) {
    const longest = parts.reduce(
      (maxIndex, part, index, all) => (Buffer.byteLength(part, "utf8") > Buffer.byteLength(all[maxIndex]!, "utf8") ? index : maxIndex),
      0,
    )
    const shortened = truncateUtf8ByBytes(parts[longest]!, MAX_NAME_BYTES - 10)
    if (shortened === parts[longest]) break
    parts[longest] = shortened
  }

  dir = root ? path.join(root, ...parts) : parts.join(path.sep)
  candidate = path.join(dir, safeBase)
  if (Buffer.byteLength(candidate, "utf8") <= MAX_PATH_BYTES) return candidate

  const hash = createHash("sha256").update(dest).digest("hex").slice(0, 16)
  const hashBase = truncateUtf8ByBytes(hash, stemBudget) + ext
  candidate = path.join(dir, hashBase)
  if (Buffer.byteLength(candidate, "utf8") <= MAX_PATH_BYTES) return candidate

  return path.join(root || dir, hashBase)
}

export interface SafeCopyOptions {
  retries?: number
  onRetry?: (attempt: number, reason: string) => void
  onRename?: (original: string, renamed: string) => void
  shouldAbort?: () => boolean
  signal?: AbortSignal
}

/** Race a copy against cancellation; cleans up the temp file on abort. */
async function copyAbortable(
  op: Promise<unknown>,
  tmp: string,
  options: SafeCopyOptions | undefined,
): Promise<void> {
  if (!options?.shouldAbort && !options?.signal) {
    await op
    return
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearInterval(timer)
      options?.signal?.removeEventListener("abort", onAbort)
    }
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new SpinosaCancellationError("copy aborted"))
    }
    const onAbort = () => abort()
    const timer = setInterval(() => {
      if (options?.shouldAbort?.() || options?.signal?.aborted) abort()
    }, 200)
    options?.signal?.addEventListener("abort", onAbort, { once: true })
    op.then(
      () => { if (!settled) { settled = true; cleanup(); resolve() } },
      (err) => { if (!settled) { settled = true; cleanup(); reject(err) } },
    )
  }).catch(async (err) => {
    await rmAsync(tmp, { force: true }).catch(() => {})
    throw err
  })
}

export function shouldSkipTemplateCopyEntry(name: string, isDirectory: boolean): boolean {
  if (name === ".DS_Store" || name.startsWith("._")) return true
  if (isDirectory && (name === "node_modules" || name === ".git" || name === "__pycache__")) return true
  return !isDirectory && name.endsWith(".pyc")
}

function safeCopyDelaySec(p: string): number {
  return isCloudStoragePath(p) ? 4 : 2
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function replaceFromTemp(tmp: string, dest: string): void {
  if (existsSync(dest) && statSync(dest).isDirectory()) {
    throw new Error(`Refusing to replace directory with file: ${dest}`)
  }
  const backup = `${dest}.spinosa-backup-${process.pid}-${crypto.randomUUID()}`
  let backedUp = false
  try {
    if (existsSync(dest)) {
      renameSync(dest, backup)
      backedUp = true
    }
    renameSync(tmp, dest)
    if (backedUp) rmSync(backup, { force: true })
  } catch (error) {
    try { unlinkSync(tmp) } catch { /* temp cleanup */ }
    if (backedUp && !existsSync(dest)) {
      try { renameSync(backup, dest) } catch { /* preserve original error */ }
    }
    throw error
  }
}

function copyFileAtomically(src: string, dest: string): boolean {
  const tmp = `${dest}.spinosa-part-${process.pid}-${crypto.randomUUID()}`
  try {
    mkdirSync(path.dirname(dest), { recursive: true })
    copyFileSync(src, tmp)
    replaceFromTemp(tmp, dest)
    return true
  } catch {
    try { unlinkSync(tmp) } catch { /* temp cleanup, ignore */ }
    return false
  }
}

export function safeCopy(src: string, dest: string, options?: SafeCopyOptions): boolean {
  const retries = options?.retries ?? DEFAULT_RETRIES
  let delayMs = safeCopyDelaySec(dest) * 1000
  let lastReason = ""

  mkdirSync(path.dirname(dest), { recursive: true })

  for (let i = 1; i <= retries; i++) {
    if (copyFileAtomically(src, dest)) return true
    lastReason = "atomic copy failed"
    if (i >= retries) break
    options?.onRetry?.(i, lastReason)
    sleepMs(delayMs)
    delayMs *= 2
  }
  return false
}

export function writeTextAtomic(dest: string, content: string): void {
  const tmp = `${dest}.spinosa-part-${process.pid}-${crypto.randomUUID()}`
  mkdirSync(path.dirname(dest), { recursive: true })
  try {
    writeFileSync(tmp, content, "utf-8")
    renameSync(tmp, dest)
  } catch (error) {
    try { unlinkSync(tmp) } catch { /* temp cleanup */ }
    throw error
  }
}

// Like writeTextAtomic but, on ENAMETOOLONG, retries once under a truncated
// destination so converted output never fails purely because a source name is
// too long. Returns the path actually written (truncated if renamed).
export function writeTextAtomicSafe(dest: string, content: string): string {
  try {
    writeTextAtomic(dest, content)
    return dest
  } catch (err) {
    if (String(err).includes("ENAMETOOLONG")) {
      const safe = truncateDestPath(dest, tempSuffixReserveBytes())
      writeTextAtomic(safe, content)
      return safe
    }
    throw err
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

export async function safeCopyAsync(src: string, dest: string, options?: SafeCopyOptions): Promise<boolean> {
  const previous = asyncCopyQueues.get(dest) ?? Promise.resolve()
  const gate = Promise.withResolvers<void>()
  const queued = previous.then(() => gate.promise)
  asyncCopyQueues.set(dest, queued)
  await previous
  try {
  const timeoutMs = asyncCopyAttemptTimeoutMs(src)

  await mkdirAsync(path.dirname(dest), { recursive: true })

  // Single fast attempt: if it can't succeed quickly it goes into the
  // caller's retry bucket (retried later with backoff) rather than blocking
  // the whole import on one slow/hung file.
  let target = dest
  let tmp = `${target}.spinosa-part-${process.pid}-${crypto.randomUUID()}`
  try {
    await copyAbortable(withTimeout(copyFileAsync(src, tmp), timeoutMs, `copy of ${src}`), tmp, options)
    replaceFromTemp(tmp, target)
    return true
  } catch (err) {
    await rmAsync(tmp, { force: true }).catch(() => {})
    if (err instanceof SpinosaCancellationError) throw err
    const reason = String(err)
    // Name too long: truncate the destination and reprocess under a safe name
    // instead of failing/retrying the doomed path. The reserve keeps room
    // for this attempt's temp suffix so the rescue copy itself fits.
    if (reason.includes("ENAMETOOLONG") && target === dest) {
      target = truncateDestPath(dest, tempSuffixReserveBytes())
      tmp = `${target}.spinosa-part-${process.pid}-${crypto.randomUUID()}`
      try {
        await mkdirAsync(path.dirname(target), { recursive: true })
        await copyAbortable(withTimeout(copyFileAsync(src, tmp), timeoutMs, `copy of ${src}`), tmp, options)
        replaceFromTemp(tmp, target)
        // Only report the rename after the truncated copy actually succeeded,
        // so a renamed-then-failed file is not double-counted.
        options?.onRename?.(dest, target)
        return true
      } catch (err2) {
        await rmAsync(tmp, { force: true }).catch(() => {})
        if (err2 instanceof SpinosaCancellationError) throw err2
        options?.onRetry?.(0, String(err2))
        return false
      }
    }
    options?.onRetry?.(0, reason)
    return false
  }
  } finally {
    gate.resolve()
    if (asyncCopyQueues.get(dest) === queued) asyncCopyQueues.delete(dest)
  }
}

export function safeCopyTree(src: string, dest: string): void {
  const srcReal = path.resolve(src)
  mkdirSync(dest, { recursive: true })

  for (const entry of readdirSync(srcReal, { withFileTypes: true })) {
    if (shouldSkipTemplateCopyEntry(entry.name, entry.isDirectory())) continue

    const srcPath = path.join(srcReal, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isSymbolicLink()) {
      const target = readlinkSync(srcPath)
      mkdirSync(path.dirname(destPath), { recursive: true })
      try { unlinkSync(destPath) } catch { /* missing destination */ }
      symlinkSync(target, destPath)
    } else if (entry.isDirectory()) {
      safeCopyTree(srcPath, destPath)
    } else if (entry.isFile()) {
      if (!safeCopy(srcPath, destPath)) {
        throw new Error(`Failed to copy file: ${srcPath}`)
      }
    }
  }
}

function rsyncCopyDirContents(src: string, dest: string): boolean {
  const which = spawnSync("which", ["rsync"], { encoding: "utf-8" })
  if (which.status !== 0) return false
  if (isCloudStoragePath(src) || isCloudStoragePath(dest)) return false

  mkdirSync(dest, { recursive: true })
  const result = spawnSync("rsync", [
    "-a",
    "--exclude",
    ".DS_Store",
    "--exclude",
    "._*",
    "--exclude",
    "node_modules/",
    "--exclude",
    ".git/",
    "--exclude",
    "__pycache__/",
    "--exclude",
    "*.pyc",
    `${src}/`,
    `${dest}/`,
  ])
  return result.status === 0
}

export function copyDirContents(src: string, dest: string): void {
  const srcReal = path.resolve(src)
  mkdirSync(dest, { recursive: true })

  const frameworkRoot = process.env.SPINOSA_FRAMEWORK_ROOT
  if (frameworkRoot) {
    const fwReal = path.resolve(frameworkRoot)
    if (srcReal === fwReal) {
      throw new Error(
        "Refusing to copy framework root as a directory; check workspace-template/.spinosa/workspace-files.tsv for blank or unsafe paths.",
      )
    }
  }

  if (rsyncCopyDirContents(srcReal, dest)) return

  try {
    safeCopyTree(srcReal, dest)
  } catch {
    if (isCloudStoragePath(dest)) {
      throw new Error(
        "Failed to copy directory to cloud storage destination — open the folder in Finder, wait for sync, then retry",
      )
    }
    throw new Error(`Failed to copy directory: ${src}`)
  }
}

export function cleanMacMetadata(dir: string): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      cleanMacMetadata(full)
    } else if (entry.name === ".DS_Store" || entry.name.startsWith("._")) {
      try { rmSync(full, { force: true }) } catch (e) { console.error("spinosa: failed to clean metadata", full, e) }
    }
  }
}

export function fileSizeBytes(filePath: string): number {
  return statSync(filePath).size
}

export function availableDiskBytes(targetPath: string): number {
  const s = statfsSync(targetPath)
  return s.bavail * s.bsize
}
