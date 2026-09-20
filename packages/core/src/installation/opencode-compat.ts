import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import semver from "semver"
import { productHomeDir } from "../util/user-dirs"
import { OpenCodeCompatVersion } from "./version"

/** Console free-tier currently requires this OpenCode User-Agent floor. */
export const OPENCODE_CONSOLE_MIN_VERSION = "1.18.0"

export const OPENCODE_COMPAT_ENV = "SPINOSA_OPENCODE_COMPAT_VERSION"

export const OPENCODE_CONSOLE_TRACE_ENV = "SPINOSA_CONSOLE_HTTP_TRACE"

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

export function isOpenCodeProviderID(providerID: string): boolean {
  return providerID.startsWith("opencode")
}

export function openCodeClientName(): string {
  return process.env.SPINOSA_CLIENT?.trim() || process.env.OPENCODE_CLIENT?.trim() || "cli"
}

export function isOpenCodeConsoleUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname
    return host === "console.opencode.ai" || host.endsWith(".console.opencode.ai")
  } catch {
    return false
  }
}

/** Identity headers Console uses to treat a request as coming from OpenCode. */
export function openCodeConsoleHeaders(input: {
  sessionID: string
  requestID: string
  client?: string
  projectID?: string
}): Record<string, string> {
  return {
    ...(input.projectID ? { "x-opencode-project": input.projectID } : {}),
    "x-opencode-session": input.sessionID,
    "x-opencode-request": input.requestID,
    "x-opencode-client": input.client ?? openCodeClientName(),
    "User-Agent": openCodeUserAgent(),
  }
}

/** HTTP overlay for native/@spinosa/llm Console calls (compact and chat). */
export function openCodeConsoleHttp(
  providerID: string,
  identity: {
    sessionID: string
    requestID: string
    client?: string
    projectID?: string
  },
  existing?: { headers?: Record<string, string> },
): { headers: Record<string, string> } | undefined {
  if (!isOpenCodeProviderID(providerID)) {
    return existing?.headers ? { headers: existing.headers } : undefined
  }
  return {
    headers: {
      ...existing?.headers,
      ...openCodeConsoleHeaders(identity),
      "User-Agent": openCodeUserAgent(),
    },
  }
}

function headerEntries(headers: RequestInit["headers"] | undefined): Iterable<[string, string]> {
  if (!headers) return []
  if (headers instanceof Headers) return headers.entries()
  if (Array.isArray(headers)) {
    return headers.filter((entry): entry is [string, string] => typeof entry[1] === "string")
  }
  return Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")
}

/**
 * Console free-tier accepts OpenCode's on-wire User-Agent. The official client
 * sets `opencode/<semver>` and the AI SDK then appends
 * `ai-sdk/… runtime/bun/…`. Do not strip that suffix. Replace only Bun,
 * Spinosa, or empty User-Agents.
 */
