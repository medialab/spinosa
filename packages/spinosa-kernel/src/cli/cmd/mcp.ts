import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Global } from "@spinosa/kernel-core/global"
import {
  filterGallery,
  mergePartnerIntoConfig,
  partnerById,
  partnerToMcpConfig,
  PARTNER_MCPS,
  type GalleryFilter,
  type PartnerCategory,
  type PartnerEntry,
  type PartnerPhase,
  type PartnerStatus,
} from "../../mcp/partners"
import { getFormatFromRecord, emitResult } from "../output"
import { cmd } from "./cmd"

const CATEGORIES: readonly PartnerCategory[] = [
  "research",
  "notes",
  "storage",
  "comms",
  "tasks",
  "dev",
  "planning",
]

function transportSummary(entry: PartnerEntry): string {
  const t = entry.transport
  if (t.kind === "remote") return t.url
  if (t.kind === "local") return t.command.join(" ")
  return "guided setup"
}

function authSummary(entry: PartnerEntry): string {
  const a = entry.auth
  if (a.kind === "oauth") return "OAuth"
  if (a.kind === "apiKey" || a.kind === "botToken") return a.env
  return "none"
}

function galleryRows(entries: readonly PartnerEntry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    status: entry.status,
    source: entry.source,
    category: entry.category,
    phase: entry.phase,
    transport: transportSummary(entry),
    auth: authSummary(entry),
  }))
}

function printGallery(entries: readonly PartnerEntry[]) {
  for (const entry of entries) {
    const tag = entry.source === "verified" ? "✓" : "…"
    console.log(`${tag} ${entry.id} — ${entry.label} [${entry.status}]`)
    console.log(`  ${entry.description}`)
    console.log(`  transport: ${transportSummary(entry)} · auth: ${authSummary(entry)} · phase: ${entry.phase}`)
    if (entry.caveats) for (const caveat of entry.caveats) console.log(`  ! ${caveat}`)
    console.log(`  docs: ${entry.docsUrl}`)
  }
  console.log(`\n${entries.length} partner(s). Add one: spinosa mcp add <id> [--global|--workspace]`)
}

function printGuidedInstall(entry: PartnerEntry) {
  console.log(`Partner '${entry.id}' needs manual setup (no verified one-shot recipe):`)
  console.log(`\n  ${entry.transport.kind === "guided" ? entry.transport.summary : ""}`)
  console.log(`\n  auth: ${authSummary(entry)}${entry.auth.kind !== "none" && "note" in entry.auth && entry.auth.note ? ` — ${entry.auth.note}` : ""}`)
  console.log(`  docs: ${entry.docsUrl}`)
  if (entry.caveats) for (const caveat of entry.caveats) console.log(`  ! ${caveat}`)
  console.log(`\nOnce installed, add it here with the server details from the docs above.`)
}

/**
 * The launcher runs the kernel with `bun --cwd <frameworkRoot>`, so
 * process.cwd() is the repo root — never the caller's directory. The shell's
 * PWD survives (only cwd changes), so prefer it for --workspace scope.
 * Exported for tests.
 */
export function resolveInvocationDir(envPwd: string | undefined, fallbackCwd: string): string {
  if (envPwd && path.isAbsolute(envPwd)) {
    try {
      if (statSync(envPwd).isDirectory()) return envPwd
    } catch {
      // Fall through to cwd.
    }
  }
  return fallbackCwd
}

function findJsonConfig(dir: string): { file: string; jsoncPresent: boolean } | undefined {
  for (const name of ["spinosa.json", "opencode.json"]) {
    if (existsSync(path.join(dir, name))) return { file: path.join(dir, name), jsoncPresent: false }
  }
  for (const name of ["spinosa.jsonc", "opencode.jsonc"]) {
    if (existsSync(path.join(dir, name))) return { file: path.join(dir, name), jsoncPresent: true }
  }
  return undefined
}

