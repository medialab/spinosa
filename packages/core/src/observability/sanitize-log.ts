import { homedir } from "node:os"
import path from "node:path"
import { isRuntimeProductPath, productHomeDir, productLogDir } from "../util/user-dirs"

export { productHomeDir, productLogDir }

const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[_-]?key)/i
const PATH_FIELD =
  /(workspacePath|sourcePath|corpusPath|frameworkRoot|worktree|directory|workdir|cwd|filepath|filename|relPath|hostDir|workspaceDir|destDir|importMeta|dir|file|path|workspace|source|corpus|dest|target|argv|args|pattern)$/i
const NAME_FIELD = /^(projectName|workspaceName)$/i
const KEY_MATERIAL =
  /\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]+|gh[pousr]_[A-Za-z0-9]+|AIza[A-Za-z0-9_-]{10,}|AKIA[A-Z0-9]{10,})\b/g
const PRODUCT_BASENAME =
  /^(tui\.json|boot\.ndjson|tui\.ndjson|debug\.ndjson|effect\.log|spinosa\.log)$/i
const DOC_EXT = "md|txt|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|tiff?|csv|html|xml|rtf|odt|epub|zip|mp[34]|mov|heic|pages|key|numbers"
const RELATIVE_DOC = new RegExp(
  `(^|[\\s"'\`:(→])((?:[^\\s"'\`/]+/)+[^\\s"'\`/]+\\.(?:${DOC_EXT})|[^\\s"'\`/]+\\.(?:${DOC_EXT}))\\b`,
  "gi",
)
const PATH_ASSIGN =
  /\b(workspacePath|sourcePath|corpusPath|frameworkRoot|directory|workdir|cwd|worktree|dest|destDir|relPath|filepath|filename|pattern|resolved)=([^\s]+)/gi

function collapseHomePrefix(text: string, home: string): string {
  if (!home) return text
  let next = text.split(home).join("~")
  const stripped = home.replace(/^\/+/, "")
  if (stripped && stripped !== home) next = next.split(stripped).join("~")
  return next
}

function isProductPath(token: string): boolean {
  const normalized = token.replaceAll("\\", "/")
  if (isRuntimeProductPath(normalized)) return true
  return PRODUCT_BASENAME.test(normalized)
}

function anonymizePathToken(token: string): string {
  if (isProductPath(token)) return token
  const ext = path.extname(token.split("?")[0] ?? token)
  return ext ? `$PATH${ext}` : "$PATH"
}

function redactRelativeDocuments(text: string): string {
  return text.replace(RELATIVE_DOC, (match, prefix: string, token: string) => {
    if (token.includes("=") || token.startsWith("$PATH") || isProductPath(token)) return match
    return `${prefix}${anonymizePathToken(token)}`
  })
}

export function sanitizeLogText(value: string, workspacePath?: string): string {
  let text = value
  if (workspacePath) text = text.split(workspacePath).join("$WORKSPACE")
  const spinosaHome = process.env.SPINOSA_HOME
  if (spinosaHome) text = text.split(spinosaHome).join("$SPINOSA_HOME")
  text = collapseHomePrefix(text, homedir())
  if (process.env.SPINOSA_TEST_HOME) text = collapseHomePrefix(text, process.env.SPINOSA_TEST_HOME)
  text = text.replace(/https?:\/\/[^\s"'`]+/gi, (url) => {
    try {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
    } catch {
      return "$URL"
    }
  })
  text = text.replace(/file:\/\/[^\s"'`]+/gi, (url) => anonymizePathToken(url.slice("file://".length)))
  text = text.replace(
    /(^|[\s="'`])((?:[A-Za-z]:)?(?:\/|\\)[^\s"'`]+|~\/[^\s"'`]+|\$SPINOSA_HOME[^\s"'`]*)/g,
    (_match, prefix: string, token: string) => `${prefix}${anonymizePathToken(token)}`,
  )
  text = text.replace(PATH_ASSIGN, (_match, key: string, raw: string) => {
    return `${key}=${anonymizePathToken(raw)}`
  })
  text = text.replace(/\bfile=([^\s]+)/g, (_match, raw: string) => `file=$PATH${path.extname(raw)}`)
  text = redactRelativeDocuments(text)
  text = text.replace(/\b(authorization|cookie|password|secret|token|api[_-]?key)=([^\s]+)/gi, "$1=[REDACTED]")
  text = text.replace(/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
  text = text.replace(KEY_MATERIAL, "[REDACTED]")
  text = text.replace(/((?:api[_-]?key|token)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/-]{12,}/gi, "$1[REDACTED]")
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "$EMAIL")
  return text
}

export function sanitizeLogValue(value: unknown, key = "", workspacePath?: string): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]"
  if (NAME_FIELD.test(key) && typeof value === "string") return "$NAME"
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item, key, workspacePath))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, sanitizeLogValue(child, childKey, workspacePath)]),
    )
  }
  if (typeof value !== "string") return value
  const text = sanitizeLogText(value, workspacePath)
  if (PATH_FIELD.test(key) && (path.isAbsolute(value) || value.startsWith("~") || value.includes("/") || value.includes("\\") || path.extname(value))) {
    return anonymizePathToken(sanitizeLogText(value, workspacePath))
  }
  return text
}
