import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { getFormat, logProgress, emitResult } from "../../src/cli/output"
import {
  SpinosaMcpSession,
  createSpinosaMcpServer,
  listSkillFiles,
} from "../../src/cli/cmd/mcp-server"
import { spinosaGate } from "@spinosa/core"

async function fakeWorkspace(): Promise<string> {
  const root = path.join(tmpdir(), "spinosa-mcp-" + crypto.randomUUID())
  await mkdir(path.join(root, ".spinosa"), { recursive: true })
  await mkdir(path.join(root, "agent_reports"), { recursive: true })
  await mkdir(path.join(root, ".agents", "skills", "spinosa-searcher"), { recursive: true })
  await Bun.write(path.join(root, ".spinosa", "workspace"), "setup_status: workspace_started\nframework_version: 0.0.0-test\n")
  await Bun.write(
    path.join(root, ".agents", "skills", "spinosa-searcher", "SKILL.md"),
    "---\nname: spinosa-searcher\n---\n# Searcher\n",
  )
  return root
}

describe("cli output", () => {
  test("getFormat prefers json over quiet", () => {
    expect(getFormat({ json: true, quiet: true })).toBe("json")
    expect(getFormat({ quiet: true })).toBe("quiet")
    expect(getFormat({})).toBe("human")
  })

  test("logProgress writes NDJSON to stderr in json mode", () => {
    const chunks: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stderr.write
    try {
      logProgress("json", "import", "3/10 a.pdf", { current: 3, total: 10 })
    } finally {
      process.stderr.write = orig
    }
    expect(chunks.join("")).toContain('"type":"progress"')
    expect(chunks.join("")).toContain('"phase":"import"')
  })

  test("emitResult writes one JSON object to stdout", () => {
    const chunks: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write
    try {
      emitResult("json", "create", { workspacePath: "/tmp/ws" }, "ignored")
    } finally {
      process.stdout.write = orig
    }
    const parsed = JSON.parse(chunks.join("").trim())
    expect(parsed.command).toBe("create")
    expect(parsed.workspacePath).toBe("/tmp/ws")
  })
})

describe("SpinosaMcpSession", () => {
  test("starts unbound and rejects resolve until use", () => {
    const session = new SpinosaMcpSession()
    expect(session.currentWorkspace).toBeNull()
    expect(() => session.resolveWorkspace()).toThrow(/No workspace selected/)
  })

  test("use binds a valid workspace; clear unbinds", async () => {
    const ws = await fakeWorkspace()
    const session = new SpinosaMcpSession()
    expect(session.use(ws)).toBe(path.resolve(ws))
    expect(session.resolveWorkspace()).toBe(path.resolve(ws))
    session.clear()
    expect(session.currentWorkspace).toBeNull()
  })

  test("per-call workspacePath override does not require bind", async () => {
    const ws = await fakeWorkspace()
    const session = new SpinosaMcpSession()
    expect(session.resolveWorkspace(ws)).toBe(path.resolve(ws))
    expect(session.currentWorkspace).toBeNull()
  })

  test("rejects non-workspace paths", () => {
    const session = new SpinosaMcpSession()
    expect(() => session.use(tmpdir())).toThrow(/Not a Spinosa workspace/)
  })

  test("optional initialWorkspace only binds when valid", async () => {
    const ws = await fakeWorkspace()
    expect(new SpinosaMcpSession(ws).currentWorkspace).toBe(path.resolve(ws))
    expect(new SpinosaMcpSession(tmpdir()).currentWorkspace).toBeNull()
  })
})

describe("deleteWorkspace core", () => {
  test("unregisters a missing path without error", async () => {
    const { deleteWorkspace } = await import("@spinosa/core/workspace/delete")
    const missing = path.join(tmpdir(), "spinosa-missing-" + crypto.randomUUID())
    const result = await deleteWorkspace(missing)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.action).toBe("unregistered")
  })
})

describe("mcp skills", () => {
  test("listSkillFiles finds SKILL.md under pack roots", async () => {
    const ws = await fakeWorkspace()
    const skills = listSkillFiles(ws)
    expect(skills.some((s) => s.name === ".agents/spinosa-searcher" || s.name.endsWith("/spinosa-searcher"))).toBe(true)
    expect(skills[0]?.uri.startsWith("spinosa://skill/")).toBe(true)
  })
})

describe("createSpinosaMcpServer", () => {
  test("builds unbound server with workspace tools", async () => {
    const { server, session } = await createSpinosaMcpServer()
    expect(session.currentWorkspace).toBeNull()
    expect(server).toBeTruthy()
  })

  test("pre-selects initial workspace when valid", async () => {
    const ws = await fakeWorkspace()
    const { session } = await createSpinosaMcpServer({ initialWorkspace: ws })
    expect(session.currentWorkspace).toBe(path.resolve(ws))
  })
})

describe("mcp-server tool core", () => {
  test("spinosa_gate is callable without a session", () => {
    const result = spinosaGate({ coverage: "sufficient", sourceCount: 2 })
    expect(result.pass).toBe(true)
  })
})
