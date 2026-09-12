import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { dirname, join } from "node:path"
import { statSync } from "node:fs"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useRoute } from "../context/route"
import { useOpencodeKeymap } from "../keymap"
import {
  inspectWorkspaceTemplatePack,
  listRegisteredWorkspaces,
  readBundledFrameworkVersion,
  readWorkspaceMeta,
  workspaceNeedsFrameworkUpdate,
} from "../spinosa/service"
import { setupStatusLabel } from "../spinosa/status-labels"
import { truncatePathTail } from "../spinosa/truncate-path"
import { useSpinosaWorkspace } from "../context/spinosa-workspace"
import { getWorkspaceLaunchDecision } from "../spinosa/workspace-launch"
import { resolveWorkspaceDisplayName } from "../spinosa/workspace-name"
import { isStaleWorkspacePresence, stalePresenceDisplay } from "../spinosa/manage-stale"
import { DialogSpinosaStartupChoice } from "./dialog-spinosa-startup-choice"
import { DialogSpinosaIncompleteImport } from "./dialog-spinosa-incomplete-import"
import { DialogSpinosaMissingWorkspace } from "./dialog-spinosa-missing-workspace"
import { DialogSpinosaManageStale } from "./dialog-spinosa-manage-stale"
import { buttonBackground, buttonBorder, buttonText } from "../util/button"
import type { SpinosaSetupStatus } from "../spinosa/types"
import type { SpinosaWorkspacePresence } from "@spinosa/core/types"
import { isUsableWorkspaceStatus } from "@spinosa/core/workspace/presence"
import type { SpinosaWorkspaceID } from "@spinosa/core/workspace/identity"

type SortColumn = "name" | "folder" | "status" | "version" | "accessed"
type SortDir = "asc" | "desc"

type SelectWorkspaceRow = {
  path: string
  name: string
  projectName: string
  workspaceID?: SpinosaWorkspaceID
  parentFolder: string
  status: SpinosaSetupStatus
  version: string
  needsUpdate: boolean
  lastAccessed: number
  presence?: SpinosaWorkspacePresence
  available: boolean
}

