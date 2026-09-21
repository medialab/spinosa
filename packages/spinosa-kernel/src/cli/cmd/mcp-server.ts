/**
 * Spinosa MCP server for external agents (Claude, Codex, Cursor, …).
 *
 * General-purpose: starts unbound. The agent lists workspaces, selects one,
 * then calls Spinosa mechanism tools. The outer agent stays the LLM —
 * this server never starts a Spinosa chat/session or provider turn.
 *
 * Host config example:
 *   { "command": "spinosa", "args": ["mcp-server"] }
 * Optional: --workspace / SPINOSA_WORKSPACE as an initial selection only.
 */
import path from "node:path"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import type { Argv, CommandModule } from "yargs"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import {
  spinosaGate,
  spinosaVerify,
  spinosaFigure,
  spinosaMap,
  VERIFY_VALIDATORS,
  isSpinosaWorkspace,
  loadRegistry,
  readWorkspaceMeta,
  deleteWorkspace,
} from "@spinosa/core"
import { InstallationVersion } from "@spinosa/kernel-core/installation/version"

const MCP_INSTRUCTIONS = `You are using the Spinosa MCP server. You (the host model) are the reasoning engine.
Spinosa does not run its own LLM through this server.

## Setup
1. Create or import a workspace with the Spinosa CLI when needed:
   spinosa new /path/to/docs --extensions md,pdf --cli other --launch copy --json
2. Call workspace_list to see registered workspaces (and optional paths).
3. Call workspace_use with a path to bind this MCP session.
4. Then use mechanism tools (gate, verify, figure, map) and skill resources.
5. Read/write corpus files with your own filesystem tools under the workspace.
   Prefer raw/ as the only source corpus. Write durable artifacts under agent_reports/.
   To remove a workspace: workspace_delete with confirm=true (trashes present folders; unregisters missing ones).

## Rules
- Always workspace_use before gate/verify/figure/map unless you pass workspacePath on the call.
- workspace_delete requires confirm=true. Prefer CLI \`spinosa delete <path> --yes\` for the same action.
- Do not expect bash/edit/task or "run Spinosa agent" tools here — those need a Spinosa session.
- Prefer skill resources (spinosa://skill/…) for research playbooks (searcher, writer, verifier, …).
- spinosa_gate = coverage counts. spinosa_verify = artifact shape (not quote-level truth).
`

export type SkillRef = { uri: string; name: string; filePath: string }

export class SpinosaMcpSession {
  currentWorkspace: string | null = null

  constructor(initialWorkspace?: string | null) {
    if (initialWorkspace) {
      const resolved = path.resolve(initialWorkspace)
      if (isSpinosaWorkspace(resolved)) this.currentWorkspace = resolved
    }
  }

  resolveWorkspace(override?: string | null): string {
    if (override?.trim()) {
      const resolved = path.resolve(override.trim())
      if (!isSpinosaWorkspace(resolved)) {
        throw new Error(`Not a Spinosa workspace: ${resolved}`)
      }
      return resolved
    }
    if (!this.currentWorkspace) {
      throw new Error(
        "No workspace selected. Call workspace_list, then workspace_use with a path (or pass workspacePath on this tool).",
      )
    }
    return this.currentWorkspace
  }

  use(workspacePath: string): string {
    const resolved = path.resolve(workspacePath)
    if (!isSpinosaWorkspace(resolved)) {
      throw new Error(`Not a Spinosa workspace: ${resolved}`)
    }
    this.currentWorkspace = resolved
    return resolved
  }

  clear(): void {
    this.currentWorkspace = null
  }
}

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

function skillRoots(workspacePath: string): string[] {
  return [
    path.join(workspacePath, ".agents", "skills"),
    path.join(workspacePath, ".claude", "skills"),
    path.join(workspacePath, ".codex", "skills"),
    path.join(workspacePath, ".opencode", "skills"),
    path.join(workspacePath, ".hermes", "skills"),
  ].filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
}

export function listSkillFiles(workspacePath: string): SkillRef[] {
  const out: SkillRef[] = []
  for (const root of skillRoots(workspacePath)) {
    let entries: string[] = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const name of entries) {
      const skillMd = path.join(root, name, "SKILL.md")
      if (!existsSync(skillMd)) continue
      const pack = path.basename(path.dirname(root))
      out.push({
        uri: `spinosa://skill/${pack}/${name}`,
        name: `${pack}/${name}`,
        filePath: skillMd,
      })
    }
  }
  return out
}

