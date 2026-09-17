export * as ConfigMarkdown from "./markdown"

import { parse as parseYaml } from "yaml"

export interface ParsedMarkdown {
  // Same shape gray-matter returned: indexable payload, unknown content.
  data: { [key: string]: any }
  content: string
}

// Leading `---` fence with an optional body. The body group is undefined
// for an empty fence (`---\n---\nContent`).
const FRONTMATTER_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

function split(content: string): ParsedMarkdown {
  const match = content.match(FRONTMATTER_RE)
  if (!match) return { data: {}, content }
  const raw = match[1] ?? ""
  if (raw.trim() === "") return { data: {}, content: content.slice(match[0].length) }
  return { data: parseYaml(raw) ?? {}, content: content.slice(match[0].length) }
}

export function parse(content: string): ParsedMarkdown {
  try {
    return split(content)
  } catch {
    return split(sanitize(content))
  }
}

export function parseOption(content: string) {
  try {
    return parse(content)
  } catch {
    return undefined
  }
}

// Other coding agents accept unquoted colons in frontmatter values. Retry
// those values as YAML block scalars so existing config files keep working.
export function sanitize(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return content
  const frontmatter = match[1]
  if (frontmatter === undefined) return content
  const result = frontmatter.split(/\r?\n/).flatMap((line) => {
    if (line.trim().startsWith("#") || line.trim() === "" || /^\s+/.test(line)) return [line]
    const entry = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
    if (!entry) return [line]
    const rawValue = entry[2]
    if (rawValue === undefined) return [line]
    const value = rawValue.trim()
    if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) return [line]
    if (!value.includes(":")) return [line]
    return [`${entry[1]}: |-`, `  ${value}`]
  })
  return content.replace(frontmatter, () => result.join("\n"))
}