function relativeTime(timestamp: number): string {
  if (timestamp <= 0) return "unknown"
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function getParentFolder(workspacePath: string): string {
  return dirname(workspacePath)
}

function getLastAccessed(workspacePath: string): number {
  try {
    return statSync(join(workspacePath, ".spinosa", "workspace")).mtimeMs
  } catch {
    return 0
  }
}

export function DialogSpinosaWorkspacePicker(props: { onClose?: () => void } = {}) {
  const dialog = useDialog()
  const route = useRoute()
  const spinosa = useSpinosaWorkspace()
  const { theme } = useTheme()
  const keymap = useOpencodeKeymap()
  const dimensions = useTerminalDimensions()

  const compactColumns = () => dimensions().width < 72
  const showVersion = () => dimensions().width >= 72
  const showAccessed = () => dimensions().width >= 94
  const nameWidth = () => compactColumns() ? 20 : 22
  const folderWidth = () => compactColumns() ? 17 : showAccessed() ? 24 : 22
  const statusWidth = () => compactColumns() ? 13 : 14

  const [sortColumn, setSortColumn] = createSignal<SortColumn>("name")
  const [sortDir, setSortDir] = createSignal<SortDir>("asc")
  const [selected, setSelected] = createSignal(0)

  const toggleSort = (column: SortColumn) => {
    if (sortColumn() === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortColumn(column)
      setSortDir("asc")
    }
  }

  const [workspaces, { refetch: refetchWorkspaces }] = createResource(() => spinosa.bootReady, async (bootReady) => {
    if (!bootReady) return []
    const list = await listRegisteredWorkspaces()
    const bundled = await readBundledFrameworkVersion().catch(() => "unknown")
    const pairs = await Promise.all(
      list.map(async (ws) => ({ ws, meta: await readWorkspaceMeta(ws.path).catch(() => undefined) })),
    )
    const rows = await Promise.all(
      pairs.map(async ({ ws, meta }) => {
        const freshness = meta
          ? await inspectWorkspaceTemplatePack({
              workspacePath: ws.path,
              workspaceVersion: meta.frameworkVersion,
              bundledVersion: bundled,
            }).catch(() => undefined)
          : undefined
        return {
          path: ws.path,
          name: resolveWorkspaceDisplayName(ws.path, meta?.projectName ?? ws.projectName),
          projectName: meta?.projectName ?? ws.projectName,
          workspaceID: ws.workspaceID,
          parentFolder: getParentFolder(ws.path),
          status: meta?.setupStatus || "unknown",
          version: meta?.frameworkVersion || "unknown",
          needsUpdate:
            freshness?.refreshRecommended ??
            workspaceNeedsFrameworkUpdate(meta?.frameworkVersion, bundled),
          lastAccessed: getLastAccessed(ws.path),
          presence: ws.presence,
          available: !!meta && isUsableWorkspaceStatus(ws.presence),
        } satisfies SelectWorkspaceRow
      }),
    )
    return rows
  })

  const workspaceError = createMemo(() => {
    const error = workspaces.error
    if (!error) return undefined
    return error instanceof Error ? error.message : String(error)
  })

  const sorted = createMemo(() => {
    // Solid rethrows on workspaces() when the resource is errored — keep picker alive.
    if (workspaces.error) return []
    const rows = workspaces() ?? []
    const col = sortColumn()
    const dir = sortDir()
    const copy = [...rows]
    copy.sort((a, b) => {
      let cmp = 0
      switch (col) {
        case "name": cmp = a.name.localeCompare(b.name); break
        case "folder": cmp = a.parentFolder.localeCompare(b.parentFolder); break
        case "status": cmp = a.status.localeCompare(b.status); break
        case "version": cmp = a.version.localeCompare(b.version); break
        case "accessed": cmp = a.lastAccessed - b.lastAccessed; break
      }
      return dir === "desc" ? -cmp : cmp
    })
    return copy
  })

  const navCount = createMemo(() => sorted().length + 1) // rows + New workspace
  const staleCount = createMemo(() => sorted().filter((w) => isStaleWorkspacePresence(w.presence)).length)
  const close = () => {
    dialog.clear()
    props.onClose?.()
  }

  const reopenPicker = () => {
    void refetchWorkspaces()
    dialog.replace(
      () => <DialogSpinosaWorkspacePicker onClose={props.onClose} />,
      undefined,
      () => {
        dialog.dismiss()
        props.onClose?.()
      },
    )
  }

  async function openWorkspace(path: string) {
    const launch = await getWorkspaceLaunchDecision(path)
    if (launch.type === "startup-choice") {
      const returnToPicker = () => reopenPicker()
      dialog.replace(() => (
        <DialogSpinosaStartupChoice
          workspacePath={launch.workspacePath}
          workspaceName={launch.workspaceName}
          prompt={launch.prompt}
          onBack={returnToPicker}
        />
      ), undefined, returnToPicker)
      return
    }
    if (launch.type === "incomplete-import") {
      const returnToPicker = () => reopenPicker()
      dialog.replace(() => (
        <DialogSpinosaIncompleteImport
          workspacePath={launch.workspacePath}
          workspaceName={launch.workspaceName}
          onBack={returnToPicker}
          onContinued={async () => {
            dialog.dismiss()
            // openWorkspace routes `importing` workspaces to onboarding.
            await spinosa.openWorkspace(launch.workspacePath)
          }}
          onRemoved={async () => {
            reopenPicker()
          }}
        />
      ), undefined, returnToPicker)
      return
    }
    dialog.dismiss()
    await spinosa.openWorkspace(path)
  }

  function openMissingWorkspace(row: SelectWorkspaceRow) {
    const escapeRef = { current: () => reopenPicker() }
    dialog.replace(
      () => (
        <DialogSpinosaMissingWorkspace
          workspacePath={row.path}
          workspaceName={row.projectName || row.name}
          workspaceID={row.workspaceID}
          onRegisterEscape={(handler) => {
            escapeRef.current = () => {
              handler()
            }
          }}
          onBack={reopenPicker}
          onRemoved={async () => {
            reopenPicker()
          }}
          onRecovered={(workspacePath) => openWorkspace(workspacePath)}
        />
      ),
      undefined,
      () => escapeRef.current(),
    )
  }

  function openManageStale() {
    if (workspaces.loading || staleCount() === 0) return
    const escapeRef = { current: () => reopenPicker() }
    dialog.replace(
      () => (
        <DialogSpinosaManageStale
          onRegisterEscape={(handler) => {
            escapeRef.current = () => {
              handler()
            }
          }}
          onBack={reopenPicker}
        />
      ),
      undefined,
      () => escapeRef.current(),
    )
  }

  async function chooseWorkspace(row: SelectWorkspaceRow) {
    if (!row.available) {
      openMissingWorkspace(row)
      return
    }
    await openWorkspace(row.path)
  }

  onMount(() => {
    dialog.setSize("xlarge")

    const off = keymap.intercept("key", ({ event, consume }) => {
      if (event.name === "up" || event.name === "k") {
        setSelected((v) => Math.max(0, v - 1))
        consume(); return
      }
      if (event.name === "down" || event.name === "j") {
        setSelected((v) => Math.min(navCount() - 1, v + 1))
        consume(); return
      }
      if (event.name === "return") {
        const idx = selected()
        const rows = sorted()
        if (idx < rows.length) {
          const row = rows[idx]
          if (row) void chooseWorkspace(row)
        } else if (idx === rows.length) {
          dialog.dismiss()
          route.navigate({ type: "onboarding" })
        }
        consume(); return
      }
    })
    onCleanup(off)
  })

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={1}>
      {/* ── back button ── */}
      <box flexDirection="row" alignItems="center" justifyContent="space-between">
        <box flexDirection="row" alignItems="center" gap={1}>
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            onMouseDown={close}
          >
            <text fg={theme.textMuted}>← Back</text>
          </box>
          <text fg={theme.text}>
            <span style={{ bold: true }}>Choose a workspace</span>
          </text>
        </box>
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          onMouseDown={workspaces.loading || staleCount() === 0 ? undefined : openManageStale}
        >
          <text fg={staleCount() > 0 ? theme.warning : theme.textMuted}>
            {staleCount() > 0 ? `Manage ${staleCount()} stale` : "No stale"}
          </text>
        </box>
      </box>
      <box height={1} />

      {/* ── loading ── */}
      <Show when={workspaces.loading}>
        <text fg={theme.textMuted}>Loading saved workspaces…</text>
      </Show>

      {/* ── error ── */}
      <Show when={workspaceError()}>
        {(message) => (
          <box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
            <text fg={theme.error}>Couldn’t load workspaces: {message()}</text>
          </box>
        )}
      </Show>

      {/* ── table ── */}
      <Show when={sorted().length > 0}>
        <box flexDirection="column">
          {/* header row */}
          <box
            flexDirection="row"
            gap={1}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={theme.backgroundPanel}
          >
            <box width={nameWidth()} onMouseDown={() => toggleSort("name")}>
              <text fg={theme.textMuted}>
                Name{sortColumn() === "name" ? (sortDir() === "asc" ? " ↑" : " ↓") : ""}
              </text>
            </box>
            <box width={folderWidth()} onMouseDown={() => toggleSort("folder")}>
              <text fg={theme.textMuted}>
                Parent{sortColumn() === "folder" ? (sortDir() === "asc" ? " ↑" : " ↓") : ""}
              </text>
            </box>
            <box width={statusWidth()} onMouseDown={() => toggleSort("status")}>
              <text fg={theme.textMuted}>
                Status{sortColumn() === "status" ? (sortDir() === "asc" ? " ↑" : " ↓") : ""}
              </text>
            </box>
            <Show when={showVersion()}>
              <box width={9} onMouseDown={() => toggleSort("version")}>
                <text fg={theme.textMuted}>
                  Ver{sortColumn() === "version" ? (sortDir() === "asc" ? " ↑" : " ↓") : ""}
                </text>
              </box>
            </Show>
            <Show when={showAccessed()}>
              <box width={17} onMouseDown={() => toggleSort("accessed")}>
                <text fg={theme.textMuted}>
                  Accessed{sortColumn() === "accessed" ? (sortDir() === "asc" ? " ↑" : " ↓") : ""}
                </text>
              </box>
            </Show>
          </box>

          {/* data rows */}
          {/* Fixed height: content-derived heights made the dialog jump while sorting/filtering. */}
          <scrollbox
            stickyScroll={false}
            stickyStart="top"
            height={16}
          >
            <For each={sorted()}>
              {(row, i) => {
                const active = () => selected() === i()
                return (
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={active() ? theme.backgroundElement : i() % 2 === 0 ? theme.backgroundPanel : "transparent"}
                    border={["left"]}
                    borderColor={active() ? theme.borderActive : theme.border}
                    flexDirection="row"
                    gap={1}
                    onMouseOver={() => setSelected(i())}
                    onMouseDown={() => { setSelected(i()); void chooseWorkspace(row) }}
                  >
                    <box width={nameWidth()}>
                      <text fg={row.available ? theme.text : theme.error} overflow="hidden" wrapMode="none">
                        <span style={{ bold: active() }}>{active() ? "› " : "  "}{row.available ? "" : "✕ "}{row.name}</span>
                      </text>
                    </box>
                    <box width={folderWidth()}>
                      <text fg={theme.textMuted} overflow="hidden" wrapMode="none">
                        {truncatePathTail(row.parentFolder, Math.max(8, folderWidth() - 2))}
                      </text>
                    </box>
                    <box width={statusWidth()} flexShrink={0}>
                      <text fg={row.available ? theme.textMuted : theme.error} overflow="hidden" wrapMode="none">
                        {isStaleWorkspacePresence(row.presence)
                          ? `✕ ${stalePresenceDisplay(row.presence)}`
                          : row.presence === "legacy" ? "Legacy" : setupStatusLabel(row.status)}
                      </text>
                    </box>
                    <Show when={showVersion()}>
                      <box width={9} flexShrink={0}>
                        <text fg={theme.textMuted} overflow="hidden" wrapMode="none">
                          v{row.version}{row.needsUpdate ? " ⚠" : ""}
                        </text>
                      </box>
                    </Show>
                    <Show when={showAccessed()}>
                      <box width={17} flexShrink={0}>
                        <text fg={theme.textMuted} overflow="hidden" wrapMode="none">
                          {relativeTime(row.lastAccessed)}
                        </text>
                      </box>
                    </Show>
                  </box>
                )
              }}
            </For>
          </scrollbox>
        </box>
      </Show>

      {/* ── empty ── */}
      <Show when={!workspaces.loading && !workspaceError() && sorted().length === 0}>
        <box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
          <text fg={theme.textMuted}>No saved workspaces yet. Create one to begin.</text>
        </box>
      </Show>

      {/* ── separator + New workspace ── */}
      <box height={1} />
      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        marginTop={1}
        backgroundColor={buttonBackground(theme, selected() === sorted().length)}
        border={["left"]}
        borderColor={buttonBorder(theme, selected() === sorted().length, theme.borderActive)}
        onMouseDown={() => { dialog.dismiss(); route.navigate({ type: "onboarding" }) }}
        onMouseOver={() => setSelected(sorted().length)}
      >
        <text fg={buttonText(theme, selected() === sorted().length, theme.primary)}>
          <span style={{ bold: selected() === sorted().length }}>
            {selected() === sorted().length ? "› " : "  "}+ New workspace
          </span>
        </text>
        <text fg={buttonText(theme, selected() === sorted().length, theme.textMuted)}>
          Import source folders into a new workspace
        </text>
      </box>
    </box>
  )
}