const workspacePathField = z
  .string()
  .optional()
  .describe("Optional workspace path for this call only. Otherwise uses workspace_use selection.")

export async function createSpinosaMcpServer(options?: { initialWorkspace?: string | null }) {
  const session = new SpinosaMcpSession(options?.initialWorkspace ?? null)

  const server = new McpServer(
    {
      name: "spinosa",
      version: InstallationVersion,
    },
    { instructions: MCP_INSTRUCTIONS },
  )

  server.registerTool(
    "workspace_list",
    {
      title: "List workspaces",
      description:
        "List Spinosa workspaces known to this machine (registry). Use workspace_use to bind one before mechanism tools.",
      inputSchema: {},
    },
    async () => {
      const entries = await loadRegistry(undefined, { allowMissingMarker: true })
      return textResult({
        currentWorkspace: session.currentWorkspace,
        count: entries.length,
        workspaces: entries.map((w) => ({
          path: w.path,
          name: w.name,
          status: w.setupStatus,
          presence: w.presence,
          id: w.workspaceID,
          tags: w.tags,
        })),
        tip: entries.length
          ? "Call workspace_use with one of these paths."
          : "No workspaces registered. Create one with: spinosa new /path/to/docs --extensions md,pdf --launch copy --json",
      })
    },
  )

  const refreshResources = (workspacePath: string) => {
    for (const skill of listSkillFiles(workspacePath)) {
      try {
        server.registerResource(
          skill.name,
          skill.uri,
          {
            title: `Skill ${skill.name}`,
            description: `Spinosa skill playbook (${skill.name})`,
            mimeType: "text/markdown",
          },
          async () => ({
            contents: [
              {
                uri: skill.uri,
                mimeType: "text/markdown",
                text: readFileSync(skill.filePath, "utf8"),
              },
            ],
          }),
        )
      } catch {
        // Already registered after a previous workspace_use in this process.
      }
    }
  }

  server.registerTool(
    "workspace_use",
    {
      title: "Select workspace",
      description:
        "Bind this MCP session to a Spinosa workspace path. Required before gate/verify/figure/map/skills unless you pass workspacePath per call.",
      inputSchema: {
        path: z.string().describe("Absolute or relative path to a Spinosa workspace root"),
      },
    },
    async (args) => {
      try {
        const used = session.use(args.path)
        refreshResources(used)
        const meta = await readWorkspaceMeta(used)
        const skills = listSkillFiles(used)
        return textResult({
          ok: true,
          workspacePath: used,
          setupStatus: meta?.setupStatus,
          frameworkVersion: meta?.frameworkVersion,
          skillCount: skills.length,
          tip: "Mechanism tools now target this workspace. Read skill resources or call list_skills.",
        })
      } catch (error) {
        return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
      }
    },
  )

  server.registerTool(
    "workspace_info",
    {
      title: "Current workspace",
      description: "Show the workspace bound to this MCP session (if any).",
      inputSchema: {},
    },
    async () => {
      if (!session.currentWorkspace) {
        return textResult({
          ok: false,
          currentWorkspace: null,
          tip: "Call workspace_list then workspace_use.",
        })
      }
      const meta = await readWorkspaceMeta(session.currentWorkspace)
      return textResult({
        ok: true,
        workspacePath: session.currentWorkspace,
        setupStatus: meta?.setupStatus,
        frameworkVersion: meta?.frameworkVersion,
      })
    },
  )

  server.registerTool(
    "workspace_clear",
    {
      title: "Clear workspace selection",
      description: "Unbind the current workspace from this MCP session.",
      inputSchema: {},
    },
    async () => {
      session.clear()
      return textResult({ ok: true, currentWorkspace: null })
    },
  )

  server.registerTool(
    "workspace_delete",
    {
      title: "Delete workspace",
      description:
        "Trash a present Spinosa workspace folder (or unregister a missing/invalid path). Requires confirm=true. Clears the MCP bind if it matches.",
      inputSchema: {
        path: z.string().describe("Absolute or relative path to the workspace root"),
        confirm: z
          .boolean()
          .describe("Must be true to proceed. Refuses otherwise."),
      },
    },
    async (args) => {
      try {
        if (args.confirm !== true) {
          return textResult(
            {
              ok: false,
              error: "Refusing to delete without confirm=true",
              tip: "Call again with { path, confirm: true }, or use: spinosa delete <path> --yes",
            },
            true,
          )
        }
        const result = await deleteWorkspace(args.path)
        if (result.ok) {
          const resolved = path.resolve(args.path)
          if (session.currentWorkspace === resolved) session.clear()
        }
        return textResult(result, !result.ok)
      } catch (error) {
        return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
      }
    },
  )

  server.registerTool(
    "list_skills",
    {
      title: "List Spinosa skills",
      description: "List skill playbooks available in the selected (or given) workspace.",
      inputSchema: { workspacePath: workspacePathField },
    },
    async (args) => {
      try {
        const ws = session.resolveWorkspace(args.workspacePath)
        const skills = listSkillFiles(ws)
        return textResult({
          workspacePath: ws,
          skills: skills.map((s) => ({ name: s.name, uri: s.uri })),
          tip: "Use MCP resources with these URIs, or read_skill with a name.",
        })
      } catch (error) {
        return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
      }
    },
  )

  server.registerTool(
    "read_skill",
    {
      title: "Read a Spinosa skill",
      description: "Return the SKILL.md body for a skill name (e.g. .agents/spinosa-searcher or spinosa-searcher).",
      inputSchema: {
        name: z.string().describe("Skill folder name or pack/name from list_skills"),
        workspacePath: workspacePathField,
      },
    },
    async (args) => {
      try {
        const ws = session.resolveWorkspace(args.workspacePath)
        const skills = listSkillFiles(ws)
        const needle = args.name.replace(/^\.\w+\//, "")
        const match =
          skills.find((s) => s.name === args.name || s.name.endsWith(`/${needle}`) || s.name === needle) ??
          skills.find((s) => s.name.includes(needle))
        if (!match) {
          return textResult({ ok: false, error: `Skill not found: ${args.name}`, available: skills.map((s) => s.name) }, true)
        }
        return textResult({
          ok: true,
          name: match.name,
          uri: match.uri,
          markdown: readFileSync(match.filePath, "utf8"),
        })
      } catch (error) {
        return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
      }
    },
  )

  server.registerTool(
    "spinosa_gate",
    {
      title: "Evidence gate",
      description:
        "Evaluate evidence-sufficiency coverage counts for a Spinosa coverage contract. Deterministic arithmetic — not an LLM judgment.",
      inputSchema: {
        coverage: z.enum(["opportunistic", "sufficient", "representative", "exhaustive"]),
        sourceCount: z.number(),
        strataCovered: z.number().optional(),
        strataTotal: z.number().optional(),
        partitionsAccounted: z.number().optional(),
        partitionsTotal: z.number().optional(),
        workspacePath: workspacePathField,
      },
    },
    async (args) => {
      try {
        session.resolveWorkspace(args.workspacePath)
        const { workspacePath: _w, ...gateArgs } = args
        return textResult(spinosaGate(gateArgs))
      } catch (error) {
        return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
      }
    },
  )

  server.registerTool(
    "spinosa_verify",
    {
      title: "Verify artifact shape",
      description:
        "Mechanically verify a workspace artifact (existence, structure, verification-status mapping). Not quote-level truth against sources.",
      inputSchema: {
        relativePath: z.string().describe("Path relative to the workspace root"),
        validator: z.enum(VERIFY_VALIDATORS),
        runID: z.string().optional(),
        workspacePath: workspacePathField,
      },
    },
    async (args) => {
      try {
        const ws = session.resolveWorkspace(args.workspacePath)
        return textResult(
          await spinosaVerify({
            workspacePath: ws,
            relativePath: args.relativePath,
            validator: args.validator,
            ...(args.runID ? { runID: args.runID } : {}),
          }),
        )
      } catch (error) {
        return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
      }
    },
  )

  server.registerTool(
    "spinosa_figure",
    {
      title: "Render markdown figure",
      description: "Build a Spinosa markdown figure block (bar, sparkline, stacked_bar, status_matrix) for reports.",
      inputSchema: {
        kind: z.enum(["bar", "sparkline", "stacked_bar", "status_matrix"]),
        title: z.string(),
        caption: z.string(),
        source: z.string(),
        units: z.string(),
        items: z.array(z.object({ label: z.string(), value: z.number() })).optional(),
        values: z.array(z.number()).optional(),
        label: z.string().optional(),
        segments: z.array(z.object({ label: z.string(), value: z.number() })).optional(),
        columns: z.array(z.string()).optional(),
        rows: z
          .array(
            z.object({
              label: z.string(),
              cells: z.array(z.enum(["pass", "warning", "fail", "pending", "active"])),
            }),
          )
          .optional(),
        workspacePath: workspacePathField,
      },
    },
    async (args) => {
      try {
        session.resolveWorkspace(args.workspacePath)
        const base = {
          title: args.title,
          caption: args.caption,
          source: args.source,
          units: args.units,
        }
        if (args.kind === "bar") {
          return textResult(spinosaFigure({ kind: "bar", ...base, items: args.items ?? [] }))
        }
        if (args.kind === "sparkline") {
          return textResult(
            spinosaFigure({
              kind: "sparkline",
              ...base,
              values: args.values ?? [],
              ...(args.label ? { label: args.label } : {}),
            }),
          )
        }
        if (args.kind === "stacked_bar") {
          return textResult(spinosaFigure({ kind: "stacked_bar", ...base, segments: args.segments ?? [] }))
        }
        return textResult(
          spinosaFigure({
            kind: "status_matrix",
            ...base,
            columns: args.columns ?? [],
            rows: args.rows ?? [],
          }),
        )
      } catch (error) {
        return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
      }
    },
  )

  server.registerTool(
    "spinosa_map",
    {
      title: "Workspace map ops",
      description:
        "Deterministic mapping aid: begin, write_extraction, write_map, check, or cover. You still supply summaries and quotes.",
      inputSchema: {
        action: z.enum(["begin", "write_extraction", "write_map", "check", "cover"]),
        batchId: z.string().optional(),
        files: z.array(z.string()).optional(),
        mapPath: z.string().optional(),
        mapKind: z.enum(["hub", "group", "theme"]).optional(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        body: z.string().optional(),
        links: z.array(z.string()).optional(),
        mode: z.enum(["create", "replace", "enrich"]).optional(),
        relativePath: z.string().optional(),
        packets: z
          .array(
            z.object({
              filename: z.string(),
              path: z.string(),
              sourceType: z.string().optional(),
              language: z.string().optional(),
              summary: z.string().optional(),
              passages: z
                .array(z.object({ quote: z.string(), path: z.string().optional(), lines: z.string().optional() }))
                .optional(),
              concepts: z.array(z.string()).optional(),
              tags: z.array(z.string()).optional(),
              connections: z.array(z.string()).optional(),
              status: z.enum(["extracted", "unreadable"]).optional(),
            }),
          )
          .optional(),
        workspacePath: workspacePathField,
      },
    },
    async (args) => {
      try {
        const ws = session.resolveWorkspace(args.workspacePath)
        const { workspacePath: _w, ...rest } = args
        return textResult(await spinosaMap({ workspacePath: ws, ...rest }))
      } catch (error) {
        return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
      }
    },
  )

  if (session.currentWorkspace) refreshResources(session.currentWorkspace)

  return { server, session }
}

interface McpServerArgs {
  workspace?: string
}

export const McpServerCommand = {
  command: "mcp-server",
  describe:
    "MCP stdio server for external agents: list/select workspaces, then Spinosa tools and skills (you stay the LLM)",
  builder: (yargs: Argv) =>
    yargs.option("workspace", {
      describe: "Optional initial workspace (otherwise start unbound; use workspace_use)",
      type: "string",
    }),
  handler: async (args: McpServerArgs) => {
    const initial =
      args.workspace?.trim() ||
      process.env.SPINOSA_WORKSPACE?.trim() ||
      (isSpinosaWorkspace(process.cwd()) ? process.cwd() : null)
    const { server } = await createSpinosaMcpServer({ initialWorkspace: initial })
    const transport = new StdioServerTransport()
    await server.connect(transport)
    // Keep the CLI process alive until the MCP client closes stdin.
    // cli-main's finally block calls process.exit() once this handler returns.
    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        resolve()
      }
      transport.onclose = done
      process.stdin.on("end", done)
      process.stdin.on("close", done)
    })
  },
} satisfies CommandModule<object, McpServerArgs>
