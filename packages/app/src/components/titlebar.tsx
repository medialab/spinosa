import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useBeforeLeave, useLocation, useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@spinosa/kernel-core/util/encode"
import { IconButton } from "@spinosa/ui/icon-button"
import { Icon } from "@spinosa/ui/icon"
import { Button } from "@spinosa/ui/button"
import { Tooltip, TooltipKeybind } from "@spinosa/ui/tooltip"
import { IconButtonV2 } from "@spinosa/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@spinosa/ui/v2/icon"
import { KeybindV2 } from "@spinosa/ui/v2/keybind-v2"
import { TooltipV2 } from "@spinosa/ui/v2/tooltip-v2"
import { useDialog } from "@spinosa/ui/context/dialog"

import { currentRoute, LayoutRoute, useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { WindowsAppMenu } from "./windows-app-menu"
import { applyPath, backPath, forwardPath } from "./titlebar-history"
import { TitlebarTabStrip } from "@/components/titlebar-tab-strip"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { readSessionTabsRemovedDetail, SESSION_TABS_REMOVED_EVENT } from "@/components/titlebar-session-events"
import { useGlobal } from "@/context/global"
import { ServerConnection, useServer } from "@/context/server"
import { tabKey, useTabs } from "@/context/tabs"
import { tabHref } from "@/context/tabs"
import { nextTabAfterClose } from "@/context/closed-tabs"
import type { PromptSession } from "@/context/prompt"
import "./titlebar.css"
import { normalizeSessionInfo } from "@/utils/session"
import { decode64 } from "@/utils/base64"
import { showToast } from "@/utils/toast"
import { activeOnboardingJob } from "@/utils/active-onboarding-job"
import { DialogStopCurrentTask } from "@/components/dialog-stop-current-task"
import { pauseSessionFollowups } from "@/utils/session-leave"

const legacyTitlebarHeight = 40
const v2TitlebarHeight = 36
const minTitlebarZoom = 0.25
const windowsControlsBaseWidth = 138 // 3 native Windows caption buttons at 46px each.
const macTrafficLightsBaseWidth = 84

export type TitlebarUpdate = {
  version: () => string | undefined
  installing: () => boolean
  install: () => void
}

export function useTitlebarRightMount() {
  const language = useLanguage()
  const [mount, setMount] = createSignal<HTMLElement | null>(null)
  const sync = () => setMount(document.getElementById("opencode-titlebar-right"))
  onMount(sync)
  createEffect(on(language.direction, sync, { defer: true }))
  return mount
}

export function useTitlebarSessionMount() {
  const language = useLanguage()
  const settings = useSettings()
  const [mount, setMount] = createSignal<HTMLElement | null>(null)
  const sync = () => setMount(document.getElementById("opencode-titlebar-session"))
  onMount(sync)
  createEffect(on([language.direction, settings.general.newLayoutDesigns], sync, { defer: true }))
  return mount
}

export function Titlebar(props: { update?: TitlebarUpdate; debugTools?: { visible: boolean; toggle: () => void } }) {
  const layout = useLayout()
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const server = useServer()
  const global = useGlobal()
  const dialog = useDialog()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const useV2Titlebar = createMemo(() => settings.general.newLayoutDesigns())
  const mobile = createMediaQuery("(max-width: 767px)")
  const bottom = createMemo(() => useV2Titlebar() && mobile() && settings.general.mobileTitlebarPosition() === "bottom")

  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
  const web = createMemo(() => platform.platform === "web")
  const macTrafficLights = createMemo(() => mac() && !platform.windowFullscreen?.())
  const zoom = () => platform.webviewZoom?.() ?? 1
  const titlebarZoom = () => (windows() ? Math.max(zoom(), minTitlebarZoom) : zoom())
  const counterZoom = () => (windows() && titlebarZoom() < 1 ? 1 / titlebarZoom() : 1)
  const minHeight = () => {
    const height = useV2Titlebar() ? v2TitlebarHeight : legacyTitlebarHeight
    if (mac()) return `${height / zoom()}px`
    if (windows()) return `${height / Math.min(titlebarZoom(), 1)}px`
    return undefined
  }
  const windowsControlsWidth = () => `${windowsControlsBaseWidth / Math.max(titlebarZoom(), 1)}px`

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`
  const creating = createMemo(() => {
    const route = layout.route()
    if (route.type === "draft" || route.type === "dir-new-sesssion") return true
    if (!params.dir) return false
    if (params.id) return false
    const parts = location.pathname.replace(/\/+$/, "").split("/")
    return parts.at(-1) === "session"
  })

  createEffect(() => {
    const current = path()

    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const canBack = createMemo(() => history.index > 0)
  const canForward = createMemo(() => history.index < history.stack.length - 1)
  const hasProjects = createMemo(() => layout.projects.list().length > 0)
  const nav = createMemo(() => (useV2Titlebar() ? settings.general.showNavigation() : true))
  const updateState = createMemo<TitlebarUpdatePillState>(() => {
    const installing = props.update?.installing() ?? false
    const version = props.update?.version()
    return {
      visible: version !== undefined || installing,
      installing,
      label: language.t("titlebar.update"),
      ariaLabel: language.t("toast.update.action.installRestart"),
      title: version ? language.t("titlebar.updateVersion", { version }) : undefined,
      onInstall: () => props.update?.install(),
    }
  })
  const v2RightState = createMemo<TitlebarV2RightState>(() => ({
    update: updateState(),
  }))

  const checkLeave = async (route: Extract<LayoutRoute, { type: "session" }>) => {
    const conn = global.servers.list().find((item) => ServerConnection.key(item) === (route.server ?? server.key))
    if (!conn) throw new Error(language.t("common.requestFailed"))

    const ctx = global.ensureServerCtx(conn)
    const session = ctx.sync.session.peek(route.sessionId) ?? (await ctx.sync.session.resolve(route.sessionId))
    const directory = session?.directory ?? decode64(params.dir)
    const [active, job] = await Promise.all([
      ctx.sdk.api.session.active(),
      directory
        ? activeOnboardingJob(() => ctx.sdk.ensureDirSdkContext(directory).client.onboarding.active.get({ directory }))
        : Promise.resolve(undefined),
    ])
    const status = ctx.sync.session.data.session_status[route.sessionId]
    const chatBusy = (status !== undefined && status.type !== "idle") || Boolean(active[route.sessionId])
    const importBusy = job !== undefined && (job.status === "running" || job.status === "waiting")

    if (!chatBusy && !importBusy) return
    return async () => {
      const operations: Promise<unknown>[] = []
      if (chatBusy) operations.push(ctx.sdk.api.session.interrupt({ sessionID: route.sessionId }))
      if (importBusy && directory && job) {
        operations.push(ctx.sdk.ensureDirSdkContext(directory).client.onboarding.job.cancel({ directory, jobID: job.id }))
      }
      await Promise.all(operations)
    }
  }

  let leavePending = false
  let approvedRoute: string | undefined
  const navigateApproved = (to: string, action: () => void) => {
    approvedRoute = new URL(to, window.location.href).pathname
    action()
    queueMicrotask(() => { approvedRoute = undefined })
  }
  const confirmLeave = (onLeave: () => void, onCancel?: () => void, home = false) => {
    const route = layout.route()
    if (route.type !== "session") {
      onLeave()
      return
    }
    if (leavePending) {
      onCancel?.()
      return
    }
    leavePending = true
    let active = true
    let settled = false
    let restoreFollowups: (() => void) | undefined
    const finish = (leave: boolean) => {
      if (settled) return
      settled = true
      leavePending = false
      if (leave) onLeave()
      else onCancel?.()
    }
    dialog.show(
      () => <DialogStopCurrentTask
        check={() => checkLeave(route)}
        isActive={() => active}
        beforeLeave={() => { restoreFollowups = pauseSessionFollowups(route.sessionId) }}
        onStopFailed={() => restoreFollowups?.()}
        onHome={() => finish(true)}
        message={home ? undefined : language.t("session.leaveTask.message")}
      />,
      () => {
        active = false
        finish(false)
      },
    )
  }

  useBeforeLeave((event) => {
    if (event.defaultPrevented || layout.route().type !== "session") return
    if (typeof event.to === "string") {
      const target = new URL(event.to, window.location.href)
      if (approvedRoute === target.pathname) {
        approvedRoute = undefined
        return
      }
      const next = currentRoute(target.pathname, target.search)
      const route = layout.route()
      if (next.type === "session" && route.type === "session" && next.sessionId === route.sessionId) return
    }
    event.preventDefault()
    const home = typeof event.to === "string" && (event.to === "/" || /\/session\/?$/.test(event.to))
    confirmLeave(() => event.retry(true), undefined, home)
  })

  if (platform.platform === "desktop") {
    const unsubscribe = window.api?.onWindowCloseRequest?.(() => {
      confirmLeave(
        () => window.api?.respondWindowClose?.(true),
        () => window.api?.respondWindowClose?.(false),
      )
    })
    onCleanup(() => unsubscribe?.())
  }

  const goHome = async () => {
    const route = layout.route()
    if (route.type !== "session") {
      if (location.pathname !== "/") navigate("/")
      return
    }
    const conn = global.servers.list().find((item) => ServerConnection.key(item) === (route.server ?? server.key))
    const session = conn
      ? global.ensureServerCtx(conn).sync.session.peek(route.sessionId) ??
        (await global.ensureServerCtx(conn).sync.session.resolve(route.sessionId))
      : undefined
    const directory = session?.directory ?? decode64(params.dir)
    navigate(directory ? `/${base64Encode(directory)}/session` : "/")
  }

  const requestHome = () => {
    void goHome().catch((error: unknown) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    })
  }

  command.register("titlebar-home", () => [
    {
      id: "home.toggle",
      title: language.t("home.title"),
      category: language.t("command.category.view"),
      keybind: "mod+b",
      hidden: true,
      onSelect: requestHome,
    },
  ])

  const back = () => {
    const next = backPath(history)
    if (!next) return
    confirmLeave(() => navigateApproved(next.to, () => {
      setHistory(next.state)
      navigate(next.to)
    }))
  }

  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    confirmLeave(() => navigateApproved(next.to, () => {
      setHistory(next.state)
      navigate(next.to)
    }))
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  return (
    <header
      data-slot={useV2Titlebar() ? "titlebar-v2" : undefined}
      classList={{
        "flex flex-row": true,
        "absolute inset-x-0 top-0 z-50 h-12 md:h-14 bg-transparent pointer-events-none overflow-visible": useV2Titlebar(),
        "shrink-0 relative h-10 bg-background-base overflow-hidden": !useV2Titlebar(),
        "order-last": bottom(),
      }}
      style={{
        "min-height": minHeight(),
        // Keep native macOS traffic lights clear even when the desktop window is narrow.
        "padding-left": macTrafficLights() ? `${macTrafficLightsBaseWidth / zoom()}px` : 0,
        width: windows() ? `env(titlebar-area-width, calc(100vw - ${windowsControlsWidth()}))` : undefined,
        "max-width": windows() ? `env(titlebar-area-width, calc(100vw - ${windowsControlsWidth()}))` : undefined,
        // Native Windows caption controls remain on the physical right in both writing directions.
        "margin-right": windows() ? "auto" : undefined,
      }}
      data-tauri-drag-region
    >
      <Switch>
        <Match when={useV2Titlebar()}>
          {(_) => {
            const layout = useLayout()
            const tabs = useTabs()
            const tabsStore = tabs.store
            const tabsStoreActions = tabs
            const [session] = createResource(
              () => {
                const route = layout.route()
                if (route.type !== "session") return undefined
                const conn = global.servers
                  .list()
                  .find((item) => ServerConnection.key(item) === (route.server ?? server.key))
                return conn ? { route, sdk: global.ensureServerCtx(conn).sdk } : undefined
              },
              ({ route, sdk }) =>
                sdk.api.session
                  .get({ sessionID: route.sessionId })
                  .then(normalizeSessionInfo)
                  .catch(() => {}),
            )

            const matchRoute = (route: LayoutRoute) => {
              if (route.type === "home") return
              if (route.type === "draft") {
                return tabsStore.find((item) => item.type === "draft" && item.draftID === route.draftID)
              }
              if (route.type === "session") {
                const main = tabsStore.find(
                  (item) =>
                    item.type === "session" && item.server === route.server && item.sessionId === route.sessionId,
                )
                if (main) return main
                const s = session()
                if (s?.parentID) {
                  const parentID = s.parentID
                  const parent = tabsStore.find(
                    (item) => item.type === "session" && item.server === route.server && item.sessionId === parentID,
                  )
                  if (parent) return parent
                }
              }
            }

            const currentTab = () => matchRoute(layout.route())
            const closeTabSafely = (index: number) => {
              const tab = tabsStore[index]
              if (!tab) return
              const current = currentTab()
              if (layout.route().type !== "session" || !current || tabKey(tab) !== tabKey(current)) {
                tabsStoreActions.closeTab(index)
                return
              }
              const next = nextTabAfterClose(tabsStore, index, true)
              const destination = next ? tabHref(next) : "/"
              confirmLeave(
                () => navigateApproved(destination, () => tabsStoreActions.closeTab(index)),
                undefined,
                destination === "/",
              )
            }

            createEffect(() => {
              const route = layout.route()
              if (!tabs.ready()) return
              const tab = currentTab()
              if (tab) {
                tabs.remember(tab)
                return
              }

              if (route.type === "session") {
                const s = session()
                if (!s) return
                const sessionId = s.parentID ?? s.id
                const next = { server: route.server ?? server.key, sessionId }
                tabsStoreActions.addSessionTab(next)
              }
            })

            makeEventListener(window, SESSION_TABS_REMOVED_EVENT, (event) => {
              const detail = readSessionTabsRemovedDetail(event)
              if (!detail) return
              tabsStoreActions.removeSessions(detail)
            })

            const openNewTab = () => {
              const route = layout.route()
              const activeSession = session()
              if (route.type === "session" && activeSession) {
                const sessionTab = {
                  type: "session" as const,
                  server: route.server ?? server.key,
                  sessionId: activeSession.id,
                }
                const model = tabs.stateValue<PromptSession>(sessionTab, "prompt")?.model.current()
                tabs.newDraft({ server: sessionTab.server, directory: activeSession.directory }, "", model)
                return
              }

              const activeTab = currentTab()
              if (activeTab?.type === "draft") {
                const model = tabs.stateValue<PromptSession>(activeTab, "prompt")?.model.current()
                tabs.newDraft({ server: activeTab.server, directory: activeTab.directory }, "", model)
                return
              }

              if (route.type === "home") {
                const selection = layout.home.selection()
                const conn = global.servers.list().find((item) => ServerConnection.key(item) === selection.server)
                const project = conn
                  ? global
                      .ensureServerCtx(conn)
                      .projects.list()
                      .find((item) => item.worktree === selection.directory)
                  : undefined
                if (conn && project) {
                  tabs.newDraft({ server: ServerConnection.key(conn), directory: project.worktree }, "")
                  return
                }
              }

              const current = layout.projects.list()[0]
              if (current) {
                tabs.newDraft({ server: server.key, directory: current.worktree }, "")
                return
              }

              const fallback = global.servers.list().flatMap((conn) => {
                const project = global.ensureServerCtx(conn).projects.list()[0]
                return project ? [{ server: ServerConnection.key(conn), project }] : []
              })[0]
              if (!fallback) return

              tabs.newDraft({ server: fallback.server, directory: fallback.project.worktree }, "")
            }
            command.register("tabs", () => {
              const current = currentTab()

              return [
                {
                  id: "tab.new",
                  category: "tab",
                  title: language.t("command.session.new"),
                  keybind: "mod+t,mod+n",
                  hidden: true,
                  onSelect: openNewTab,
                },
                current && {
                  id: "tab.close",
                  category: "tab",
                  title: language.t("command.tab.close"),
                  keybind: "mod+w",
                  hidden: true,
                  onSelect: () => {
                    closeTabSafely(tabsStore.findIndex((tab) => current === tab))
                  },
                },
                {
                  id: "tab.reopenClosed",
                  category: language.t("command.category.file"),
                  title: language.t("command.tab.reopenClosed"),
                  keybind: "mod+shift+t",
                  onSelect: () => tabsStoreActions.reopenClosedTab(),
                },
              ].filter((v) => v !== undefined)
            })

            const [tabsAreOverflowing, setTabsAreOverflowing] = createSignal(false)

            return (
              <div
                class="relative h-full flex-1 overflow-visible flex flex-row items-center gap-1.5 px-2 md:pr-3"
                classList={{
                  "pt-2": !bottom(),
                  "pb-2": bottom(),
                  "md:pl-2": macTrafficLights(),
                  "md:pl-4": !macTrafficLights(),
                }}
              >
                <div class="pointer-events-auto shrink-0"><ChannelIndicator debugTools={props.debugTools} /></div>
                <Show when={windows() || linux()}>
                  <div class="pointer-events-auto"><WindowsAppMenu command={command} platform={platform} variant="v2" /></div>
                </Show>
                <TooltipV2
                  placement="bottom"
                  value={
                    <>
                      {language.t(layout.route().type === "session" ? "session.header.backToHome" : "home.title")}
                      <KeybindV2 keys={command.keybindParts("home.toggle")} variant="neutral" />
                    </>
                  }
                  class="shrink-0 pointer-events-auto"
                >
                  <IconButtonV2
                    type="button"
                    variant="ghost-muted"
                    size="large"
                    class="relative z-10 !w-9 shrink-0 rounded-full bg-v2-background-bg-base shadow-sm"
                    icon={<IconV2 name={layout.route().type === "session" ? "arrow-left" : "home"} />}
                    state={layout.route().type === "home" ? "pressed" : undefined}
                    onClick={requestHome}
                    aria-label={language.t(layout.route().type === "session" ? "session.header.backToHome" : "home.title")}
                    aria-pressed={layout.route().type === "home"}
                  />
                </TooltipV2>

                <div id="opencode-titlebar-session" class="pointer-events-auto flex min-w-0 shrink items-center" />

                <div class="hidden" aria-hidden="true">
                  <TitlebarTabStrip
                    tabs={tabsStore}
                    currentTab={currentTab}
                    forceTruncate={tabsAreOverflowing()}
                    onOverflowChange={setTabsAreOverflowing}
                    onNavigate={(tab, el) => {
                      const current = currentTab()
                      if (current && tabKey(tab) === tabKey(current)) return
                      confirmLeave(() => navigateApproved(tabHref(tab), () => {
                        tabs.select(tab)
                        el?.scrollIntoView({ behavior: "instant" })
                      }))
                    }}
                    onClose={(tab) => {
                      const index = tabsStore.findIndex((item) => tabKey(item) === tabKey(tab))
                      if (index !== -1) closeTabSafely(index)
                    }}
                    onReorder={(keys) => tabsStoreActions.reorder(keys)}
                  />
                </div>

                <div class="min-w-0 flex-1" />
                <TitlebarV2Right state={v2RightState()} />
              </div>
            )
          }}
        </Match>
        <Match when>
          <div
            class="grid h-full min-h-full w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
            style={{ zoom: counterZoom() }}
          >
            <div
              classList={{
                "flex items-center min-w-0": true,
                "pl-2": !macTrafficLights(),
              }}
            >
              <Show when={windows() || linux()}>
                <WindowsAppMenu command={command} platform={platform} />
              </Show>
              <Show when={mac()}>
                <div class="xl:hidden w-10 shrink-0 flex items-center justify-center">
                  <IconButton
                    icon="menu"
                    variant="ghost"
                    class="titlebar-icon rounded-md"
                    onClick={layout.mobileSidebar.toggle}
                    aria-label={language.t("sidebar.menu.toggle")}
                    aria-expanded={layout.mobileSidebar.opened()}
                  />
                </div>
              </Show>
              <Show when={!mac()}>
                <div class="xl:hidden w-[48px] shrink-0 flex items-center justify-center">
                  <IconButton
                    icon="menu"
                    variant="ghost"
                    class="titlebar-icon rounded-md"
                    onClick={layout.mobileSidebar.toggle}
                    aria-label={language.t("sidebar.menu.toggle")}
                    aria-expanded={layout.mobileSidebar.opened()}
                  />
                </div>
              </Show>
              <div class="flex items-center gap-1 shrink-0">
                <TooltipKeybind
                  class={web() ? "hidden xl:flex shrink-0 ml-14" : "hidden xl:flex shrink-0 ml-2"}
                  placement="bottom"
                  title={language.t("command.sidebar.toggle")}
                  keybind={command.keybind("sidebar.toggle")}
                >
                  <Button
                    variant="ghost"
                    class="group/sidebar-toggle titlebar-icon w-8 h-6 p-0 box-border"
                    onClick={layout.sidebar.toggle}
                    aria-label={language.t("command.sidebar.toggle")}
                    aria-expanded={layout.sidebar.opened()}
                  >
                    <Icon size="small" name={layout.sidebar.opened() ? "sidebar-active" : "sidebar"} />
                  </Button>
                </TooltipKeybind>
                <div class="hidden xl:flex items-center shrink-0">
                  <Show when={params.dir}>
                    <div
                      class="flex items-center shrink-0 w-8 mr-1"
                      aria-hidden={layout.sidebar.opened() ? "true" : undefined}
                    >
                      <div
                        class="transition-opacity"
                        classList={{
                          "opacity-100 duration-120 ease-out": !layout.sidebar.opened(),
                          "opacity-0 duration-120 ease-in delay-0 pointer-events-none": layout.sidebar.opened(),
                        }}
                      >
                        <TooltipKeybind
                          placement="bottom"
                          title={language.t("command.session.new")}
                          keybind={command.keybind("session.new")}
                          openDelay={800}
                        >
                          <Button
                            variant="ghost"
                            class="titlebar-icon w-8 h-6 p-0 box-border"
                            disabled={layout.sidebar.opened()}
                            tabIndex={layout.sidebar.opened() ? -1 : undefined}
                            onClick={() => navigate("/")}
                            aria-label={language.t("command.session.new")}
                            aria-current={creating() ? "page" : undefined}
                          >
                            <IconV2 name="edit" size="small" />
                          </Button>
                        </TooltipKeybind>
                      </div>
                    </div>
                  </Show>
                  <div
                    class="flex items-center shrink-0"
                    classList={{
                      "ltr:-translate-x-[36px] rtl:translate-x-[36px]": layout.sidebar.opened() && !!params.dir,
                      "duration-180 ease-out": !layout.sidebar.opened(),
                      "duration-180 ease-in": layout.sidebar.opened(),
                    }}
                  >
                    <Show when={hasProjects() && nav()}>
                      <div class="flex items-center gap-0 transition-transform">
                        <Tooltip placement="bottom" value={language.t("common.goBack")} openDelay={800}>
                          <Button
                            variant="ghost"
                            icon="chevron-left"
                            class="titlebar-icon w-6 h-6 p-0 box-border"
                            disabled={!canBack()}
                            onClick={back}
                            aria-label={language.t("common.goBack")}
                          />
                        </Tooltip>
                        <Tooltip placement="bottom" value={language.t("common.goForward")} openDelay={800}>
                          <Button
                            variant="ghost"
                            icon="chevron-right"
                            class="titlebar-icon w-6 h-6 p-0 box-border"
                            disabled={!canForward()}
                            onClick={forward}
                            aria-label={language.t("common.goForward")}
                          />
                        </Tooltip>
                      </div>
                    </Show>
                    <div id="opencode-titlebar-left" class="flex items-center gap-3 min-w-0 px-2" />
                  </div>
                </div>
                <ChannelIndicator debugTools={props.debugTools} />
              </div>
            </div>

            <div class="min-w-0 flex items-center justify-center pointer-events-none">
              <div
                id="opencode-titlebar-center"
                class="pointer-events-auto min-w-0 flex justify-center w-fit max-w-full"
              />
            </div>

            <div
              classList={{
                "flex items-center min-w-0 justify-end": true,
                "pr-2": !windows(),
              }}
              data-tauri-drag-region
            >
              <div id="opencode-titlebar-right" class="flex items-center gap-1 shrink-0 justify-end" />
              <Show when={windows()}>
                <div class="shrink-0" style={{ width: windowsControlsWidth() }} />
              </Show>
            </div>
          </div>
        </Match>
      </Switch>
    </header>
  )
}

type TitlebarUpdatePillState = {
  visible: boolean
  installing: boolean
  label: string
  ariaLabel: string
  title?: string
  onInstall: () => void
}

type TitlebarV2RightState = {
  update: TitlebarUpdatePillState
}

function TitlebarV2Right(props: { state: TitlebarV2RightState }) {
  return (
    <div class="pointer-events-auto relative z-20 flex shrink-0 items-center justify-end gap-0 overflow-visible">
      <Show when={props.state.update.visible}>
        <TitlebarUpdateIconButton state={props.state.update} />
      </Show>
      <div id="opencode-titlebar-right" class="flex shrink-0 items-center justify-end gap-0" />
    </div>
  )
}

function TitlebarUpdateIconButton(props: { state: TitlebarUpdatePillState }) {
  return (
    <div class="group relative mr-3 h-5 w-5 shrink-0 rounded-full bg-v2-background-bg-deep transition-[width] duration-150 ease-out hover:z-30 hover:w-[68px] focus-within:z-30 focus-within:w-[68px] motion-reduce:transition-none">
      <button
        type="button"
        class="absolute right-0 top-0 z-10 flex h-5 w-5 items-center justify-end overflow-hidden rounded-full bg-v2-icon-icon-accent/20 text-v2-icon-icon-accent transition-[width,background-color] duration-150 ease-out group-hover:w-[68px] group-hover:bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_20%,var(--v2-background-bg-deep))] group-focus-within:w-[68px] group-focus-within:bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_20%,var(--v2-background-bg-deep))] focus-visible:outline-none disabled:opacity-60 motion-reduce:transition-none"
        onClick={props.state.onInstall}
        disabled={props.state.installing}
        aria-busy={props.state.installing}
        aria-label={props.state.ariaLabel}
      >
        <span class="shrink-0 ml-[8px] mr-px text-[11px] text-v2-text-text-accent [font-weight:530] opacity-0 translate-x-2 motion-safe:transition-all duration-150 ease-out group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0 motion-reduce:translate-x-0">
          {props.state.label}
        </span>
        <span class="flex size-5 shrink-0 items-center justify-center">
          <Show
            when={!props.state.installing}
            fallback={<span data-slot="titlebar-update-loader" aria-hidden="true" />}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 11V3M3.5 7.63128L7 11L10.5 7.63128" stroke="currentColor" />
            </svg>
          </Show>
        </span>
      </button>
    </div>
  )
}

function ChannelIndicator(props: { debugTools?: { visible: boolean; toggle: () => void } }) {
  const channel = import.meta.env.VITE_SPINOSA_CHANNEL
  if (channel === "dev" && props.debugTools) {
    return (
      <button
        type="button"
        class="bg-icon-interactive-base text-[#FFF] font-medium px-2 rounded-sm uppercase font-mono cursor-pointer"
        onClick={props.debugTools.toggle}
        aria-label="Toggle debug tools"
        aria-pressed={props.debugTools.visible}
      >
        DEV
      </button>
    )
  }

  return (
    <>
      {channel && ["beta", "dev"].includes(channel) && (
        <div class="bg-icon-interactive-base text-[#FFF] font-medium px-2 rounded-sm uppercase font-mono">
          {channel.toUpperCase()}
        </div>
      )}
    </>
  )
}
