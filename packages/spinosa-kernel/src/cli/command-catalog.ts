import type { Argv } from "yargs"

export type LazyCommandSpec = {
  command: string
  describe: string | false
  aliases?: string[]
  hidden?: boolean
  load: () => Promise<any>
}

export const CLI_COMMAND_CATALOG: readonly LazyCommandSpec[] = [
  {
    command: "$0 [project]",
    describe: "start the Spinosa TUI",
    load: () => import("./cmd/tui-entry").then((mod) => mod.TuiThreadCommand),
  },
  {
    command: "new <source>",
    describe: "Create a new Spinosa workspace from a source directory",
    aliases: ["create"],
    load: () => import("./cmd/workspace-new").then((mod) => mod.WorkspaceNewCommand),
  },
  {
    command: "add [source]",
    describe: "Add files or directories to a Spinosa workspace",
    load: () => import("./cmd/workspace-add").then((mod) => mod.WorkspaceAddCommand),
  },
  {
    command: "update [workspace]",
    describe: "Update a workspace snapshot",
    load: () =>
      import("./cmd/workspace-update").then((mod) => mod.WorkspaceUpdateCommand),
  },
  {
    command: "status [workspace]",
    describe: "Show workspace and framework status",
    load: () =>
      import("./cmd/workspace-status").then((mod) => mod.WorkspaceStatusCommand),
  },
  {
    command: "list",
    describe: "List all Spinosa workspaces",
    load: () => import("./cmd/workspace-list").then((mod) => mod.WorkspaceListCommand),
  },
  {
    command: "delete <path>",
    describe: "Delete a Spinosa workspace (trash if present; unregister). Requires --yes",
    aliases: ["rm"],
    load: () => import("./cmd/workspace-delete").then((mod) => mod.WorkspaceDeleteCommand),
  },
  {
    command: "doctor",
    describe: "Diagnose Spinosa framework and workspace health",
    load: () => import("./cmd/doctor").then((mod) => mod.DoctorCommand),
  },
  {
    command: "providers",
    describe: "manage AI providers and credentials",
    aliases: ["auth"],
    load: () => import("./cmd/providers").then((mod) => mod.ProvidersCommand),
  },
  {
    command: "agent",
    describe: "manage agents",
    load: () => import("./cmd/agent").then((mod) => mod.AgentCommand),
  },
  {
    command: "mcp <action> [id]",
    describe: "Browse and install curated third-party MCP servers for researchers",
    load: () => import("./cmd/mcp").then((mod) => mod.McpCommand),
  },
  {
    command: "mcp-server",
    describe: "MCP stdio: list/select workspaces, then Spinosa tools and skills (outer agent is the LLM)",
    load: () => import("./cmd/mcp-server").then((mod) => mod.McpServerCommand),
  },
  {
    command: "upgrade [target]",
    describe: "check for and install Spinosa updates",
    load: () => import("./cmd/upgrade").then((mod) => mod.UpgradeCommand),
  },
  {
    command: "uninstall",
    describe: "remove the Spinosa framework runtime and selected application data",
    load: () => import("./cmd/uninstall").then((mod) => mod.UninstallCommand),
  },
  {
    command: "models [provider]",
    describe: "list all available models",
    load: () => import("./cmd/models").then((mod) => mod.ModelsCommand),
  },
  {
    command: "version",
    describe: "Show the installed Spinosa version",
    load: () => import("./cmd/version").then((mod) => mod.VersionCommand),
  },
  {
    command: "attach <url>",
    describe: false,
    hidden: true,
    load: () => import("./cmd/attach").then((mod) => mod.AttachCommand),
  },
  {
    command: "run [message..]",
    describe: false,
    hidden: true,
    load: () => import("./cmd/run").then((mod) => mod.RunCommand),
  },
  {
    command: "debug",
    describe: false,
    hidden: true,
    load: () => import("./cmd/debug").then((mod) => mod.DebugCommand),
  },
  {
    command: "generate",
    describe: false,
    hidden: true,
    load: () => import("./cmd/generate").then((mod) => mod.GenerateCommand),
  },
  {
    command: "db",
    describe: false,
    hidden: true,
    load: () => import("./cmd/db").then((mod) => mod.DbCommand),
  },
  {
    command: "preflight",
    describe: false,
    hidden: true,
    load: () => import("./cmd/preflight").then((mod) => mod.PreflightCommand),
  },
  {
    command: "startup-autoclean",
    describe: false,
    aliases: ["autoclean"],
    hidden: true,
    load: () =>
      import("./cmd/startup-autoclean").then((mod) => mod.StartupAutocleanCommand),
  },
  {
    command: "internal",
    describe: false,
    hidden: true,
    load: () => import("./cmd/internal").then((mod) => mod.InternalCommand),
  },
]

export function registerLazyCommands(cli: Argv): Argv {
  for (const spec of CLI_COMMAND_CATALOG) {
    cli.command({
      command: spec.command,
      describe: spec.hidden ? false : spec.describe,
      aliases: spec.aliases,
      builder: async (yargs: Argv) => {
        const mod = await spec.load()
        if (!mod.builder) return yargs
        return mod.builder(yargs)
      },
      handler: async (argv: unknown) => {
        const mod = await spec.load()
        if (!mod.handler) return
        await mod.handler(argv)
      },
    } as never)
  }
  return cli
}