export function pinOpenCodeConsoleUserAgent(existing: string | null | undefined): string {
  const official = openCodeUserAgent()
  const current = existing?.trim() ?? ""
  if (!current) return official
  if (/\bopencode\//i.test(current)) return current
  if (/ai-sdk\/|runtime\//i.test(current)) return `${official} ${current}`
  return official
}

/** Merge Request + init headers, then pin Console's User-Agent last so Bun/SDK defaults cannot win. */
export function applyOpenCodeConsoleUserAgent(input: Request | string | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  for (const [key, value] of headerEntries(init?.headers)) headers.set(key, value)
  headers.set("User-Agent", pinOpenCodeConsoleUserAgent(headers.get("User-Agent")))
  return headers
}

export type FetchLike = (input: Request | string | URL, init?: RequestInit) => Promise<Response>

export type OpenCodeConsoleRequestFingerprint = {
  url: string
  method: string
  headers: Record<string, string>
  contentLength: number
  body?: {
    model?: string
    stream?: boolean
    messageCount?: number
    messageRoles?: string[]
    toolCount?: number
  }
}

export function asFetch(fn: FetchLike): typeof fetch {
  return Object.assign(fn, { preconnect: fetch.preconnect?.bind(fetch) }) as typeof fetch
}

/**
 * Bake Console's User-Agent onto the Request object. Bun/fetch ignores init
 * User-Agent when the first argument is already a Request.
 */
export function openCodeConsoleRequest(input: Request | string | URL, init?: RequestInit): Request {
  const headers = applyOpenCodeConsoleUserAgent(input, init)
  const request =
    input instanceof Request ? new Request(input, { ...init, headers }) : new Request(String(input), { ...init, headers })
  request.headers.set("User-Agent", pinOpenCodeConsoleUserAgent(request.headers.get("User-Agent")))
  return request
}

/** Credential-safe request metadata captured at the final fetch boundary. */
export async function openCodeConsoleRequestFingerprint(
  request: Request,
): Promise<OpenCodeConsoleRequestFingerprint> {
  const headers: Record<string, string> = {}
  for (const [name, value] of request.headers) {
    const key = name.toLowerCase()
    if (key === "authorization" || key === "cookie" || key === "proxy-authorization") continue
    if (key === "user-agent" || key === "content-length" || key.startsWith("x-opencode-")) headers[key] = value
  }

  let bytes = new Uint8Array()
  try {
    bytes = new Uint8Array(await request.clone().arrayBuffer())
  } catch {
    // A locked streaming body still leaves the headers useful.
  }

  let body: OpenCodeConsoleRequestFingerprint["body"]
  if (bytes.byteLength > 0) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
      const messages = Array.isArray(parsed.messages) ? parsed.messages : undefined
      const tools = Array.isArray(parsed.tools) ? parsed.tools : undefined
      body = {
        ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
        ...(typeof parsed.stream === "boolean" ? { stream: parsed.stream } : {}),
        ...(messages
          ? {
              messageCount: messages.length,
              messageRoles: messages.map((message) =>
                typeof message === "object" && message !== null && typeof (message as { role?: unknown }).role === "string"
                  ? String((message as { role: string }).role)
                  : "unknown",
              ),
            }
          : {}),
        ...(tools ? { toolCount: tools.length } : {}),
      }
    } catch {
      // Never persist prompt text or other opaque request bodies.
    }
  }

  return {
    url: request.url,
    method: request.method,
    headers,
    contentLength: bytes.byteLength,
    ...(body ? { body } : {}),
  }
}

async function traceOpenCodeConsoleRequest(request: Request, send: () => Promise<Response>): Promise<Response> {
  const tracePath = process.env[OPENCODE_CONSOLE_TRACE_ENV]?.trim()
  if (!tracePath) return send()

  const startedAt = Date.now()
  let fingerprint: OpenCodeConsoleRequestFingerprint | undefined
  try {
    fingerprint = await openCodeConsoleRequestFingerprint(request)
  } catch {
    // Diagnostics must never interfere with inference.
  }

  try {
    const response = await send()
    try {
      appendFileSync(
        tracePath,
        `${JSON.stringify({ timestamp: new Date().toISOString(), elapsedMs: Date.now() - startedAt, status: response.status, ...fingerprint })}\n`,
        { mode: 0o600 },
      )
    } catch {
      // Diagnostics must never interfere with inference.
    }
    return response
  } catch (error) {
    try {
      appendFileSync(
        tracePath,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          transportError: error instanceof Error ? error.name : "unknown",
          ...fingerprint,
        })}\n`,
        { mode: 0o600 },
      )
    } catch {
      // Diagnostics must never interfere with inference.
    }
    throw error
  }
}

export async function fetchOpenCodeConsole(
  input: Request | string | URL,
  init?: RequestInit,
  base: FetchLike = fetch,
): Promise<Response> {
  const request = openCodeConsoleRequest(input, init)
  return traceOpenCodeConsoleRequest(request, () => base(request, { ...init, headers: request.headers }))
}

export function fetchOpenCodeConsoleByUrl(
  input: Request | string | URL,
  init?: RequestInit,
  base: FetchLike = fetch,
): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input)
  if (!isOpenCodeConsoleUrl(url)) return base(input, init)
  return fetchOpenCodeConsole(input, init, base)
}

export const openCodeConsoleFetch: typeof fetch = asFetch((input, init) => fetchOpenCodeConsoleByUrl(input, init))

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
