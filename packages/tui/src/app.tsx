import { bootLog } from "@spinosa/kernel-core/observability/boot-log"
import { render, TimeToFirstDraw, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { Deferred, Effect } from "effect"
import { Global } from "@spinosa/kernel-core/global"
import { Flag } from "@spinosa/kernel-core/flag/flag"
import { InstallationVersion } from "@spinosa/kernel-core/installation/version"
import { ClipboardProvider, useClipboard } from "./context/clipboard"
import { ExitProvider, useExit } from "./context/exit"
import { EpilogueProvider } from "./context/epilogue"
import * as Selection from "./util/selection"
import { createCliRenderer, MouseButton } from "@opentui/core"
import { RouteProvider, useRoute } from "./context/route"
import {
  createEffect,
  createMemo,
  ErrorBoundary,
  createSignal,
  onMount,
  onCleanup,
  batch,
  Show,
  on,
  type ParentProps,
} from "solid-js"
import { TuiPathsProvider, TuiStartupProvider, TuiTerminalEnvironmentProvider, useTuiStartup } from "./context/runtime"
import { DialogProvider, useDialog } from "./ui/dialog"
import { DialogProvider as DialogProviderList } from "./component/dialog-provider"
import { ErrorComponent } from "./component/error-component"
import { PluginRouteMissing } from "./component/plugin-route-missing"
import { ProjectProvider, useProject } from "./context/project"
import { EditorContextProvider } from "./context/editor"
import { useEvent } from "./context/event"
import { SDKProvider, useSDK } from "./context/sdk"
import { StartupLoading } from "./component/startup-loading"
import { ConversationLoading } from "./component/conversation-loading"
import { SyncProvider, useSync } from "./context/sync"
import { DataProvider } from "./context/data"
import { LocationProvider } from "./context/location"
import { LocalProvider, useLocal } from "./context/local"
import { PermissionProvider } from "./context/permission"
import { DialogModel } from "./component/dialog-model"
import { useConnected } from "./component/use-connected"
import { DialogMcp } from "./component/dialog-mcp"
import { DialogStatus } from "./component/dialog-status"
import { DialogThemeList } from "./component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { DialogAgent } from "./component/dialog-agent"
import { DialogSessionList } from "./component/dialog-session-list"
import { DialogWorkspaceList } from "./component/dialog-workspace-list"
import { DialogSpinosaMissingWorkspace } from "./component/dialog-spinosa-missing-workspace"
import { DialogSpinosaWorkspacePicker } from "./component/dialog-spinosa-workspace-picker"
import { DialogConsoleOrg } from "./component/dialog-console-org"
import { ThemeProvider, useTheme } from "./context/theme"
import { Home } from "./routes/home"
import { Session } from "./routes/session"

import { SpinosaWorkspaceProvider, useSpinosaWorkspace } from "./context/spinosa-workspace"
import { PromptHistoryProvider } from "./component/prompt/history"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptStashProvider } from "./component/prompt/stash"
import { Toast, ToastProvider, useToast } from "./ui/toast"
import { DialogConfirm } from "./ui/dialog-confirm"
import { formatOpenWorkspaceFailureMessage } from "./spinosa/home-visibility"
import { isDefaultTitle, sessionIsBusy } from "./util/session"
import { setToastError, tuiLog } from "./spinosa/log"
import { KVProvider, useKV } from "./context/kv"
import { KV } from "./constants/kv-keys"
import { readWrkWorkspaceID, writeMarkerWrkID } from "@spinosa/core/workspace/identity"
import { dbg } from "./util/debug-log"
import * as Model from "./util/model"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import open from "open"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { TuiConfigProvider, useTuiConfig, type TuiConfig } from "./config"
import { createTuiApiAdapters } from "./plugin/adapters"
import { createTuiApi } from "./plugin/api"
import { createPluginRuntime, PluginRuntimeProvider, usePluginRuntime, type TuiPluginHost } from "./plugin/runtime"
import { CommandPaletteDialog } from "./component/command-palette"
import {
  COMMAND_PALETTE_COMMAND,
  SPINOSA_BASE_MODE,
  OpencodeKeymapProvider,
  registerOpencodeKeymap,
  useBindings,
  useOpencodeKeymap,
} from "./keymap"

import type { EventSource } from "./context/sdk"
import { DialogVariant } from "./component/dialog-variant"
import { createTuiAttention } from "./attention"
import * as TuiAudio from "./audio"
import { destroyRenderer } from "./util/renderer"
import { cliErrorMessage, errorFormat } from "./util/error"
import { AddFiles } from "./routes/spinosa/add-files"
import { Onboarding } from "./routes/spinosa/onboarding"
import { Visualizer } from "./routes/spinosa/visualizer"

const appGlobalBindingCommands = [
  "session.list",
  "session.new",
  "session.quick_switch.1",
  "session.quick_switch.2",
  "session.quick_switch.3",
  "session.quick_switch.4",
  "session.quick_switch.5",
  "session.quick_switch.6",
  "session.quick_switch.7",
  "session.quick_switch.8",
  "session.quick_switch.9",
] as const

