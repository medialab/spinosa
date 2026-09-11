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
import { ensureBundledToolsEnv } from "@spinosa/core/distribution/tools"

const args = hideBin(process.argv)
const { pid, ppid } = process

// Fast path for --help/--version: skip template bootstrap and Heap init (~400ms preload still paid, but bootstrap+Heap skipped)
const isFastPath =
  args.includes("-h") ||
  args.includes("--help") ||
  args.includes("-v") ||
  args.includes("--version") ||
  args[0] === "version" ||
  args[0] === "help"

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

// Bundled OCR tools ($SPINOSA_HOME/tools/<platform>/bin) take PATH precedence
// on every startup — dev and binary alike — so tesseract/pdftoppm resolve
// deterministically. Microsecond-cheap after first call; runs before the fast
// path so even --version-adjacent probes see the same resolution.
try {
  ensureBundledToolsEnv()
} catch (error) {
  bootLog("kernel.tools", "bundled tools env unavailable", {
    error: error instanceof Error ? error.message : String(error),
  })
}

if (!isFastPath && isCompiledBinaryDistribution()) {  try {
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

    if (isFastPath) {
      process.env.AGENT = "1"
      process.env.SPINOSA = "1"
      process.env.SPINOSA_PID = String(process.pid)
      return
    }

    Heap.start()

    process.env.AGENT = "1"
    process.env.SPINOSA = "1"
    process.env.SPINOSA_PID = String(process.pid)
  })
  .usage("")
  // --- Curated Spinosa help: keep core workflow visible, hide advanced, eliminate opencode fork internals ---
  // Visible (13): TUI default + new/add/update/status/list/doctor/providers/models/agent/upgrade/uninstall/version
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
  .command(VersionCommand)
  // Keep but hide from main help (still callable via `spinosa <cmd> --help`): advanced/debug
  .command({ ...AttachCommand, describe: false } as any)
  .command({ ...RunCommand, describe: false } as any)
  .command({ ...DebugCommand, describe: false } as any)
  .command({ ...GenerateCommand, describe: false } as any)
  .command({ ...DbCommand, describe: false } as any)
  .command({ ...PreflightCommand, describe: false } as any)
  .command({ ...StartupAutocleanCommand, describe: false } as any)
  .command({ ...InternalCommand, describe: false } as any)
  // Eliminated: StatsCommand, TuiThreadCommand, ConsoleCommand, ServeCommand (duplicate of web), ExportCommand, ImportCommand, PrCommand, SessionCommand, PluginCommand — not registered; yargs completion disabled
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
