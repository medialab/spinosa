import "@opentui/solid/preload"
// Prefer the launcher helper (`buildKernelBunArgv` / bash `exec_kernel`) which
// passes `bun --cwd <root> --preload @opentui/solid/preload <entry>`.
// A static import alone is not reliable under ESM hoisting, and
// `bun --preload X run file` dumps Bun's help menu instead of starting Spinosa.
// Without the OpenTUI Solid transform, JSX becomes DOM VNodes → blank TUI.
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { ProvidersCommand } from "./cli/cmd/providers"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { PreflightCommand } from "./cli/cmd/preflight"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@spinosa/kernel-core/installation/version"
import { FormatError } from "./cli/error"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { AttachCommand } from "./cli/cmd/attach"
import { TuiThreadCommand } from "./cli/cmd/tui"
import { EOL } from "os"
import { DbCommand } from "./cli/cmd/db"
import { errorMessage } from "./util/error"
import { WorkspaceNewCommand } from "./cli/cmd/workspace-new"
import { WorkspaceAddCommand } from "./cli/cmd/workspace-add"
import { WorkspaceUpdateCommand } from "./cli/cmd/workspace-update"
import { WorkspaceStatusCommand } from "./cli/cmd/workspace-status"
import { WorkspaceListCommand } from "./cli/cmd/workspace-list"
import { DoctorCommand } from "./cli/cmd/doctor"
import { StartupAutocleanCommand } from "./cli/cmd/startup-autoclean"
import { VersionCommand } from "./cli/cmd/version"
import { InternalCommand } from "./cli/cmd/internal"
import { Heap } from "./cli/heap"
import { bootLog } from "@spinosa/kernel-core/observability/boot-log"
import {
  bootstrapBinaryRuntime,
  isCompiledBinaryDistribution,
  registerEmbeddedTemplatePack,
} from "@spinosa/core/distribution/bootstrap"

const args = hideBin(process.argv)
const { pid, ppid } = process

bootLog("kernel.init", "kernel entry parsing args", {
  argv: args.join(" "),
  cwd: process.cwd(),
  pid,
  ppid,
  SPINOSA_TEMPLATE_ROOT: process.env.SPINOSA_TEMPLATE_ROOT ?? undefined,
  SPINOSA_PRODUCT: process.env.SPINOSA_PRODUCT ?? undefined,
  SPINOSA_HOME: process.env.SPINOSA_HOME ?? undefined,
  SPINOSA_PRINT_LOGS: process.env.SPINOSA_PRINT_LOGS ?? undefined,
  SPINOSA_LOG_LEVEL: process.env.SPINOSA_LOG_LEVEL ?? undefined,
  BUN_VERSION: process.env.BUN_VERSION ?? undefined,
})

if (isCompiledBinaryDistribution()) {
  try {
    const packMod = await import("./generated/template-pack.gen.ts")
    registerEmbeddedTemplatePack(() => packMod.templatePack as never)
  } catch (error) {
    bootLog("kernel.template", "embedded template pack unavailable", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const boot = bootstrapBinaryRuntime()
  if (boot && !boot.ok) {
    bootLog("kernel.template", "template bootstrap failed", { error: boot.error })
  }
}

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("spinosa ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("spinosa")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("verbose", {
    describe: "print boot diagnostics to stderr",
    type: "boolean",
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.printLogs) process.env.SPINOSA_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.SPINOSA_LOG_LEVEL = opts.logLevel
    if (opts.verbose) process.env.SPINOSA_VERBOSE_BOOT = "1"
    if (opts.pure) {
      process.env.SPINOSA_PURE = "1"
    }

    Heap.start()

    process.env.AGENT = "1"
    process.env.SPINOSA = "1"
    process.env.SPINOSA_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  // --- Curated Spinosa help: keep core workflow visible, hide advanced, eliminate opencode fork internals ---
  // Visible (14): TUI default + new/add/update/status/list/doctor/providers/models/agent/upgrade/uninstall/stats/version
  .command(TuiThreadCommand)
  .command(WorkspaceNewCommand)
  .command(WorkspaceAddCommand)
  .command(WorkspaceUpdateCommand)
  .command(WorkspaceStatusCommand)
  .command(WorkspaceListCommand)
  .command(DoctorCommand)
  .command(ProvidersCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(VersionCommand)
  // Keep but hide from main help (still callable via `spinosa <cmd> --help`): advanced/debug
  .command({ ...McpCommand, describe: false } as any)
  .command({ ...AttachCommand, describe: false } as any)
  .command({ ...RunCommand, describe: false } as any)
  .command({ ...DebugCommand, describe: false } as any)
  .command({ ...GenerateCommand, describe: false } as any)
  .command({ ...DbCommand, describe: false } as any)
  .command({ ...PreflightCommand, describe: false } as any)
  .command({ ...StartupAutocleanCommand, describe: false } as any)
  .command({ ...InternalCommand, describe: false } as any)
  // Eliminated: TuiThreadCommand, ConsoleCommand, ServeCommand (duplicate of web), ExportCommand, ImportCommand, PrCommand, SessionCommand, PluginCommand — not registered
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    bootLog("kernel.help", "showing help")
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    bootLog("kernel.parse", "parsing yargs command")
    await cli.parse()
    bootLog("kernel.parse.done", "yargs command finished")
  }
} catch (e) {
  bootLog("kernel.error", "unhandled error", { error: String(e) })
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  bootLog("kernel.exit", "exiting process")
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
