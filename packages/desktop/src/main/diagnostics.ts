import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const SENSITIVE_KEY =
  /(authorization|cookie|password|secret|token|api[_-]?key|provider[_-]?key|credential|prompt|body|content|sourceText)/i
const SENSITIVE_ASSIGNMENT =
  /((?:authorization|cookie|password|secret|token|api[_-]?key|provider[_-]?key|credential)["']?\s*[:=]\s*["']?)(?!(?:Basic|Bearer)\b)[^\s,}"']+/gi
const AUTH_SCHEME = /\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi
const KEY_MATERIAL =
  /\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]+|gh[pousr]_[A-Za-z0-9]+|AIza[A-Za-z0-9_-]{10,}|AKIA[A-Z0-9]{10,})\b/g
const URL_PATTERN = /https?:\/\/[^\s"'`]+/gi
const MAX_TEXT_LENGTH = 12_000
const MAX_ARRAY_LENGTH = 100
const MAX_ERROR_DEPTH = 8

export type SidecarLaunchDiagnostics = {
  launchID: string
  runtime: "packaged" | "development"
  packaged: boolean
  cwd: string
  appPath: string
  resourcesPath: string
  userDataPath: string
  bun: {
    path: string
    source: string
    file: ReturnType<typeof describeDiagnosticFile>
  }
  sidecarScript: {
    path: string
    file: ReturnType<typeof describeDiagnosticFile>
  }
  framework: {
    developmentRoot: string | null
    templateRoot: string | null
    frameworkRoot: string | null
    marker: string | null
  }
}

function describeDiagnosticFile(file: string) {
  try {
    const info = statSync(file)
    return {
      exists: true,
      type: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
      executable:
        process.platform === "win32" ? true : (info.mode & 0o111) !== 0,
    }
  } catch {
    return { exists: false, type: "missing", executable: false }
  }
}

export function describeSidecarLaunch(input: {
  launchID: string
  packaged: boolean
  cwd: string
  appPath: string
  resourcesPath: string
  userDataPath: string
  bunBin: string
  bunSource: string
  sidecarScript: string
  env: NodeJS.ProcessEnv
  developmentRoot?: string
}): SidecarLaunchDiagnostics {
  const marker = [
    "workspace-template/.spinosa/workspace-files.tsv",
    ".spinosa/workspace-files.tsv",
    "framework/spinosa/framework-files.tsv",
  ].find((candidate) => existsSync(path.join(input.appPath, candidate)))
  return {
    launchID: input.launchID,
    runtime: input.packaged ? "packaged" : "development",
    packaged: input.packaged,
    cwd: input.cwd,
    appPath: input.appPath,
    resourcesPath: input.resourcesPath,
    userDataPath: input.userDataPath,
    bun: {
      path: input.bunBin,
      source: input.bunSource,
      file: describeDiagnosticFile(input.bunBin),
    },
    sidecarScript: {
      path: input.sidecarScript,
      file: describeDiagnosticFile(input.sidecarScript),
    },
    framework: {
      developmentRoot: input.developmentRoot ?? null,
      templateRoot: input.env.SPINOSA_TEMPLATE_ROOT
        ? input.env.SPINOSA_TEMPLATE_ROOT
        : null,
      frameworkRoot: input.env.SPINOSA_FRAMEWORK_ROOT
        ? input.env.SPINOSA_FRAMEWORK_ROOT
        : null,
      marker: marker ?? null,
    },
  }
}

export function desktopServerLogRoots(input: {
  userDataPath: string
  xdgDataHome?: string
  productHome: string
}) {
  const xdgData = input.xdgDataHome || path.join(homedir(), ".local", "share")
  return [
    ...new Set([
      path.join(input.productHome, "logs"),
      path.join(xdgData, "opencode", "log"),
      path.join(input.userDataPath, "opencode", "log"),
    ]),
  ]
}

function bounded(value: string) {
  if (value.length <= MAX_TEXT_LENGTH) return value
  return `${value.slice(0, MAX_TEXT_LENGTH)}… (${value.length - MAX_TEXT_LENGTH} more characters)`
}

function scrubText(value: string, redactPaths: boolean) {
  let text = value
  const home = homedir()
  const spinosaHome = process.env.SPINOSA_HOME
  if (spinosaHome) text = text.split(spinosaHome).join("$SPINOSA_HOME")
  if (home) {
    text = text.split(home).join("~")
    const stripped = home.replace(/^\/+/, "")
    if (stripped && stripped !== home) text = text.split(stripped).join("~")
  }
  text = text.replace(URL_PATTERN, (url) => {
    try {
      const parsed = new URL(url)
      parsed.username = ""
      parsed.password = ""
      parsed.search = ""
      parsed.hash = ""
      return parsed.toString().replace(/\/$/, "")
    } catch {
      return "$URL"
    }
  })
  text = text.replace(/file:\/\/[^\s"'`)\]},;]+/gi, (url) => {
    const raw = url.slice("file://".length)
    return redactPaths ? "$PATH" : path.isAbsolute(raw) ? raw : "$PATH"
  })
  text = text.replace(AUTH_SCHEME, "$1 [REDACTED]")
  text = text.replace(SENSITIVE_ASSIGNMENT, "$1[REDACTED]")
  text = text.replace(KEY_MATERIAL, "[REDACTED]")
  if (redactPaths) {
    text = text.replace(
      /(^|[\s="'`(\[{<,;])((?:[A-Za-z]:)?(?:\/|\\)[^\s"'`)\]},;]+|~\/[^\s"'`)\]},;]+)/g,
      "$1$PATH",
    )
    text = text.replace(
      /\b(workspacePath|sourcePath|corpusPath|frameworkRoot|directory|workdir|cwd|worktree|destDir|relPath|filepath|filename|path)=([^\s,)}\]]+)/gi,
      "$1=$PATH",
    )
  }
  return bounded(text)
}

export function sanitizeDiagnosticText(value: string) {
  return scrubText(value, false)
}

export function sanitizeDiagnosticExportText(value: string) {
  return scrubText(value, true)
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error))
}

export function serializeDiagnosticError(
  error: unknown,
  depth = 0,
): Record<string, unknown> {
  const normalized = normalizeError(error)
  const result: Record<string, unknown> = {
    name: normalized.name,
    message: sanitizeDiagnosticText(normalized.message),
  }
  if (normalized.stack) result.stack = sanitizeDiagnosticText(normalized.stack)
  if (depth < MAX_ERROR_DEPTH && normalized.cause !== undefined) {
    result.cause = serializeDiagnosticError(normalized.cause, depth + 1)
  }
  return result
}

export function formatDiagnosticErrorChain(error: unknown, depth = 0): string {
  if (depth > MAX_ERROR_DEPTH) return "[error chain truncated]"
  const normalized = normalizeError(error)
  const lines = [
    `${normalized.name}: ${sanitizeDiagnosticText(normalized.message)}`,
  ]
  if (normalized.stack) lines.push(sanitizeDiagnosticText(normalized.stack))
  if (normalized.cause !== undefined)
    lines.push(
      `Caused by:\n${formatDiagnosticErrorChain(normalized.cause, depth + 1)}`,
    )
  return lines.join("\n").slice(0, MAX_TEXT_LENGTH)
}

export function sanitizeDiagnosticValue(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]"
  if (value instanceof Error)
    return sanitizeDiagnosticValue(serializeDiagnosticError(value), key, seen)
  if (Array.isArray(value))
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeDiagnosticValue(item, key, seen))
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizeDiagnosticValue(child, childKey, seen),
      ]),
    )
  }
  if (typeof value === "string") return sanitizeDiagnosticText(value)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number" && !Number.isFinite(value)) return String(value)
  return value
}

export function sanitizeDiagnosticExportValue(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]"
  if (value instanceof Error)
    return sanitizeDiagnosticExportValue(
      serializeDiagnosticError(value),
      key,
      seen,
    )
  if (Array.isArray(value))
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeDiagnosticExportValue(item, key, seen))
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizeDiagnosticExportValue(child, childKey, seen),
      ]),
    )
  }
  if (typeof value === "string") return sanitizeDiagnosticExportText(value)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number" && !Number.isFinite(value)) return String(value)
  return value
}

export function isSafeDiagnosticId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
}

export function normalizeRendererDiagnostic(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined
  const input = value as Record<string, unknown>
  const event =
    typeof input.event === "string" &&
    /^[A-Za-z0-9._:-]{1,96}$/.test(input.event)
      ? input.event
      : undefined
  if (!event) return undefined
  const level =
    input.level === "debug" ||
    input.level === "info" ||
    input.level === "warn" ||
    input.level === "error"
      ? input.level
      : "info"
  const fields =
    input.fields &&
    typeof input.fields === "object" &&
    !Array.isArray(input.fields)
      ? sanitizeDiagnosticValue(
          Object.fromEntries(
            Object.entries(input.fields as Record<string, unknown>).slice(
              0,
              32,
            ),
          ),
        )
      : undefined
  const correlationID = isSafeDiagnosticId(input.correlationID)
    ? input.correlationID
    : undefined
  const rendererID = isSafeDiagnosticId(input.rendererID)
    ? input.rendererID
    : undefined
  const durationMs =
    typeof input.durationMs === "number" &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0
      ? Math.round(input.durationMs)
      : undefined
  return {
    event,
    level,
    ...(correlationID ? { correlationID } : {}),
    ...(rendererID ? { rendererID } : {}),
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    ...(fields && typeof fields === "object"
      ? { fields: fields as Record<string, unknown> }
      : {}),
  } as {
    event: string
    level: "debug" | "info" | "warn" | "error"
    correlationID?: string
    rendererID?: string
    durationMs?: number
    fields?: Record<string, unknown>
  }
}

export function diagnosticPath(value: string | URL) {
  try {
    return new URL(value).pathname
  } catch {
    return "$URL"
  }
}

const TEXT_EXPORT_EXTENSIONS = new Set([
  ".log",
  ".ndjson",
  ".json",
  ".netlog",
  ".txt",
])

const SAFE_EXPORT_EXTENSIONS = new Set([".log", ".ndjson"])

export function shouldCaptureNetworkLog(env: NodeJS.ProcessEnv) {
  return env.SPINOSA_DESKTOP_NETLOG === "1"
}

/** Only text logs can be scrubbed before a debug ZIP is shared. */
export function shouldIncludeDiagnosticFile(file: string) {
  return SAFE_EXPORT_EXTENSIONS.has(path.extname(file).toLowerCase())
}

export function sanitizeDiagnosticExportData(file: string, data: Buffer) {
  if (!TEXT_EXPORT_EXTENSIONS.has(path.extname(file).toLowerCase())) return data
  return Buffer.from(sanitizeDiagnosticExportText(data.toString("utf8")))
}