function printNextSteps(entry: PartnerEntry, scope: string) {
  console.log(`Added mcp.${entry.id} (${scope}, disabled). Next:`)
  const t = entry.transport
  if (t.kind === "local" && t.env) {
    for (const [key, placeholder] of Object.entries(t.env)) {
      if (!placeholder) console.log(`  - set ${key} in the mcp.${entry.id}.environment block`)
    }
    if (t.command.some((part) => part.includes("<") || part.includes("VAULT"))) {
      console.log(`  - replace placeholders in mcp.${entry.id}.command (e.g. vault path)`)
    }
  }
  if (entry.auth.kind === "oauth") console.log(`  - authorize on first connect (MCP dialog or connect flow)`)
  console.log(`  - toggle it on in the MCP dialog; keep it off when not needed`)
  if (entry.caveats) for (const caveat of entry.caveats) console.log(`  ! ${caveat}`)
}

export const McpCommand = cmd({
  command: "mcp <action> [id]",
  describe: "Browse and install curated third-party MCP servers for researchers",
  builder: (yargs: import("yargs").Argv) =>
    yargs
      .positional("action", { type: "string", choices: ["gallery", "add"] as const, demandOption: true })
      .positional("id", { type: "string" })
      .option("global", { type: "boolean", describe: "Write to global config (default)", default: true })
      .option("workspace", { type: "boolean", describe: "Write to ./spinosa.json in the current directory" })
      .option("category", { type: "string", choices: CATEGORIES })
      .option("phase", { type: "string", choices: ["acquire", "extract", "verify", "publish", "coordinate"] })
      .option("status", { type: "string", choices: ["official", "official-preview", "community"] })
      .option("json", { type: "boolean", describe: "Emit machine-readable JSON", default: false }),
  handler: async (args: Record<string, unknown>) => {
    const fmt = getFormatFromRecord(args)
    const action = args.action as string

    if (action === "gallery") {
      const filter: GalleryFilter = {
        ...(typeof args.category === "string" ? { category: args.category as PartnerCategory } : {}),
        ...(typeof args.phase === "string" ? { phase: args.phase as PartnerPhase } : {}),
        ...(typeof args.status === "string" ? { status: args.status as PartnerStatus } : {}),
      }
      const entries = filterGallery(filter)
      if (args.json) {
        const rows = galleryRows(entries)
        emitResult(fmt, "mcp-gallery", { partners: rows }, JSON.stringify(rows, null, 2))
        return
      }
      printGallery(entries)
      return
    }

    // action === "add"
    const id = args.id as string | undefined
    if (!id) throw new Error("Usage: spinosa mcp add <id> (see: spinosa mcp gallery)")
    const entry = partnerById(id)
    if (!entry) {
      const known = PARTNER_MCPS.map((e) => e.id).join(", ")
      throw new Error(`Unknown partner '${id}'. Known: ${known}`)
    }
    if (entry.transport.kind === "guided") {
      if (args.json) {
        emitResult(fmt, "mcp-add-guided", { id, guided: true, docsUrl: entry.docsUrl }, "")
        return
      }
      printGuidedInstall(entry)
      return
    }

    const scope = args.workspace ? "workspace" : "global"
    const dir = args.workspace
      ? resolveInvocationDir(process.env.PWD, process.cwd())
      : Global.Path.config
    mkdirSync(dir, { recursive: true })
    const found = findJsonConfig(dir)
    const target = found?.file ?? path.join(dir, "spinosa.json")
    if (found?.jsoncPresent) {
      const fragment = partnerToMcpConfig(entry)
      console.log(`Refusing to rewrite JSONC with comments: ${target}`)
      console.log(`Add this fragment under "mcp" manually, then toggle it in the MCP dialog:`)
      console.log(JSON.stringify(fragment ? { mcp: { [entry.id]: fragment } } : { mcp: {} }, null, 2))
      console.log(`Docs: ${entry.docsUrl}`)
      return
    }
    let existing: unknown = {}
    if (existsSync(target)) {
      try {
        existing = JSON.parse(readFileSync(target, "utf-8"))
      } catch (error) {
        throw new Error(`Could not parse ${target}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const merged = mergePartnerIntoConfig(existing, entry)
    if (!merged.changed) {
      console.log(merged.reason)
      return
    }
    writeFileSync(target, JSON.stringify(merged.config, null, 2) + "\n", "utf-8")
    if (args.json) {
      emitResult(fmt, "mcp-add", { id, file: target, changed: true }, "")
      return
    }
    console.log(`Wrote ${target}`)
    printNextSteps(entry, scope)
  },
})
