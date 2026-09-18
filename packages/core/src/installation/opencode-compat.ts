import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import semver from "semver"
import { productHomeDir } from "../util/user-dirs"
import { OpenCodeCompatVersion } from "./version"

/** Console free-tier currently requires this OpenCode User-Agent floor. */
export const OPENCODE_CONSOLE_MIN_VERSION = "1.18.0"

export const OPENCODE_COMPAT_ENV = "SPINOSA_OPENCODE_COMPAT_VERSION"

export const OPENCODE_AI_NPM_LATEST = "https://registry.npmjs.org/opencode-ai/latest"

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5_000

type CompatCache = {
  timestamp: number
  version: string
}

let memo: string | undefined

function metadataDir(): string {
  return process.env.SPINOSA_METADATA_DIR ?? path.join(productHomeDir(), "metadata")
}

function cachePath(): string {
  return path.join(metadataDir(), "opencode_compat_version.json")
}

export function parseOpenCodeVersion(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^v/i, "")
  if (!normalized || normalized === "local") return undefined
  return semver.valid(normalized) ?? undefined
}

export function maxOpenCodeVersion(versions: Array<string | undefined>): string {
  let best = OPENCODE_CONSOLE_MIN_VERSION
  for (const raw of versions) {
    const version = parseOpenCodeVersion(raw)
    if (version && semver.gt(version, best)) best = version
  }
  return best
}

export function readOpenCodeCompatCache(): CompatCache | undefined {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf-8")) as Partial<CompatCache>
    const version = parseOpenCodeVersion(parsed.version)
    if (!version || typeof parsed.timestamp !== "number") return undefined
    return { timestamp: parsed.timestamp, version }
  } catch {
    return undefined
  }
}

export function writeOpenCodeCompatCache(version: string, timestamp = Date.now()): void {
  const parsed = parseOpenCodeVersion(version)
  if (!parsed) return
  mkdirSync(metadataDir(), { recursive: true, mode: 0o700 })
  writeFileSync(cachePath(), `${JSON.stringify({ timestamp, version: parsed })}\n`, { mode: 0o600 })
}

export function resetAdvertisedOpenCodeVersionForTests(): void {
  memo = undefined
}

export function applyAdvertisedOpenCodeVersion(version: string): string {
  const resolved = maxOpenCodeVersion([OPENCODE_CONSOLE_MIN_VERSION, OpenCodeCompatVersion, version])
  memo = resolved
  process.env[OPENCODE_COMPAT_ENV] = resolved
  return resolved
}

/** User-Agent semver sent to OpenCode Console. Always >= OPENCODE_CONSOLE_MIN_VERSION. */
export function advertisedOpenCodeVersion(): string {
  if (memo) return memo
  const resolved = maxOpenCodeVersion([
    OPENCODE_CONSOLE_MIN_VERSION,
    OpenCodeCompatVersion,
    process.env[OPENCODE_COMPAT_ENV],
    readOpenCodeCompatCache()?.version,
  ])
  memo = resolved
  return resolved
}

export function openCodeUserAgent(): string {
  return `opencode/${advertisedOpenCodeVersion()}`
}

const CONSOLE_MIN_VERSION_RE = /OpenCode\s+v?(\d+\.\d+\.\d+)\s+or newer is required/i

/** Parse Console's free-tier floor from an error body or toast. */
export function parseOpenCodeConsoleRequirement(text: string | undefined): string | undefined {
  if (!text) return undefined
  return parseOpenCodeVersion(text.match(CONSOLE_MIN_VERSION_RE)?.[1])
}

/**
 * Raise the advertised User-Agent to Console's required floor and persist it.
 * Returns adopted:false when we already send that version or higher.
 */
export function adoptOpenCodeConsoleRequirement(required: string): { version: string; adopted: boolean } {
  const parsed = parseOpenCodeVersion(required)
  if (!parsed) return { version: advertisedOpenCodeVersion(), adopted: false }
  const current = advertisedOpenCodeVersion()
  if (!semver.lt(current, parsed)) return { version: current, adopted: false }
  const version = applyAdvertisedOpenCodeVersion(parsed)
  writeOpenCodeCompatCache(version)
  return { version, adopted: true }
}

export async function fetchLatestOpenCodeAiVersion(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(OPENCODE_AI_NPM_LATEST, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return undefined
    const body = (await response.json()) as { version?: string }
    return parseOpenCodeVersion(body.version)
  } catch {
    return undefined
  }
}

export async function syncOpenCodeCompatVersion(input: {
  fetchLatest?: () => Promise<string | undefined>
  now?: number
} = {}): Promise<{ version: string; source: "cache" | "npm" | "min" }> {
  const now = input.now ?? Date.now()
  const cached = readOpenCodeCompatCache()
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    const version = applyAdvertisedOpenCodeVersion(cached.version)
    return { version, source: "cache" }
  }

  const latest = await (input.fetchLatest ?? fetchLatestOpenCodeAiVersion)()
  const version = applyAdvertisedOpenCodeVersion(
    maxOpenCodeVersion([OPENCODE_CONSOLE_MIN_VERSION, OpenCodeCompatVersion, latest, cached?.version]),
  )
  writeOpenCodeCompatCache(version, now)
  return { version, source: latest ? "npm" : cached ? "cache" : "min" }
}

export function openCodeCompatCacheExists(): boolean {
  return existsSync(cachePath())
}