const appBindingCommands = [
  "command.palette.show",
  "model.list",
  "model.cycle_recent",
  "model.cycle_recent_reverse",
  "model.cycle_favorite",
  "model.cycle_favorite_reverse",
  "agent.list",
  "mcp.list",
  "agent.cycle",
  "agent.cycle.reverse",
  "variant.cycle",
  "variant.list",
  "provider.connect",
  "console.org.switch",
  "opencode.status",
  "theme.switch",
  "theme.switch_mode",
  "theme.mode.lock",
  "help.show",
  "docs.open",
  "diff.open",
  "workspace.list",
  "app.debug",
  "app.console",
  "app.heap_snapshot",
  "terminal.suspend",
  "terminal.title.toggle",
  "app.toggle.animations",
  "app.toggle.file_context",
  "app.toggle.diffwrap",
  "app.toggle.paste_summary",
  "app.toggle.session_directory_filter",
] as const

export type TuiInput = {
  url: string
  args: Args
  config: TuiConfig.Resolved
  onSnapshot?: () => Promise<string[]>
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
  /** Host → worker GlobalBus publish for non-durable import/OCR job events. */
  publishJobEvent?: import("./context/sdk").PublishJobEvent
  pluginHost: TuiPluginHost
}

function SpinosaSyncProvider(props: ParentProps) {
  const spinosa = useSpinosaWorkspace()
  const sdk = useSDK()
  const project = useProject()
  const kv = useKV()
  createEffect(() => {
    const path = spinosa.activePath
    const generic = spinosa.genericMode
    if (generic || !path) {
      project.workspace.set(undefined)
      kv.set(KV.ACTIVE_WRK_WORKSPACE_ID, undefined)
      return
    }
    const fromMarker = readWrkWorkspaceID(path)
    dbg("[spinosa:bridge:wrk]", { path, fromMarker: fromMarker ?? null })
    if (fromMarker) {
      kv.set(KV.ACTIVE_WRK_WORKSPACE_ID, fromMarker)
      project.workspace.set(fromMarker)
      tuiLog(`wrk bridge: loaded from marker ${fromMarker}`)
      return
    }
    sdk.client.experimental.workspace.list()
      .then((resp) => {
        const existing = resp.data?.find((w) => w.directory === path)
        dbg("[spinosa:bridge:wrk] server list", { count: resp.data?.length ?? 0, found: existing?.id ?? null })
        if (existing?.id) {
          writeMarkerWrkID(path, existing.id)
          kv.set(KV.ACTIVE_WRK_WORKSPACE_ID, existing.id)
          project.workspace.set(existing.id)
          tuiLog(`wrk bridge: found existing ${existing.id}`)
          return
        }
        kv.set(KV.ACTIVE_WRK_WORKSPACE_ID, undefined)
        project.workspace.set(undefined)
        tuiLog("wrk bridge: using base workspace")
      })
      .catch((err) => {
        dbg("[spinosa:bridge:wrk] failed", { error: String(err) })
        tuiLog(`wrk bridge: failed — ${err instanceof Error ? err.message : String(err)}`)
      })
  })
  return (
    <SyncProvider sessionDirectory={() => (spinosa.genericMode ? undefined : spinosa.activePath)}>
      {props.children}
    </SyncProvider>
  )
}

function errorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) {
    return error.data.message
  }
  return error instanceof Error ? error.message : String(error)
}

