/**
 * One-shot stdio probe against spinosa mcp-server.
 * Usage: bun packages/spinosa-kernel/scripts/probe-mcp-server.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const cliEntry = path.join(repoRoot, "packages/spinosa-cli/src/index.ts")

async function makeWorkspace(): Promise<string> {
  const root = path.join(tmpdir(), "spinosa-mcp-probe-" + crypto.randomUUID())
  await mkdir(path.join(root, ".spinosa"), { recursive: true })
  await mkdir(path.join(root, ".agents", "skills", "spinosa-searcher"), { recursive: true })
  await Bun.write(
    path.join(root, ".spinosa", "workspace"),
    "setup_status: workspace_started\nframework_version: 0.0.0-probe\n",
  )
  await Bun.write(
    path.join(root, ".agents", "skills", "spinosa-searcher", "SKILL.md"),
    "---\nname: spinosa-searcher\n---\n# Searcher probe\n",
  )
  return root
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text!)
    .join("\n")
}

const ws = await makeWorkspace()
console.error(`[probe] workspace=${ws}`)
console.error(`[probe] launching: bun ${cliEntry} mcp-server`)

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cliEntry, "mcp-server"],
  cwd: repoRoot,
  env: {
    ...process.env,
    SPINOSA_TEMPLATE_ROOT: repoRoot,
    SPINOSA_PRODUCT: "1",
  },
  stderr: "pipe",
})

transport.stderr?.on("data", (chunk: Buffer) => {
  const line = chunk.toString()
  if (line.trim()) console.error(`[server.stderr] ${line.trimEnd()}`)
})

const client = new Client({ name: "spinosa-mcp-probe", version: "0.0.0" })
await client.connect(transport)
console.error("[probe] connected")

const tools = await client.listTools()
console.log(JSON.stringify({ step: "listTools", tools: tools.tools.map((t) => t.name) }, null, 2))

const list = await client.callTool({ name: "workspace_list", arguments: {} })
console.log(JSON.stringify({ step: "workspace_list", isError: list.isError, text: textOf(list as never) }, null, 2))

const use = await client.callTool({ name: "workspace_use", arguments: { path: ws } })
console.log(JSON.stringify({ step: "workspace_use", isError: use.isError, text: textOf(use as never) }, null, 2))

const info = await client.callTool({ name: "workspace_info", arguments: {} })
console.log(JSON.stringify({ step: "workspace_info", isError: info.isError, text: textOf(info as never) }, null, 2))

const skills = await client.callTool({ name: "list_skills", arguments: {} })
console.log(JSON.stringify({ step: "list_skills", isError: skills.isError, text: textOf(skills as never) }, null, 2))

const gate = await client.callTool({
  name: "spinosa_gate",
  arguments: { coverage: "sufficient", sourceCount: 2 },
})
console.log(JSON.stringify({ step: "spinosa_gate", isError: gate.isError, text: textOf(gate as never) }, null, 2))

const figure = await client.callTool({
  name: "spinosa_figure",
  arguments: {
    kind: "bar",
    title: "Probe",
    caption: "Smoke figure",
    source: "probe",
    units: "n",
    items: [{ label: "a", value: 3 }, { label: "b", value: 1 }],
  },
})
console.log(JSON.stringify({ step: "spinosa_figure", isError: figure.isError, text: textOf(figure as never) }, null, 2))

await client.close()
console.error("[probe] done")
