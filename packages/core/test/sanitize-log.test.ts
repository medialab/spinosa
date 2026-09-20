import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import path from "node:path"
import { sanitizeLogText, sanitizeLogValue } from "../src/observability/sanitize-log"

describe("sanitizeLogText", () => {
  test("keeps product log paths and strips user corpus paths", () => {
    const home = homedir()
    const product = path.join(home, ".spinosa", "logs", "boot.ndjson")
    const corpus = path.join(home, "Downloads", "ARCHIVE-GLOBAL-EL2MP", "notes.md")
    const text = sanitizeLogText(`boot ${product} scan ${corpus}`)
    expect(text).toMatch(/~\/\.spinosa\/logs\/boot\.ndjson|\$SPINOSA_HOME\/logs\/boot\.ndjson/)
    expect(text).not.toContain("ARCHIVE-GLOBAL-EL2MP")
    expect(text).not.toContain(home)
    expect(text).toContain("$PATH.md")
  })

  test("redacts tokens, bearer secrets, and emails", () => {
    const text = sanitizeLogText("token=private-value Bearer abcdefghijklmnop user@example.com sk-ant-abcdefghijk")
    expect(text).toContain("token=[REDACTED]")
    expect(text).toContain("Bearer [REDACTED]")
    expect(text).toContain("$EMAIL")
    expect(text).toContain("[REDACTED]")
    expect(text).not.toContain("private-value")
    expect(text).not.toContain("abcdefghijklmnop")
    expect(text).not.toContain("user@example.com")
  })

  test("strips URL query strings", () => {
    const text = sanitizeLogText("https://api.example.com/v1/models?api_key=secret123")
    expect(text).toBe("https://api.example.com/v1/models")
    expect(text).not.toContain("secret123")
  })

  test("redacts relative corpus filenames and keeps product tool names", () => {
    const text = sanitizeLogText("  invoices/acme.pdf → copied pdf.js MarkItDown failed: notes.md")
    expect(text).toContain("$PATH.pdf")
    expect(text).toContain("$PATH.md")
    expect(text).toContain("pdf.js")
    expect(text).not.toContain("invoices/acme")
    expect(text).not.toContain("notes.md")
    expect(sanitizeLogText("opencode/1.17.12")).toBe("opencode/1.17.12")
  })
})

describe("sanitizeLogValue", () => {
  test("redacts nested secret keys and path fields", () => {
    const home = homedir()
    const value = sanitizeLogValue(
      {
        directory: path.join(home, "Documents", "vault"),
        nested: { password: "hunter2", ok: true },
      },
      "",
    ) as Record<string, unknown>
    expect(value.directory).toBe("$PATH")
    expect((value.nested as { password: string }).password).toBe("[REDACTED]")
    expect((value.nested as { ok: boolean }).ok).toBe(true)
  })

  test("redacts worktree and projectName fields", () => {
    const home = homedir()
    const value = sanitizeLogValue(
      {
        worktree: path.join(home, "Documents", "vault"),
        projectName: "Secret Thesis",
        relPath: "chapter-1.md",
      },
      "",
    ) as Record<string, unknown>
    expect(value.worktree).toBe("$PATH")
    expect(value.projectName).toBe("$NAME")
    expect(value.relPath).toBe("$PATH.md")
  })
})

describe("sanitizeLogText corpus leaks", () => {
  test("does not keep workspace .spinosa folders as product paths", () => {
    const home = homedir()
    const workspaceMarker = path.join(home, "Downloads", "ARCHIVE-GLOBAL-EL2MP-2", ".spinosa", "memory", "orchestrator-notes.md")
    const text = sanitizeLogText(`evaluated permission=read pattern=${workspaceMarker}`)
    expect(text).not.toContain("ARCHIVE-GLOBAL-EL2MP-2")
    expect(text).not.toContain("orchestrator-notes")
    expect(text).toContain("$PATH.md")
    expect(text).toContain("pattern=")
  })

  test("redacts AGENTS.md under a user folder", () => {
    const home = homedir()
    const agents = path.join(home, "Downloads", "ARCHIVE-GLOBAL-EL2MP-2", "AGENTS.md")
    const text = sanitizeLogText(`resolved=${agents}`)
    expect(text).not.toContain("ARCHIVE-GLOBAL-EL2MP-2")
    expect(text).not.toContain(home)
    expect(text).toContain("$PATH.md")
  })

  test("redacts home paths that lost their leading slash", () => {
    const home = homedir()
    const stripped = `${home.replace(/^\/+/, "")}/Downloads/ARCHIVE-GLOBAL-EL2MP-2/raw`
    const text = sanitizeLogText(`evaluated permission=read pattern=${stripped}`)
    expect(text).not.toContain("ARCHIVE-GLOBAL-EL2MP-2")
    expect(text).not.toContain(home.replace(/^\/+/, ""))
    expect(text).toContain("$PATH")
  })

  test("redacts stack frames that wrap a home path in parentheses", () => {
    const home = homedir()
    const file = path.join(home, "Documents", "spinosa-desktop-worktree", "node_modules", "@effect", "NodeHttpServer.js")
    const text = sanitizeLogText(`at onError (${file}:74:30)\n    at ~effect/Effect/evaluate (${file}:79:12)`)
    expect(text).not.toContain("spinosa-desktop-worktree")
    expect(text).not.toContain(home)
    expect(text).toContain("$PATH")
    expect(text).toContain("~effect/Effect/evaluate")
  })
})