export const run = Effect.fn("Tui.run")(function* (input: TuiInput) {
  const t0 = Date.now()
  bootLog("tui.effect.run", "Effect.fn Tui.run entered")
  const global = yield* Global.Service
  const exit = { epilogue: undefined as string | undefined, reason: undefined as unknown }
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      bootLog("tui.renderer", "creating CLI renderer")
      const renderer = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            createCliRenderer({
              externalOutputMode: "passthrough",
              targetFps: 60,
              gatherStats: false,
              exitOnCtrlC: false,
              useKittyKeyboard: {},
              autoFocus: false,
              openConsoleOnError: false,
              useMouse: !Flag.SPINOSA_DISABLE_MOUSE && input.config.mouse,
              consoleOptions: {
                keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
              },
            }),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
        (renderer) =>
          Effect.sync(() => {
            destroyRenderer(renderer)
          }),
      )
      bootLog("tui.renderer.created", "CLI renderer created", { elapsedMs: Date.now() - t0 })
      yield* Effect.promise(async () => {
        // Platform-specific: Bun FFI to kernel32.dll (Windows only).
        const { win32DisableProcessedInput } = await import("./terminal-win32")
        win32DisableProcessedInput()
      })
      const keymap = createDefaultOpenTuiKeymap(renderer)
      yield* Effect.acquireRelease(
        Effect.sync(() => registerOpencodeKeymap(keymap, renderer, input.config)),
        (unregister) => Effect.sync(unregister),
      )
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          try {
            await input.pluginHost.dispose()
          } catch (error) {
            console.error("Failed to dispose TUI plugins", error)
          }
        }),
      )
      yield* Effect.addFinalizer(() => Effect.sync(TuiAudio.dispose))
      const shutdown = yield* Deferred.make<unknown>()
      const onProcessSignal = () => {
        destroyRenderer(renderer)
      }
      for (const signal of ["SIGHUP", "SIGINT"] as const) {
        yield* Effect.acquireRelease(
          Effect.sync(() => process.on(signal, onProcessSignal)),
          () => Effect.sync(() => process.off(signal, onProcessSignal)),
        )
      }
      renderer.once("destroy", () => Deferred.doneUnsafe(shutdown, Effect.void))
      const pluginRuntime = createPluginRuntime()

      yield* Effect.tryPromise(async () => {
        // Prewarm palette before ThemeProvider mounts so `system` theme avoids a first-paint fallback flash.
        const t1 = Date.now()
        bootLog("tui.render.start", "calling render()", { elapsedMs: t1 - t0 })
        void renderer.getPalette({ size: 16 }).catch(() => undefined)
        const mode = (await renderer.waitForThemeMode(1000)) ?? "dark"
        if (renderer.isDestroyed) return

        await render(() => {
          return (
            <ExitProvider
              exit={(reason) => {
                if (renderer.isDestroyed) return
                exit.reason = reason
                destroyRenderer(renderer)
              }}
            >
              <EpilogueProvider set={(value) => (exit.epilogue = value)}>
                <>
                  <TuiPathsProvider
                    value={{
                      cwd: process.cwd(),
                      home: global.home,
                      state: global.state,
                      worktree: global.data + "/worktree",
                    }}
                  >
                    <TuiTerminalEnvironmentProvider
                      value={{
                        platform: process.platform,
                        multiplexer: process.env.TMUX ? "tmux" : process.env.STY ? "screen" : undefined,
                        displayServer: process.env.WAYLAND_DISPLAY
                          ? "wayland"
                          : process.env.DISPLAY
                            ? "x11"
                            : undefined,
                      }}
                    >
                      <TuiStartupProvider
                        value={{
                          initialRoute: process.env.SPINOSA_ROUTE ? JSON.parse(process.env.SPINOSA_ROUTE) : undefined,
                          skipInitialLoading: Boolean(process.env.SPINOSA_FAST_BOOT),
                        }}
                      >
                        <ClipboardProvider>
                          <OpencodeKeymapProvider keymap={keymap}>
                            <ArgsProvider {...input.args}>
                              <KVProvider>
                                <ToastProvider>
                                  <RouteProvider
                                    initialRoute={
                                      input.args.continue
                                        ? {
                                            type: "workspace",
                                            sessionID: "dummy",
                                          }
                                        : input.args.sessionID
                                          ? {
                                              type: "workspace",
                                              sessionID: input.args.sessionID,
                                            }
        : input.args.prompt
          ? { type: "global", prompt: { input: input.args.prompt, parts: [] } }
                                            : undefined
                                    }
                                  >
                                    <SpinosaWorkspaceProvider>
                                    <TuiConfigProvider config={input.config}>
                                      <PluginRuntimeProvider value={pluginRuntime}>
                                        <SDKProvider
                                          url={input.url}
                                          directory={input.directory}
                                          fetch={input.fetch}
                                          headers={input.headers}
                                          events={input.events}
                                          publishJobEvent={input.publishJobEvent}
                                        >
                                          <PermissionProvider>
                                            <ProjectProvider>
                                              <SpinosaSyncProvider>
                                                <DataProvider>
                                                  <ThemeProvider mode={mode}>
                                                    <LocalProvider>
                                                      <PromptStashProvider>
                                                        <DialogProvider>
                                                          <FrecencyProvider>
                                                            <PromptHistoryProvider>
                                                              <PromptRefProvider>
                                                                <EditorContextProvider>
                                                                  <LocationProvider>
                                                                    <ErrorBoundary
                                                                      fallback={(error, reset) => (
                                                                        <ErrorComponent error={error} reset={reset} mode={mode} />
                                                                      )}
                                                                    >
                                                                      <App
                                                                        onSnapshot={input.onSnapshot}
                                                                        pluginHost={input.pluginHost}
                                                                      />
                                                                    </ErrorBoundary>
                                                                  </LocationProvider>
                                                                </EditorContextProvider>
                                                              </PromptRefProvider>
                                                            </PromptHistoryProvider>
                                                          </FrecencyProvider>
                                                        </DialogProvider>
                                                      </PromptStashProvider>
                                                    </LocalProvider>
                                                  </ThemeProvider>
                                                </DataProvider>
                                              </SpinosaSyncProvider>
                                            </ProjectProvider>
                                          </PermissionProvider>
                                        </SDKProvider>
                                      </PluginRuntimeProvider>
                                    </TuiConfigProvider>
                                    </SpinosaWorkspaceProvider>
                                  </RouteProvider>
                                </ToastProvider>
                              </KVProvider>
                            </ArgsProvider>
                          </OpencodeKeymapProvider>
                        </ClipboardProvider>
                      </TuiStartupProvider>
                    </TuiTerminalEnvironmentProvider>
                  </TuiPathsProvider>
                </>
              </EpilogueProvider>
            </ExitProvider>
          )
        }, renderer)
      })
      bootLog("tui.render.done", "render() call returned, awaiting shutdown")
      yield* Deferred.await(shutdown)
      bootLog("tui.shutdown", "TUI shutdown signal received", { totalMs: Date.now() - t0 })
      return { epilogue: exit.epilogue, reason: exit.reason }
    }),
  )
  yield* Effect.promise(async () => {
    // Platform-specific: Bun FFI to kernel32.dll (Windows only).
    const { win32FlushInputBuffer } = await import("./terminal-win32")
    win32FlushInputBuffer()
  })
  yield* Effect.sync(() => {
    if (result.reason !== undefined)
      process.stderr.write((cliErrorMessage(result.reason) ?? errorFormat(result.reason)) + "\n")
    if (result.epilogue) process.stdout.write(result.epilogue + "\n")
  })
})

