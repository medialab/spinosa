import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@spinosa/kernel-core/installation/version"
import { FormatError } from "./cli/error"
import { EOL } from "os"
import { dumpErrorChain, errorMessage } from "./util/error"
import { Heap } from "./cli/heap"
import { bootLog } from "@spinosa/kernel-core/observability/boot-log"
import {
  bootstrapBinaryRuntime,
  isCompiledBinaryDistribution,
  registerEmbeddedTemplatePack,
} from "@spinosa/core/distribution/bootstrap"
import { registerLazyCommands } from "./cli/command-catalog"

const args = hideBin(process.argv)
const { pid, ppid } = process

// Fast path for --help: skip template bootstrap and Heap init. `--version` is
// handled in index.ts before this module loads.
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

if (!isFastPath && isCompiledBinaryDistribution()) {
  try {
    const packMod = await import("./generated/template-pack.gen.ts")
    registerEmbeddedTemplatePack(() => packMod.templatePack as never)
  } catch (error) {
    bootLog("kernel.template", "embedded template pack unavailable", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const cmd = args.find((arg) => !arg.startsWith("-"))
  const needsTemplatesNow = Boolean(
    cmd && ["new", "create", "add", "update", "import", "status"].includes(cmd),
  )
  const runTemplateBoot = () => {
    const boot = bootstrapBinaryRuntime()
    if (boot && !boot.ok) {
      bootLog("kernel.template", "template bootstrap failed", { error: boot.error })
    }
  }
  if (needsTemplatesNow) runTemplateBoot()
  else setImmediate(runTemplateBoot)
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

registerLazyCommands(cli)
  // Eliminated: StatsCommand, ConsoleCommand, ServeCommand (duplicate of web), ExportCommand, ImportCommand, PrCommand, SessionCommand, PluginCommand — not registered; yargs completion disabled
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
  const chain = dumpErrorChain(e)
  bootLog("kernel.error", "unhandled error", { error: String(e), chain })
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
    process.stderr.write(chain + EOL)
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
