import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  builtinMcpConfigs,
  filterGallery,
  mergePartnerIntoConfig,
  partnerById,
  PARTNER_MCPS,
  partnerToMcpConfig,
} from "../../src/mcp/partners"
import { resolveInvocationDir } from "../../src/cli/cmd/mcp"

describe("partner gallery", () => {
  test("covers thirty services with unique ids", () => {
    expect(PARTNER_MCPS.length).toBe(30)
    expect(new Set(PARTNER_MCPS.map((e) => e.id)).size).toBe(30)
  })

  test("every entry is well-formed with docs", () => {
    for (const entry of PARTNER_MCPS) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.docsUrl.startsWith("https://")).toBe(true)
      if (entry.transport.kind === "remote") {
        expect(entry.transport.url.startsWith("https://")).toBe(true)
      }
      if (entry.transport.kind === "local") {
        expect(entry.transport.command.length).toBeGreaterThan(0)
      }
      if (entry.transport.kind === "guided") {
        expect(entry.transport.summary.length).toBeGreaterThan(0)
      }
    }
  })

  test("verified entries never carry empty transports", () => {
    for (const entry of PARTNER_MCPS.filter((e) => e.source === "verified")) {
      if (entry.transport.kind === "remote") expect(entry.transport.url).not.toBe("")
      if (entry.transport.kind === "local") {
        expect(entry.transport.command.some((p) => p.length === 0)).toBe(false)
      }
    }
  })

  test("filters narrow the gallery", () => {
    expect(filterGallery({ category: "research" }).length).toBeGreaterThan(5)
    expect(filterGallery({ phase: "verify" }).every((e) => e.phase === "verify")).toBe(true)
    expect(filterGallery({ status: "official" }).every((e) => e.status === "official")).toBe(true)
    expect(partnerById("nope")).toBeUndefined()
  })

  test("config fragments are disabled by default", () => {
    const notion = partnerById("notion")!
    expect(partnerToMcpConfig(notion)).toMatchObject({
      type: "remote", url: "https://mcp.notion.com/mcp", enabled: false,
    })
    const obsidian = partnerById("obsidian")!
    const local = partnerToMcpConfig(obsidian)
    expect(local).toMatchObject({ type: "local", enabled: false })
    if (local?.type === "local") {
      expect(local.command).toContain("obsidian-mcp@2")
    }
    const overleaf = partnerById("overleaf")!
    expect(partnerToMcpConfig(overleaf)).toBeUndefined()
  })

  test("local fragments use `environment` so the runtime picks them up", () => {
    const zotero = partnerById("zotero")!
    const fragment = partnerToMcpConfig(zotero)
    expect(fragment?.type).toBe("local")
    if (fragment?.type === "local") {
      // Placeholders persist for `mcp add` customization; the runtime ignores
      // empty values so host-exported credentials pass through.
      expect(fragment.environment).toMatchObject({ ZOTERO_API_KEY: "", ZOTERO_LIBRARY_ID: "" })
      expect("env" in fragment).toBe(false)
    }
  })

  test("builtinMcpConfigs exposes one-shot gallery as disabled defaults", () => {
    const builtins = builtinMcpConfigs()
    const oneShot = PARTNER_MCPS.filter((e) => e.transport.kind !== "guided")
    expect(Object.keys(builtins).length).toBe(oneShot.length)
    expect(Object.keys(builtins).length).toBe(18)
    for (const [id, fragment] of Object.entries(builtins)) {
      expect(fragment.enabled).toBe(false)
      expect(partnerById(id)).toBeDefined()
    }
    // Flagship locals are present; guided entries never are.
    expect(builtins.zotero?.type).toBe("local")
    expect(builtins.obsidian?.type).toBe("local")
    expect(builtins.openalex?.type).toBe("local")
    expect(builtins.notion?.type).toBe("remote")
    expect("overleaf" in builtins).toBe(false)
  })
})

describe("effectiveMcpTable (built-ins under user config)", () => {
  test("builtins list disabled; user entries win on collision", async () => {
    const { effectiveMcpTable } = await import("../../src/mcp/index")
    const empty = effectiveMcpTable({})
    expect(Object.keys(empty).length).toBe(18)
    expect(empty.zotero).toMatchObject({ type: "local", enabled: false })
    const custom = effectiveMcpTable({
      zotero: { type: "local", command: ["my-zotero-bridge"], enabled: true },
    })
    expect(custom.zotero).toMatchObject({ command: ["my-zotero-bridge"], enabled: true })
    expect(Object.keys(custom).length).toBe(18)
  })
})

describe("resolveInvocationDir", () => {
  test("prefers the shell PWD over the launcher cwd", () => {
    const caller = mkdtempSync(path.join(tmpdir(), "spinosa-mcp-pwd-"))
    expect(resolveInvocationDir(caller, "/repo-root")).toBe(caller)
    expect(resolveInvocationDir(undefined, "/repo-root")).toBe("/repo-root")
    expect(resolveInvocationDir("relative/path", "/repo-root")).toBe("/repo-root")
    expect(resolveInvocationDir(path.join(caller, "missing"), "/repo-root")).toBe("/repo-root")
  })
})

describe("mergePartnerIntoConfig", () => {
  test("adds without disturbing existing keys", () => {
    const merged = mergePartnerIntoConfig(
      { theme: "dark", mcp: { existing: { type: "remote", url: "https://x", enabled: true } } },
      partnerById("linear")!,
    )
    expect(merged.changed).toBe(true)
    expect((merged.config.mcp as Record<string, unknown>).linear).toMatchObject({
      type: "remote", url: "https://mcp.linear.app/mcp", enabled: false,
    })
    expect((merged.config.mcp as Record<string, unknown>).existing).toBeDefined()
    expect(merged.config.theme).toBe("dark")
  })

  test("is idempotent and guides manual entries", () => {
    const first = mergePartnerIntoConfig({}, partnerById("linear")!)
    const second = mergePartnerIntoConfig(first.config, partnerById("linear")!)
    expect(second.changed).toBe(false)
    const guided = mergePartnerIntoConfig({}, partnerById("overleaf")!)
    expect(guided.changed).toBe(false)
    expect(guided.reason).toContain("https://github.com/yangzichao/mcp-server-overleaf")
  })
})
