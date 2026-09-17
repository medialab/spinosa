export function isUnicodeSupported(): boolean {
  if (process.env.NO_COLOR !== undefined) return false
  const term = (process.env.TERM ?? "").toLowerCase()
  if (term === "dumb" || term === "linux") return false
  const lang = (process.env.LANG ?? process.env.LC_ALL ?? process.env.LC_CTYPE ?? "").toLowerCase()
  if (lang === "c" || lang === "posix") return false
  if (lang && !lang.includes("utf-8") && !lang.includes("utf8")) return false
  return true
}

export function supportsTrueColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false
  const colorterm = (process.env.COLORTERM ?? "").toLowerCase()
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) return true
  const term = (process.env.TERM ?? "").toLowerCase()
  if (term.includes("direct") || term.includes("truecolor")) return true
  return false
}

export function isDumbTerminal(): boolean {
  const term = (process.env.TERM ?? "").toLowerCase()
  return term === "dumb" || term === "linux"
}
