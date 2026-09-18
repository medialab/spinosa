import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "../tui/worker"
import { existsSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { dumpErrorChain, errorMessage } from "@spinosa/tui/util/error"
import { isCompiledBinaryDistribution } from "@spinosa/core/distribution/bootstrap"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig, hasArg } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { GlobalEvent } from "@spinosa/sdk/v2"
import type { EventSource } from "@spinosa/tui/context/sdk"
import { writeHeapSnapshot } from "v8"
import { ServerAuth } from "@/server/auth"
import { validateSession } from "../tui/validate-session"
import { win32InstallCtrlCGuard } from "@spinosa/tui/terminal-win32"
import { bootLog, bootLogError } from "@spinosa/kernel-core/observability/boot-log"
import { Flag } from "@spinosa/kernel-core/flag/flag"
import { describeWorkerCallError, TUI_WORKER_FETCH_MS, waitForWorkerReady, formatWorkerFailureForParent, parentActionForWorkerFailure, shouldWriteWorkerFailureToStderr, isRecoverableWorkerFailure, type TuiWorkerPhase } from "../tui/worker-boot"
import {
  printLaunchingTui,
  runLaunchPreflight,
} from "@spinosa/core/commands/preflight"
import { isSpinosaWorkspace } from "@spinosa/core/workspace/meta"
import { advertisedOpenCodeVersion, syncOpenCodeCompatVersion } from "@spinosa/kernel-core/installation/opencode-compat"
import { runOverlappedLaunch } from "../tui/launch-overlap"

declare global {
  const SPINOSA_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    let result: { status: number; headers: Record<string, string>; body: string }
    try {
      result = await withTimeout(
        client.call("fetch", {
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          body,
        }),
        TUI_WORKER_FETCH_MS,
        "TUI worker request timed out",
      )
    } catch (error) {
      throw describeWorkerCallError(error)
    }
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    subscribe: async (handler) => {
      return client.on<GlobalEvent>("global.event", (e) => {
        handler(e)
      })
    },
  }
}

function createPublishJobEvent(client: RpcClient) {
  return (input: Parameters<(typeof rpc)["emitJobEvent"]>[0]) => {
    void client.call("emitJobEvent", input)
  }
}

