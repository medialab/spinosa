import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createResource, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useBindings } from "../keymap"
import { buttonBackground, buttonBorder, buttonText } from "../util/button"
import { useTerminalDimensions } from "@opentui/solid"
import { truncatePathTail } from "../spinosa/truncate-path"
import { listRegisteredWorkspaces, unregisterWorkspace } from "../spinosa/service"
import { resolveWorkspaceDisplayName } from "../spinosa/workspace-name"
import {
  cycleManageStaleAction,
  formatUnregisterFailures,
  isStaleWorkspacePresence,
  manageStaleActionGlyph,
  manageStaleNameBudget,
  manageStaleResponsiveCols,
  manageStaleTableWidth,
  MANAGE_STALE_ACTION_BTN,
  MANAGE_STALE_COL,
  MANAGE_STALE_SCROLL_HEIGHT,
  moveManageStaleRow,
  stalePresenceDisplay,
  type ManageStaleAction,
} from "../spinosa/manage-stale"
import { Locale } from "../util/locale"
import type { SpinosaWorkspaceID } from "@spinosa/core/workspace/identity"
import type { SpinosaWorkspacePresence } from "@spinosa/core/types"
import { DialogSpinosaMissingWorkspace } from "./dialog-spinosa-missing-workspace"

export type ManageStaleRow = {
  path: string
  name: string
  workspaceID?: SpinosaWorkspaceID
  presence?: SpinosaWorkspacePresence
}