function App(props: { onSnapshot?: () => Promise<string[]>; pluginHost: TuiPluginHost }) {
  const startup = useTuiStartup()
  const tuiConfig = useTuiConfig()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const keymap = useOpencodeKeymap()
  const event = useEvent()
  const sdk = useSDK()
  const toast = useToast()
  setToastError((err) => toast.error(err))
  const themeState = useTheme()
  const { theme, mode, setMode, locked, lock, unlock } = themeState
  const sync = useSync()
  const project = useProject()
  const exit = useExit()
  const promptRef = usePromptRef()
  const pluginRuntime = usePluginRuntime()
  const attention = createTuiAttention({ renderer, config: tuiConfig, kv })
  const clipboard = useClipboard()
  const spinosa = useSpinosaWorkspace()
  const [startupLoadingComplete, setStartupLoadingComplete] = createSignal(startup.skipInitialLoading)
  const appReady = () => ready() && (startup.skipInitialLoading || spinosa.bootReady)
  const tuiReady = () => appReady() && (startup.skipInitialLoading || startupLoadingComplete())

  // Auto-retry if TUI hasn't rendered after 3-5s normal startup + buffer.
  // Whitescreen after `checking for updates...` leaves `tuiReady()` false.
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retried = false
  onMount(() => {
    retryTimer = setTimeout(() => {
      if (tuiReady() || retried) return
      retried = true
      tuiLog("tui auto-retry: tuiReady still false after 8s, forcing reload")
      // Force boot ready and hide startup loading to unblock render.
      // If still not ready, the next effect will trigger a full reload.
      setStartupLoadingComplete(true)
      setTimeout(() => {
        if (!tuiReady()) {
          tuiLog("tui auto-retry: still not ready, reloading renderer")
          // Destroy and recreate is handled by Effect scope; here we just
          // force a hard reload via location (works in dev) or exit.
          try {
            globalThis.location?.reload?.()
          } catch {}
        }
      }, 1000)
    }, 8000)
  })
  onCleanup(() => {
    if (retryTimer) clearTimeout(retryTimer)
  })

  const api = createTuiApi(
    createTuiApiAdapters({
      version: InstallationVersion,
      tuiConfig,
      dialog,
      keymap,
      kv,
      route,
      routes: pluginRuntime.routes,
      event,
      sdk,
      sync,
      theme: themeState,
      toast,
      renderer,
      attention,
      Slot: pluginRuntime.Slot,
    }),
  )
  const [ready, setReady] = createSignal(false)
  props.pluginHost
    .start({
      api,
      config: tuiConfig,
      runtime: pluginRuntime,
      dispose: () => attention.dispose(),
    })
    .catch((error) => {
      console.error("Failed to load TUI plugins", error)
    })
    .finally(() => {
      setReady(true)
    })

  // Let selection copy/dismiss win ahead of normal bindings when explicit copy is required.
  const offSelectionKeys = keymap.intercept(
    "key",
    ({ event }) => {
      if (!Flag.SPINOSA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
      Selection.handleSelectionKey(renderer, toast, event, clipboard)
    },
    { priority: 1 },
  )
  // Always enable cmd+c/ctrl+c copy when text is selected, regardless of the copy-on-select flag
  const offSelectionCopy = keymap.intercept(
    "key",
    ({ event }) => {
      if (!(event.ctrl && event.name === "c")) return
      const text = renderer.getSelection()?.getSelectedText()
      if (!text || !clipboard.write) return
      clipboard
        .write(text)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
      renderer.clearSelection()
      event.preventDefault()
      event.stopPropagation()
    },
    { priority: 1 },
  )
  onCleanup(() => {
    offSelectionKeys()
    offSelectionCopy()
    attention.dispose()
  })

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await clipboard
      .write?.(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)

    renderer.clearSelection()
  }
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))
  const [pasteSummaryEnabled, setPasteSummaryEnabled] = createSignal(
    kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary),
  )

  // Update terminal window title based on current route and session
  createEffect(() => {
    if (!terminalTitleEnabled() || Flag.SPINOSA_DISABLE_TERMINAL_TITLE) return

    if (route.data.type === "workspace") {
      const session = sync.session.get(route.data.sessionID)
      if (!session || isDefaultTitle(session.title)) {
        renderer.setTerminalTitle("Spinosa")
        return
      }

      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`OC | ${title}`)
      return
    }

    if (route.data.type === "plugin") {
      renderer.setTerminalTitle(`OC | ${route.data.id}`)
    }
  })

  const args = useArgs()
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Model.parse(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
      }
      if (args.sessionID && !args.fork) {
        route.navigate({
          type: "workspace",
          sessionID: args.sessionID,
        })
      }
    })
  })

  let continued = false
  createEffect(() => {
    // When using -c, session list is loaded in blocking phase, so we can navigate at "partial"
    if (continued || sync.status === "loading" || !args.continue) return
    const match = sync.data.session
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .find((x) => x.parentID == null)?.id
    if (match) {
      continued = true
      if (args.fork) {
        void sdk.client.session.fork({ sessionID: match }).then((result) => {
          if (result.data?.id) {
            route.navigate({ type: "workspace", sessionID: result.data.id })
          } else {
            toast.show({ message: "Failed to fork session", variant: "error" })
          }
        })
      } else {
        route.navigate({ type: "workspace", sessionID: match })
      }
    }
  })

  // Handle --session with --fork: wait for sync to be fully complete before forking
  // (session list loads in non-blocking phase for --session, so we must wait for "complete"
  // to avoid a race where reconcile overwrites the newly forked session)
  let forked = false
  createEffect(() => {
    if (forked || sync.status !== "complete" || !args.sessionID || !args.fork) return
    forked = true
    void sdk.client.session.fork({ sessionID: args.sessionID }).then((result) => {
      if (result.data?.id) {
        route.navigate({ type: "workspace", sessionID: result.data.id })
      } else {
        toast.show({ message: "Failed to fork session", variant: "error" })
      }
    })
  })

  const connected = useConnected()

  createEffect(
    on(
      () => tuiReady() && sync.status === "complete" && !connected(),
      (needsProvider, neededProvider) => {
        // Open once when bootstrap confirms there is no usable provider.
        if (!needsProvider || neededProvider) return
        dialog.replace(() => <DialogProviderList />)
      },
    ),
  )

  // When the provider dialog is dismissed without selecting a provider,
  // auto-select the free Spinosa default (OpenCode Zen)
  createEffect(() => {
    if (
      tuiReady() &&
      dialog.stack.length === 0 &&
      sync.status === "complete" &&
      !connected()
    ) {
      const provider = sync.data.provider.find((item) => item.id === "opencode")
      const model = Object.values(provider?.models ?? {}).find(
        (item) => item.cost?.input === 0 && item.status !== "deprecated",
      )
      if (provider && model) {
        local.model.set({ providerID: provider.id, modelID: model.id }, { recent: true })
      }
    }
  })

  // Soft-fail openWorkspace: toast already fired; offer Recover / Choose another.
  createEffect(() => {
    if (!spinosa.openFailure) return
    const failure = spinosa.consumeOpenFailure()
    if (!failure) return
    void (async () => {
      const message = formatOpenWorkspaceFailureMessage(failure)
      const recover = failure.recoverable
        ? await DialogConfirm.show(dialog, "Can’t open workspace", message, {
            confirmLabel: "Recover",
            cancelLabel: "Choose another",
            defaultChoice: "confirm",
          })
        : await DialogConfirm.show(dialog, "Can’t open workspace", message, {
            confirmLabel: "Choose another",
            cancelLabel: "Cancel",
            defaultChoice: "confirm",
          })
      if (failure.recoverable && recover) {
        dialog.replace(() => (
          <DialogSpinosaMissingWorkspace
            workspacePath={failure.path}
            workspaceName={failure.name}
            workspaceID={failure.workspaceID}
            onBack={() => {
              dialog.clear()
              spinosa.showPicker()
            }}
            onRemoved={async () => {
              dialog.clear()
            }}
            onRecovered={async (workspacePath) => {
              dialog.clear()
              await spinosa.openWorkspace(workspacePath)
            }}
          />
        ))
        return
      }
      if (recover === false && failure.recoverable) {
        spinosa.showPicker()
        return
      }
      if (!failure.recoverable && recover) {
        spinosa.showPicker()
      }
    })()
  })

  // Workspace picker overlay — stays on the current route (no silent abandon of mid-run sessions).
  createEffect(() => {
    if (!spinosa.pickerRequested) return
    spinosa.clearPickerRequest()
    if (!connected()) {
      dialog.replace(() => <DialogProviderList />)
      return
    }
    void (async () => {
      const current = route.data
      if (current.type === "workspace" && current.sessionID) {
        const status = sync.data.session_status?.[current.sessionID]
        if (sessionIsBusy(status, sync.session.status(current.sessionID))) {
          const leave = await DialogConfirm.show(
            dialog,
            "Switch workspace?",
            "A session is still running. Open the workspace picker anyway? The run continues in the background until you abort it.",
            {
              confirmLabel: "Open picker",
              cancelLabel: "Stay",
              defaultChoice: "cancel",
            },
          )
          if (!leave) {
            spinosa.restorePickerRoute()
            return
          }
        }
      }
      const restore = () => spinosa.restorePickerRoute()
      dialog.replace(
        () => <DialogSpinosaWorkspacePicker onClose={restore} />,
        undefined,
        () => {
          dialog.dismiss()
          restore()
        },
      )
    })()
  })

  const currentWorktreeWorkspace = createMemo(() => {
    const workspaceID = project.workspace.current()
    if (!workspaceID) return
    const workspace = project.workspace.get(workspaceID)
    if (workspace?.type !== "worktree" || !workspace.directory) return
    return workspace
  })
  const appCommands = createMemo(() =>
    [
      {
        name: COMMAND_PALETTE_COMMAND,
        title: "Show command palette",
        category: "System",
        hidden: true,
        run: () => {
          dialog.replace(() => <CommandPaletteDialog />)
        },
      },
      {
        name: "session.list",
        title: "Switch session",
        category: "Session",
        suggested: sync.data.session.length > 0,
        slashName: "sessions",
        slashAliases: ["session", "resume", "continue"],
        run: async () => {
          // No abort here: opening the switcher must not kill the running
          // session. If the user commits to a different session, the picker
          // aborts the old one at selection time.
          dialog.replace(() => <DialogSessionList />)
        },
      },
      {
        name: "session.new",
        title: "New session",
        suggested: route.data.type === "workspace",
        category: "Session",
        slashName: "new",
        slashAliases: ["clear"],
        run: async () => {
          const cur = route.data
          if (cur.type === "workspace" && cur.sessionID) {
            const st = sync.data.session_status?.[cur.sessionID]
            if (st?.type !== "idle") await sdk.client.session.abort({ sessionID: cur.sessionID }).catch(() => {})
          }
          route.navigate({ type: "global" })
          dialog.clear()
        },
      },
      {
        name: "workspace.copy_path",
        title: "Copy worktree path",
        category: "Workspace",
        enabled: () => currentWorktreeWorkspace() !== undefined,
        run: async () => {
          const workspace = currentWorktreeWorkspace()
          if (!workspace?.directory) return
          await clipboard
            .write?.(workspace.directory)
            .then(() => toast.show({ message: "Copied worktree path", variant: "info" }))
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "workspace.list",
        title: "Manage workspaces",
        category: "Workspace",
        hidden: !Flag.SPINOSA_EXPERIMENTAL_WORKSPACES,
        slashName: "workspaces",
        run: () => {
          dialog.replace(() => <DialogWorkspaceList />)
        },
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        name: `session.quick_switch.${i + 1}`,
        title: `Switch to session in quick slot ${i + 1}`,
        category: "Session",
        hidden: true,
        run: () => {
          local.session.quickSwitch(i + 1)
        },
      })),
      {
        name: "model.list",
        title: "Switch model",
        suggested: true,
        category: "Agent",
        slashName: "models",
        // Bias /mo toward /models over /move without changing global fuzzy scoring.
        slashAliases: ["mo"],
        run: () => {
          dialog.replace(() => <DialogModel />)
        },
      },
      {
        name: "model.cycle_recent",
        title: "Model cycle",
        category: "Agent",
        hidden: true,
        run: () => {
          local.model.cycle(1)
        },
      },
      {
        name: "model.cycle_recent_reverse",
        title: "Model cycle reverse",
        category: "Agent",
        hidden: true,
        run: () => {
          local.model.cycle(-1)
        },
      },
      {
        name: "model.cycle_favorite",
        title: "Favorite cycle",
        category: "Agent",
        hidden: true,
        run: () => {
          local.model.cycleFavorite(1)
        },
      },
      {
        name: "model.cycle_favorite_reverse",
        title: "Favorite cycle reverse",
        category: "Agent",
        hidden: true,
        run: () => {
          local.model.cycleFavorite(-1)
        },
      },
      {
        name: "agent.list",
        title: "Switch agent",
        category: "Agent",
        slashName: "agents",
        run: () => {
          dialog.replace(() => <DialogAgent />)
        },
      },
      {
        name: "mcp.list",
        title: "Toggle MCPs",
        category: "Agent",
        slashName: "mcps",
        run: () => {
          dialog.replace(() => <DialogMcp />)
        },
      },
      {
        name: "agent.cycle",
        title: "Agent cycle",
        category: "Agent",
        hidden: true,
        run: () => {
          local.agent.move(1)
        },
      },
      {
        name: "variant.cycle",
        title: "Variant cycle",
        category: "Agent",
        run: () => {
          local.model.variant.cycle()
        },
      },
      {
        name: "variant.list",
        title: "Switch model variant",
        category: "Agent",
        hidden: local.model.variant.list().length === 0,
        slashName: "variants",
        run: () => {
          if (local.model.variant.list().length === 0) {
            return toast.show({
              title: "No variants available",
              message: "The current model does not support any variants.",
              variant: "info",
            })
          }
          dialog.replace(() => <DialogVariant />)
        },
      },
      {
        name: "agent.cycle.reverse",
        title: "Agent cycle reverse",
        category: "Agent",
        hidden: true,
        run: () => {
          local.agent.move(-1)
        },
      },
      {
        name: "provider.connect",
        title: "Connect provider",
        suggested: !connected(),
        slashName: "connect",
        run: () => {
          dialog.replace(() => <DialogProviderList />)
        },
        category: "Provider",
      },
      ...(sync.data.console_state.switchableOrgCount > 1
        ? [
            {
              name: "console.org.switch",
              title: "Switch org",
              suggested: Boolean(sync.data.console_state.activeOrgName),
              slashName: "org",
              slashAliases: ["orgs", "switch-org"],
              run: () => {
                dialog.replace(() => <DialogConsoleOrg />)
              },
              category: "Provider",
            },
          ]
        : []),
      {
        name: "opencode.status",
        title: "View status",
        slashName: "status",
        run: () => {
          dialog.replace(() => <DialogStatus />)
        },
        category: "System",
      },
      {
        name: "theme.switch",
        title: "Switch theme",
        slashName: "themes",
        run: () => {
          dialog.replace(() => <DialogThemeList />)
        },
        category: "System",
      },
      {
        name: "theme.switch_mode",
        title: mode() === "dark" ? "Switch to light mode" : "Switch to dark mode",
        run: () => {
          setMode(mode() === "dark" ? "light" : "dark")
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "theme.mode.lock",
        title: locked() ? "Unlock theme mode" : "Lock theme mode",
        run: () => {
          if (locked()) unlock()
          else lock()
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "help.show",
        title: "Help",
        slashName: "help",
        run: () => {
          dialog.replace(() => <DialogHelp />)
        },
        category: "System",
      },
      {
        name: "docs.open",
        title: "Open docs",
        run: () => {
          open("https://medialab.github.io/spinosa").catch(() => {})
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "app.exit",
        title: "Exit the app",
        slashName: "exit",
        slashAliases: ["quit", "q"],
        run: () => exit(),
        category: "System",
      },
      {
        name: "app.debug",
        title: "Toggle debug panel",
        category: "System",
        run: () => {
          renderer.toggleDebugOverlay()
          dialog.clear()
        },
      },
      {
        name: "app.console",
        title: "Toggle console",
        category: "System",
        run: () => {
          renderer.console.toggle()
          dialog.clear()
        },
      },
      {
        name: "app.heap_snapshot",
        title: "Write heap snapshot",
        category: "System",
        run: async () => {
          const files = await props.onSnapshot?.()
          toast.show({
            variant: "info",
            message: `Heap snapshot written to ${files?.join(", ")}`,
            duration: 5000,
          })
          dialog.clear()
        },
      },
      {
        name: "terminal.suspend",
        title: "Suspend terminal",
        category: "System",
        hidden: true,
        enabled: process.platform !== "win32",
        run: () => {
          renderer.suspend()
          process.once("SIGCONT", () => renderer.resume())
          process.kill(0, "SIGTSTP")
        },
      },
      {
        name: "terminal.title.toggle",
        title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
        category: "System",
        run: () => {
          setTerminalTitleEnabled((prev) => {
            const next = !prev
            kv.set("terminal_title_enabled", next)
            if (!next) renderer.setTerminalTitle("")
            return next
          })
          dialog.clear()
        },
      },
      {
        name: "app.toggle.animations",
        title: kv.get("animations_enabled", true) ? "Disable animations" : "Enable animations",
        category: "System",
        run: () => {
          kv.set("animations_enabled", !kv.get("animations_enabled", true))
          dialog.clear()
        },
      },
      {
        name: "app.toggle.file_context",
        title: kv.get("file_context_enabled", true) ? "Disable file context" : "Enable file context",
        category: "System",
        run: () => {
          kv.set("file_context_enabled", !kv.get("file_context_enabled", true))
          dialog.clear()
        },
      },
      {
        name: "app.toggle.diffwrap",
        title: kv.get("diff_wrap_mode", "word") === "word" ? "Disable diff wrapping" : "Enable diff wrapping",
        category: "System",
        run: () => {
          const current = kv.get("diff_wrap_mode", "word")
          kv.set("diff_wrap_mode", current === "word" ? "none" : "word")
          dialog.clear()
        },
      },
      {
        name: "app.toggle.paste_summary",
        title: pasteSummaryEnabled() ? "Disable paste summary" : "Enable paste summary",
        category: "System",
        run: () => {
          setPasteSummaryEnabled((prev) => {
            const next = !prev
            kv.set("paste_summary_enabled", next)
            return next
          })
          dialog.clear()
        },
      },
      {
        name: "app.toggle.session_directory_filter",
        title: kv.get(KV.SESSION_DIRECTORY_FILTER, true)
          ? "Disable session directory filtering"
          : "Enable session directory filtering",
        category: "System",
        run: async () => {
          kv.set(KV.SESSION_DIRECTORY_FILTER, !kv.get(KV.SESSION_DIRECTORY_FILTER, true))
          await sync.session.refresh()
          dialog.clear()
        },
      },
      {
        name: "permission.mode",
        title:
          local.permission.mode === "auto" ? "Disable auto-approve permissions" : "Enable auto-approve permissions",
        category: "System",
        run: () => {
          local.permission.toggle()
          dialog.clear()
        },
      },
    ].map((command) => ({
      namespace: "palette",
      ...command,
    })),
  )

  useBindings(() => ({
    commands: appCommands(),
  }))

  useBindings(() => ({
    mode: SPINOSA_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("app", appBindingCommands),
  }))

  useBindings(() => ({
    bindings: tuiConfig.keybinds.gather("app.global", appGlobalBindingCommands),
  }))

  useBindings(() => ({
    mode: SPINOSA_BASE_MODE,
    enabled: () => {
      const current = promptRef.current
      if (!current?.focused) return true
      return current.current.input === ""
    },
    bindings: tuiConfig.keybinds.gather("app_exit", ["app.exit"]),
  }))

  event.on("tui.command.execute", (evt, { workspace }) => {
    if (workspace !== project.workspace.current()) return
    keymap.dispatchCommand(evt.properties.command)
  })

  event.on("tui.toast.show", (evt, { workspace }) => {
    if (workspace !== project.workspace.current()) return
    toast.show({
      title: evt.properties.title,
      message: evt.properties.message,
      variant: evt.properties.variant,
      duration: evt.properties.duration,
    })
  })

  event.on("tui.session.select", (evt, { workspace }) => {
    if (workspace !== project.workspace.current()) return
    route.navigate({
      type: "workspace",
      sessionID: evt.properties.sessionID,
    })
  })

  event.on("session.deleted", (evt) => {
    if (route.data.type === "workspace" && route.data.sessionID === evt.properties.info.id) {
      route.navigate({ type: "global" })
      toast.show({
        variant: "info",
        message: "The current session was deleted",
      })
    }
  })

  event.on("session.error", (evt, { workspace }) => {
    if (workspace !== project.workspace.current()) return
    const error = evt.properties.error
    if (error && typeof error === "object" && error.name === "MessageAbortedError") return
    const message = errorMessage(error)

    toast.show({
      variant: "error",
      message,
      duration: 5000,
    })
  })

  const plugin = createMemo(() => {
    if (!ready()) return
    if (route.data.type !== "plugin") return
    const render = pluginRuntime.routes.get(route.data.id)
    if (!render) return <PluginRouteMissing id={route.data.id} onHome={() => route.navigate({ type: "global" })} />
    return render({ params: route.data.data })
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background}
      onMouseDown={(evt) => {
        if (!Flag.SPINOSA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
        if (evt.button !== MouseButton.RIGHT) return

        if (!Selection.copy(renderer, toast, clipboard)) return
        evt.preventDefault()
        evt.stopPropagation()
      }}
      onMouseUp={
        !Flag.SPINOSA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT
          ? () => Selection.copy(renderer, toast, clipboard)
          : undefined
      }
    >
      <Show when={Flag.SPINOSA_SHOW_TTFD}>
        <TimeToFirstDraw />
      </Show>
      <Show when={tuiReady()}>
        <box flexGrow={1} minHeight={0} flexDirection="column">
          <Show when={route.data.type === "workspace"}>
            <Session />
          </Show>
          <Show when={route.data.type === "global"}>
            <Home />
          </Show>
          <Show when={route.data.type === "onboarding"}>
            <Onboarding />
          </Show>
          <Show when={route.data.type === "add-files"}>
            <AddFiles />
          </Show>
          <Show when={route.data.type === "visualizer"}>
            <Visualizer />
          </Show>
          {plugin()}
        </box>
        <pluginRuntime.Slot name="app_bottom" />
        <pluginRuntime.Slot name="app" />
      </Show>
      <Show when={!startup.skipInitialLoading}>
        <StartupLoading
          ready={appReady}
          operations={() => spinosa.bootOperations}
          onComplete={() => setStartupLoadingComplete(true)}
        />
      </Show>
      <ConversationLoading
        active={() => route.conversationBooting()}
        onTimeout={() => {
          route.finishConversationBoot()
          toast.show({
            title: "Conversation is taking longer than expected",
            message: "Check your connection or try again.",
            variant: "warning",
            duration: 8000,
          })
        }}
      />
      {/* Viewport-relative host: parent is full terminal width×height, not content column */}
      <Toast />
    </box>
  )
}