async function target() {
  if (typeof SPINOSA_WORKER_PATH !== "undefined") return SPINOSA_WORKER_PATH
  const dist = new URL("./cli/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("../tui/worker.ts", import.meta.url)
}

async function input(value?: string) {
  let piped: string | undefined
  if (!process.stdin.isTTY && process.stdin.readableLength > 0) {
    piped = await Bun.stdin.text()
  }
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

/** True when `dir` looks like a Spinosa framework/install root (not a user project). */
export function isSpinosaFrameworkRoot(dir: string) {
  const resolved = Filesystem.resolve(dir)
  const template = process.env.SPINOSA_TEMPLATE_ROOT
  if (template && Filesystem.resolve(template) === resolved) return true
  // Install / monorepo layout: kernel entry lives under packages/spinosa-kernel.
  return existsSync(path.join(resolved, "packages", "spinosa-kernel", "src", "index.ts"))
}

/**
 * Resolve the directory the TUI should open.
 *
 * Relative `--project` paths resolve from PWD (symlink-friendly invocation path).
 * With no project, prefer real `cwd` — except when Bun was launched with
 * `--cwd <frameworkRoot>` for OpenTUI preload: then `process.cwd()` is the
 * install tree while PWD is still the caller's project. Prefer PWD in that case
 * so the TUI does not chdir into `~/.spinosa/versions/...`.
 */
export function resolveThreadDirectory(project?: string, envPWD = process.env.PWD, cwd = process.cwd()) {
  const root = Filesystem.resolve(envPWD ?? cwd)
  if (project) return Filesystem.resolve(path.isAbsolute(project) ? project : path.join(root, project))
  const resolvedCwd = Filesystem.resolve(cwd)
  if (envPWD && isSpinosaFrameworkRoot(resolvedCwd) && !isSpinosaFrameworkRoot(envPWD)) {
    return Filesystem.resolve(envPWD)
  }
  return resolvedCwd
}

/**
 * Auto-route a `--session` continue to the session's own directory.
 * Sessions are stored globally, but file tools, editors, and workspace
 * scoping all root at the process directory — so continuing `ses_X` from an
 * unrelated cwd silently operates on the wrong tree. An explicit `--project`
 * always wins; otherwise the session record's directory is authoritative.
 * Missing/blank/relative values fall back to the current directory (relative
 * paths resolve against it — session directories are absolute in practice).
 */
export function resolveSessionDirectory(input: {
  explicitProject?: string
  currentDirectory: string
  sessionDirectory?: string
}): string {
  if (input.explicitProject) return input.currentDirectory
  const dir = input.sessionDirectory?.trim()
  if (!dir) return input.currentDirectory
  return path.isAbsolute(dir)
    ? Filesystem.resolve(dir)
    : Filesystem.resolve(path.join(input.currentDirectory, dir))
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start the Spinosa TUI",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start Spinosa in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue (project auto-detected when omitted)",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("mini", {
        type: "boolean",
        describe: "start the minimal interactive interface",
        default: false,
      })
      .option("replay", {
        type: "boolean",
        hidden: true,
      })
      .option("no-replay", {
        type: "boolean",
        describe: "disable mini session history replay on resume and after resize",
      })
      .option("replay-limit", {
        type: "number",
        describe: "cap visible mini replay to the newest N messages",
      })
      .option("demo", {
        type: "boolean",
        hidden: true,
      }),
  handler: async (args) => {
    const t0 = Date.now()
    bootLog("tui.handler", "TUI command handler started")
    if (args.replay === true) {
      UI.error("--replay is not supported; replay is enabled by default")
      process.exitCode = 1
      return
    }
    const noReplay = args.replay === false || args.noReplay === true

    if (args.mini) {
      const network = ["--port", "--hostname", "--mdns", "--no-mdns", "--mdns-domain", "--cors"].find((option) =>
        process.argv.some((arg) => arg === option || arg.startsWith(option + "=")),
      )
      if (network) {
        UI.error(`${network} cannot be used with --mini`)
        process.exitCode = 1
        return
      }

      const { runMini } = await import("./run")
      await runMini({
        directory: resolveThreadDirectory(args.project),
        continue: args.continue,
        session: args.session,
        fork: args.fork,
        model: args.model,
        agent: args.agent,
        prompt: args.prompt,
        replay: noReplay ? false : undefined,
        replayLimit: args.replayLimit,
        demo: args.demo,
      })
      return
    }

    const unsupported = [
      ["--no-replay", noReplay],
      ["--replay-limit", args.replayLimit !== undefined],
      ["--demo", args.demo !== undefined],
    ].find((entry) => entry[1])?.[0]
    if (unsupported) {
      UI.error(`${unsupported} requires --mini`)
      process.exitCode = 1
      return
    }

    const unguard = win32InstallCtrlCGuard()
    try {
      const { TuiConfig } = await import("@/config/tui")
      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      // Resolve relative --project paths from PWD, then use the real cwd after
      // chdir so the thread and worker share the same directory key.
      const next = resolveThreadDirectory(args.project)
      const file = await target()
      const workerPath = typeof file === "string" ? file : file.href
      const workerOnDisk = typeof file === "string" ? existsSync(file) : existsSync(fileURLToPath(file))
      bootLog("tui.worker.target", "resolved worker target", {
        path: workerPath,
        cwd: next,
        compiled: isCompiledBinaryDistribution(),
        defined: typeof SPINOSA_WORKER_PATH !== "undefined",
        onDisk: workerOnDisk,
        importMeta: import.meta.url,
        bunfs: typeof file === "string" && file.includes("bunfs"),
      })
      try {
        process.chdir(next)
      } catch (error) {
        bootLogError("tui.chdir", error)
        UI.error("Failed to change directory")
        return
      }
      let cwd = Filesystem.resolve(process.cwd())

      type SpawnedWorker = {
        worker: Worker
        client: RpcClient
        stop: () => Promise<void>
        ready: Promise<void>
        setRunning: () => void
        phase: () => TuiWorkerPhase
      }

      const spawnWorker = (): SpawnedWorker => {
        const worker = new Worker(file)
        const client = Rpc.client<typeof rpc>(worker)
        let workerPhase: TuiWorkerPhase = "boot"
        const isolateWorkerFailure = (error: unknown) => {
          const message = formatWorkerFailureForParent(error)
          bootLog("tui.worker.error", "worker error event", { message, phase: workerPhase })
          if (shouldWriteWorkerFailureToStderr(workerPhase)) {
            process.stderr.write(`TUI worker error event: ${message}\n`)
          }
          client.failAll(new Error(message))
          return parentActionForWorkerFailure(workerPhase)
        }
        worker.addEventListener("error", (event) => {
          isolateWorkerFailure(event.error ?? event.message)
        })
        worker.addEventListener("messageerror", (event) => {
          bootLog("tui.worker.messageerror", "worker message deserialize failed", { data: String(event.data) })
        })
        bootLog("tui.worker.created", "background worker spawned", { pid: process.pid })
        const reload = () => {
          client.call("reload", undefined).catch(() => {})
        }
        process.on("SIGUSR2", reload)

        let stopped = false
        const stop = async () => {
          if (stopped) return
          stopped = true
          process.off("SIGUSR2", reload)
          await withTimeout(client.call("shutdown", undefined), 5000).catch(() => {})
          worker.terminate()
        }

        const ready = waitForWorkerReady({
          ping: () => client.call("ping", undefined),
          attachError: (handler) => {
            const listener = (event: ErrorEvent) => handler(event.error ?? event.message)
            worker.addEventListener("error", listener)
            return () => worker.removeEventListener("error", listener)
          },
        })

        return {
          worker,
          client,
          stop,
          ready,
          setRunning: () => {
            workerPhase = "running"
          },
          phase: () => workerPhase,
        }
      }

      // Console reads the worker's User-Agent. Set the floor (and npm latest
      // when reachable) before spawn so the child inherits it.
      try {
        const compat = await syncOpenCodeCompatVersion()
        bootLog("tui.boot.opencode", "console user-agent ready", {
          version: compat.version,
          source: compat.source,
          advertised: advertisedOpenCodeVersion(),
        })
      } catch (error) {
        bootLogError("tui.boot.opencode", error)
      }

      // Spawn the worker during the update check. An accepted upgrade still
      // stops the worker so the previous install does not keep running.
      let spawned: SpawnedWorker
      try {
        const overlapped = await runOverlappedLaunch({
          skipPreflight: Flag.SPINOSA_DISABLE_AUTOUPDATE,
          spawn: spawnWorker,
          stop: (item) => item.stop(),
          preflight: async () => {
            const targetWorkspace = isSpinosaWorkspace(cwd) ? cwd : undefined
            return runLaunchPreflight(undefined, { targetWorkspace })
          },
        })
        if (overlapped.status === "exit") {
          process.exit(0)
          return
        }
        spawned = overlapped.worker
      } catch (error) {
        bootLogError("tui.preflight", error)
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exit(1)
        return
      }

      const { client, stop } = spawned
      let workerPhase: TuiWorkerPhase = spawned.phase()

      try {
        await spawned.ready
        bootLog("tui.worker.ready", "worker ping succeeded")
        spawned.setRunning()
        workerPhase = "running"
      } catch (error) {
        bootLog("tui.worker.ready.error", "worker failed to start", { detail: dumpErrorChain(error) })
        UI.error(errorMessage(error))
        await stop()
        process.exitCode = 1
        return
      }

      const prompt = await input(args.prompt)

      printLaunchingTui()

      bootLog("tui.config.start", "loading TuiConfig.get()", { cwd })
      let config: Awaited<ReturnType<typeof TuiConfig.get>>
      try {
        config = await TuiConfig.get()
        bootLog("tui.config.done", "TuiConfig.get() returned")
      } catch (error) {
        bootLog("tui.config.error", "TuiConfig.get() failed", { detail: dumpErrorChain(error) })
        throw error
      }

      const network = resolveNetworkOptionsNoConfig(args)
      const external = hasArg("--port") || hasArg("--hostname") || network.mdns === true
      bootLog("tui.network", "network options resolved", { external, mdns: network.mdns, port: network.port })

      const headers = external ? ServerAuth.headers() : undefined

      const transport = external
        ? {
            url: (await client.call("server", network)).url,
            fetch: undefined,
            events: undefined,
            headers,
          }
        : {
      url: "http://spinosa.internal",
            fetch: createWorkerFetch(client),
            events: createEventSource(client),
          }

      bootLog("tui.transport", "transport configured", {
        external,
        url: transport.url,
      })

      let validatedSessionDirectory: string | undefined
      try {
        const validated = await validateSession({
          url: transport.url,
          sessionID: args.session,
          directory: cwd,
          fetch: transport.fetch,
          headers,
        })
        validatedSessionDirectory = validated.directory
        bootLog("tui.session", "session validated", { sessionID: args.session ?? undefined })
      } catch (error) {
        bootLog("tui.session.error", "session validation failed", { error: String(error) })
        UI.error(errorMessage(error))
        process.exitCode = 1
        return
      }

      // Auto-route: `spinosa -s ses_X` with no explicit project continues in
      // the session's own directory instead of the invocation cwd. A deleted
      // session directory falls back to cwd (never fatal — the TUI still
      // bounces unknown sessions Home as before).
      if (args.session && !args.project && validatedSessionDirectory) {
        const routed = resolveSessionDirectory({ currentDirectory: cwd, sessionDirectory: validatedSessionDirectory })
        if (routed !== cwd) {
          try {
            process.chdir(routed)
            cwd = Filesystem.resolve(process.cwd())
            bootLog("tui.session.routed", "session auto-routed to its directory", {
              sessionID: args.session,
              directory: cwd,
            })
          } catch (error) {
            bootLog("tui.session.route.error", "session auto-route failed, staying in cwd", {
              error: String(error),
            })
          }
        }
      }

      try {
        const elapsed = Date.now() - t0
        bootLog("tui.run.start", "calling Tui.run via Effect.runPromise", {
          elapsedMs: elapsed,
          directory: cwd,
        })
        const { Effect } = await import("effect")
        const { run } = await import("../tui/layer")
        const { createLegacyTuiPluginHost } = await import("@/plugin/tui/runtime")
        await Effect.runPromise(
          run({
            url: transport.url,
            async onSnapshot() {
              const tui = writeHeapSnapshot("tui.heapsnapshot")
              const server = await client.call("snapshot", undefined)
              return [tui, server]
            },
            config,
            pluginHost: createLegacyTuiPluginHost(),
            directory: cwd,
            fetch: transport.fetch,
            headers: transport.headers,
            events: transport.events,
            publishJobEvent: createPublishJobEvent(client),
            args: {
              continue: args.continue,
              sessionID: args.session,
              agent: args.agent,
              model: args.model,
              prompt,
              fork: args.fork,
              auto: args.auto || args.yolo || args["dangerously-skip-permissions"],
              spinosa: !!process.env.SPINOSA_TEMPLATE_ROOT,
            },
          }),
        )
        bootLog("tui.run.done", "Tui.run completed", {
          totalMs: Date.now() - t0,
        })
      } catch (error) {
        bootLog("tui.run.error", "Tui.run failed", { detail: errorMessage(error) })
        if (workerPhase === "running" && isRecoverableWorkerFailure(error)) {
          UI.error(errorMessage(describeWorkerCallError(error)))
          return
        }
        throw error
      } finally {
        await stop()
      }
    } finally {
      try {
        unguard?.()
      } catch {}
    }
    process.exit(0)
  },
})