export function DialogSpinosaManageStale(props: {
  onBack: () => void
  /** Optional hook after a successful path/scan recover (before list refresh). */
  onRecoveredStay?: (workspacePath: string) => void | Promise<void>
  onRegisterEscape?: (handler: () => boolean) => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const cols = createMemo(() => manageStaleResponsiveCols(dimensions().width))
  const tableWidth = createMemo(() => manageStaleTableWidth(cols()))
  const [store, setStore] = createStore({
    selected: 0,
    action: "path" as ManageStaleAction,
    busy: false,
    message: "",
    deleteArmed: false as false | "row" | "all",
    deleteArmedPath: undefined as string | undefined,
    recover: undefined as ManageStaleRow | undefined,
    recoverAction: "path" as "path" | "scan",
  })
  let recoverEscape: (() => boolean) | undefined

  const [rows, { refetch }] = createResource(async () => {
    const list = await listRegisteredWorkspaces()
    return list
      .filter((ws) => isStaleWorkspacePresence(ws.presence))
      .map((ws) => ({
        path: ws.path,
        name: resolveWorkspaceDisplayName(ws.path, ws.projectName),
        workspaceID: ws.workspaceID,
        presence: ws.presence,
      } satisfies ManageStaleRow))
  })

  const stale = createMemo(() => rows() ?? [])
  const selectedRow = createMemo(() => stale()[store.selected])

  const clearDeleteArm = () => setStore({ deleteArmed: false, deleteArmedPath: undefined })

  const handleEscape = (): boolean => {
    if (store.recover) {
      return recoverEscape?.() ?? true
    }
    if (store.busy) return true
    if (store.deleteArmed) {
      clearDeleteArm()
      setStore("message", "")
      return true
    }
    props.onBack()
    return true
  }

  const registerEscape = () => {
    props.onRegisterEscape?.(handleEscape)
  }

  onMount(() => {
    dialog.setSize("xlarge")
    registerEscape()
  })

  createEffect(() => {
    store.recover
    store.busy
    store.deleteArmed
    registerEscape()
  })

  const syncSelection = (list: ManageStaleRow[]) => {
    if (list.length === 0) {
      props.onBack()
      return
    }
    setStore("selected", Math.min(store.selected, list.length - 1))
  }

  async function refreshAfterChange() {
    const next = (await refetch()) ?? []
    if (next.length === 0) {
      props.onBack()
      return
    }
    syncSelection(next)
    setStore({ deleteArmed: false, deleteArmedPath: undefined, message: "", busy: false, recover: undefined })
    dialog.setSize("xlarge")
    registerEscape()
  }

  async function deleteRow(row: ManageStaleRow) {
    if (store.busy) return
    if (store.deleteArmed !== "row" || store.deleteArmedPath !== row.path) {
      setStore({
        deleteArmed: "row",
        deleteArmedPath: row.path,
        message: `Press Del again to remove “${row.name}” from the index. No workspace files will be deleted.`,
      })
      return
    }
    setStore({ busy: true, message: "Removing from index…" })
    try {
      await unregisterWorkspace(row.path)
      await refreshAfterChange()
    } catch (error) {
      setStore({
        busy: false,
        deleteArmed: false,
        deleteArmedPath: undefined,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function deleteAllRemaining() {
    if (store.busy) return
    const list = stale()
    if (list.length === 0) return
    if (store.deleteArmed !== "all") {
      setStore({
        deleteArmed: "all",
        deleteArmedPath: undefined,
        message: `Press again to remove all ${list.length} stale workspace(s) from the index. No workspace files will be deleted.`,
      })
      return
    }
    setStore({ busy: true, message: "Removing stale workspaces…" })
    let removed = 0
    const failures: Array<{ path: string; error: string }> = []
    for (const row of list) {
      try {
        await unregisterWorkspace(row.path)
        removed++
      } catch (error) {
        failures.push({
          path: row.path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (failures.length > 0) {
      setStore({
        busy: false,
        deleteArmed: false,
        deleteArmedPath: undefined,
        message: `Removed ${removed}. Failed: ${formatUnregisterFailures(failures)}`,
      })
      const next = (await refetch()) ?? []
      if (next.length === 0) {
        props.onBack()
        return
      }
      syncSelection(next)
      return
    }
    await refreshAfterChange()
  }

  function openRecover(row: ManageStaleRow, action: "path" | "scan") {
    if (store.busy) return
    setStore({
      recover: row,
      recoverAction: action,
      deleteArmed: false,
      deleteArmedPath: undefined,
      message: "",
    })
    dialog.setSize("large")
  }

  function activateAction(action: ManageStaleAction = store.action) {
    const row = selectedRow()
    if (!row || store.busy) return
    setStore("action", action)
    if (action === "del") void deleteRow(row)
    if (action === "scan") openRecover(row, "scan")
    if (action === "path") openRecover(row, "path")
  }

  useBindings(() => ({
    enabled: !store.recover,
    priority: 1,
    bindings: [
      {
        key: "up",
        desc: "Previous stale workspace",
        group: "Dialog",
        cmd: () => {
          if (store.busy) return
          setStore({ selected: moveManageStaleRow(store.selected, -1, stale().length), deleteArmed: false, deleteArmedPath: undefined })
        },
      },
      {
        key: "k",
        desc: "Previous stale workspace",
        group: "Dialog",
        cmd: () => {
          if (store.busy) return
          setStore({ selected: moveManageStaleRow(store.selected, -1, stale().length), deleteArmed: false, deleteArmedPath: undefined })
        },
      },
      {
        key: "down",
        desc: "Next stale workspace",
        group: "Dialog",
        cmd: () => {
          if (store.busy) return
          setStore({ selected: moveManageStaleRow(store.selected, 1, stale().length), deleteArmed: false, deleteArmedPath: undefined })
        },
      },
      {
        key: "j",
        desc: "Next stale workspace",
        group: "Dialog",
        cmd: () => {
          if (store.busy) return
          setStore({ selected: moveManageStaleRow(store.selected, 1, stale().length), deleteArmed: false, deleteArmedPath: undefined })
        },
      },
      {
        key: "tab",
        desc: "Next row action",
        group: "Dialog",
        cmd: () => {
          if (store.busy) return
          setStore({ action: cycleManageStaleAction(store.action, 1), deleteArmed: false, deleteArmedPath: undefined })
        },
      },
      {
        key: "shift+tab",
        desc: "Previous row action",
        group: "Dialog",
        cmd: () => {
          if (store.busy) return
          setStore({ action: cycleManageStaleAction(store.action, -1), deleteArmed: false, deleteArmedPath: undefined })
        },
      },
      {
        key: "h",
        desc: "Previous row action",
        group: "Dialog",
        cmd: () => {
          if (store.busy) return
          setStore({ action: cycleManageStaleAction(store.action, -1), deleteArmed: false, deleteArmedPath: undefined })
        },
      },
      {
        key: "l",
        desc: "Next row action",
        group: "Dialog",
        cmd: () => {
          if (store.busy) return
          setStore({ action: cycleManageStaleAction(store.action, 1), deleteArmed: false, deleteArmedPath: undefined })
        },
      },
      {
        key: "left",
        desc: "Previous row action",
        group: "Dialog",
        cmd: () => {
          if (store.busy) return
          setStore({ action: cycleManageStaleAction(store.action, -1), deleteArmed: false, deleteArmedPath: undefined })
        },
      },
      {
        key: "right",
        desc: "Next row action",
        group: "Dialog",
        cmd: () => {
          if (store.busy) return
          setStore({ action: cycleManageStaleAction(store.action, 1), deleteArmed: false, deleteArmedPath: undefined })
        },
      },
      {
        key: "1",
        desc: "Delete selected",
        group: "Dialog",
        cmd: () => activateAction("del"),
      },
      {
        key: "2",
        desc: "Scan for selected",
        group: "Dialog",
        cmd: () => activateAction("scan"),
      },
      {
        key: "3",
        desc: "Set path for selected",
        group: "Dialog",
        cmd: () => activateAction("path"),
      },
      {
        key: "return",
        desc: "Run selected row action",
        group: "Dialog",
        cmd: () => activateAction(),
      },
    ],
  }))

  return (
    <Show
      when={store.recover}
      fallback={
        <box paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between" alignItems="center">
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.textMuted} onMouseUp={() => { handleEscape() }}>← Back</text>
              <text attributes={TextAttributes.BOLD} fg={theme.text}>Manage stale workspaces</text>
            </box>
            <text fg={theme.textMuted} onMouseUp={() => { handleEscape() }}>esc</text>
          </box>
          <text fg={theme.textMuted} wrapMode="word">
            × delete · ⌕ scan · → set path · Tab or 1–3 · Enter runs the focused action.
          </text>

          <Show when={rows.loading}>
            <text fg={theme.textMuted}>Loading stale workspaces…</text>
          </Show>

          <Show when={!rows.loading && stale().length === 0}>
            <text fg={theme.textMuted}>No stale workspaces left.</text>
          </Show>

          <Show when={stale().length > 0}>
            <box flexDirection="column" flexShrink={0} width={tableWidth()}>
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                flexShrink={0}
                backgroundColor={theme.backgroundPanel}
              >
                <box width={cols().name} flexShrink={0}><text fg={theme.textMuted}>Name</text></box>
                <box width={cols().path} flexShrink={0}><text fg={theme.textMuted}>Path</text></box>
                <box width={cols().status} flexShrink={0}><text fg={theme.textMuted}>Status</text></box>
                <box width={cols().actions} flexShrink={0}><text fg={theme.textMuted}>Actions</text></box>
              </box>
              <scrollbox
                stickyScroll={false}
                stickyStart="top"
                height={MANAGE_STALE_SCROLL_HEIGHT}
                flexShrink={0}
              >
                <For each={stale()}>
                  {(row, i) => {
                    const active = () => store.selected === i()
                    const nameText = Locale.truncate(row.name, manageStaleNameBudget(cols().name))
                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        paddingLeft={1}
                        paddingRight={1}
                        flexShrink={0}
                        backgroundColor={active() ? theme.backgroundElement : i() % 2 === 0 ? theme.backgroundPanel : "transparent"}
                        border={["left"]}
                        borderColor={active() ? theme.borderActive : theme.border}
                        onMouseOver={() => setStore("selected", i())}
                      >
                        <box width={cols().name} flexShrink={0}>
                          <text fg={theme.error} overflow="hidden" wrapMode="none">
                            <span style={{ bold: active() }}>{active() ? "› " : "  "}✕ {nameText}</span>
                          </text>
                        </box>
                        <box width={cols().path} flexShrink={0}>
                          <text fg={theme.textMuted} overflow="hidden" wrapMode="none">
                            {truncatePathTail(row.path, cols().path - 2)}
                          </text>
                        </box>
                        <box width={cols().status} flexShrink={0}>
                          <text fg={theme.error} overflow="hidden" wrapMode="none">
                            {stalePresenceDisplay(row.presence)}
                          </text>
                        </box>
                        <box
                          width={cols().actions}
                          minWidth={cols().actions}
                          flexShrink={0}
                          flexDirection="row"
                          gap={1}
                          alignItems="center"
                        >
                          {(["del", "scan", "path"] as const).map((action) => {
                            const focused = () => active() && store.action === action
                            return (
                              <box
                                width={MANAGE_STALE_ACTION_BTN}
                                minWidth={MANAGE_STALE_ACTION_BTN}
                                flexShrink={0}
                                alignItems="center"
                                justifyContent="center"
                                backgroundColor={buttonBackground(theme, focused())}
                                onMouseOver={() => setStore({ selected: i(), action })}
                                onMouseUp={() => {
                                  if (store.busy) return
                                  setStore({ selected: i(), action })
                                  activateAction(action)
                                }}
                              >
                                <text
                                  fg={buttonText(theme, focused(), action === "del" ? theme.error : theme.primary)}
                                  wrapMode="none"
                                  overflow="hidden"
                                >
                                  {manageStaleActionGlyph(action)}
                                </text>
                              </box>
                            )
                          })}
                        </box>
                      </box>
                    )
                  }}
                </For>
              </scrollbox>
            </box>
          </Show>

          <Show when={store.message}>
            <box flexShrink={0}>
              <text fg={store.deleteArmed ? theme.warning : theme.textMuted} wrapMode="word">{store.message}</text>
            </box>
          </Show>

          <box flexDirection="row" justifyContent="space-between" alignItems="center" paddingTop={1} flexShrink={0} gap={2}>
            <box flexShrink={1} minWidth={0}>
              <text fg={theme.textMuted} wrapMode="none" overflow="hidden">
                ↑↓ row · Tab/1–3 · Enter · Esc back
              </text>
            </box>
            <Show when={stale().length > 0}>
              <box
                flexShrink={0}
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={buttonBackground(theme, store.deleteArmed === "all")}
                border={["left"]}
                borderColor={buttonBorder(theme, store.deleteArmed === "all", theme.error)}
                onMouseUp={() => {
                  if (!store.busy) void deleteAllRemaining()
                }}
              >
                <text fg={buttonText(theme, store.deleteArmed === "all", theme.error)}>
                  {store.deleteArmed === "all" ? "Confirm delete all" : `Delete all ${stale().length}`}
                </text>
              </box>
            </Show>
          </box>
        </box>
      }
    >
      {(row) => (
        <DialogSpinosaMissingWorkspace
          workspacePath={row().path}
          workspaceName={row().name}
          workspaceID={row().workspaceID}
          initialAction={store.recoverAction}
          onRegisterEscape={(handler) => {
            recoverEscape = handler
            registerEscape()
          }}
          onBack={() => {
            recoverEscape = undefined
            setStore({ recover: undefined })
            dialog.setSize("xlarge")
            registerEscape()
          }}
          onRemoved={async () => {
            recoverEscape = undefined
            await refreshAfterChange()
          }}
          onRecovered={async (workspacePath) => {
            recoverEscape = undefined
            await props.onRecoveredStay?.(workspacePath)
            await refreshAfterChange()
          }}
        />
      )}
    </Show>
  )
}
