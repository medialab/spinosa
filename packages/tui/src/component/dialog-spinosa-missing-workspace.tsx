import { InputRenderable, TextAttributes } from "@opentui/core"
import { createEffect, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { Spinner } from "./spinner"
import { buttonBackground, buttonBorder, buttonText } from "../util/button"
import { HoverChip, HoverLabel } from "../ui/hover-press"
import { truncatePathTail } from "../spinosa/truncate-path"
import { unregisterWorkspace } from "@spinosa/core/workspace/registry"
import {
  recoverWorkspaceAtPath,
  scanAndRecoverWorkspace,
  workspaceRecoveryScanPlan,
} from "@spinosa/core/workspace/recovery"
import type { SpinosaWorkspaceID } from "@spinosa/core/workspace/identity"
import { useBindings } from "../keymap"

type MissingWorkspaceAction = "path" | "scan" | "remove"
type MissingWorkspacePhase = "actions" | "scan-confirm" | "scanning" | "matches"

export function DialogSpinosaMissingWorkspace(props: {
  workspacePath: string
  workspaceName: string
  workspaceID?: SpinosaWorkspaceID
  /** Prefer path / scan / remove when opened from Manage stale row actions. */
  initialAction?: MissingWorkspaceAction
  onBack: () => void
  onRecovered: (workspacePath: string) => void | Promise<void>
  onRemoved: () => void | Promise<void>
  /** Nested Esc handler for dialog.replace stacks (returns true when handled). */
  onRegisterEscape?: (handler: () => boolean) => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const scanPlan = () => workspaceRecoveryScanPlan(props.workspacePath)
  const initial = props.initialAction ?? "path"
  const [store, setStore] = createStore({
    active: initial as MissingWorkspaceAction,
    phase: "actions" as MissingWorkspacePhase,
    candidatePath: "",
    busy: false,
    message: "",
    progress: "",
    removeArmed: false,
    matches: [] as string[],
    selectedMatch: 0,
  })
  let input: InputRenderable
  let generation = 0
  let scanController: AbortController | undefined

  const focusInput = () => setTimeout(() => {
    if (!input || input.isDestroyed || store.busy || store.phase !== "actions") return
    input.focus()
  }, 1)

  const handleEscape = (): boolean => {
    if (store.phase === "scanning") {
      cancelScan()
      return true
    }
    if (store.phase === "scan-confirm" || store.phase === "matches") {
      leaveSubphase()
      return true
    }
    if (store.busy) return true
    back()
    return true
  }

  onMount(() => {
    dialog.setSize("large")
    props.onRegisterEscape?.(handleEscape)
    if (props.initialAction === "scan") {
      queueMicrotask(() => promptScan())
      return
    }
    if (props.initialAction === "remove") {
      setStore({ active: "remove", removeArmed: false })
    }
    focusInput()
  })

  onCleanup(() => {
    generation++
    scanController?.abort()
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    const suspend = store.busy || store.phase !== "actions"
    input.traits = suspend ? { suspend: true, status: "BUSY" } : { status: "WORKSPACE PATH" }
    if (suspend) input.blur()
  })

  const begin = (message: string) => {
    if (store.busy) return false
    generation++
    setStore({ busy: true, message, progress: "", removeArmed: false })
    input?.blur()
    return true
  }

  const finish = (message: string, phase: MissingWorkspacePhase = "actions") => {
    setStore({ busy: false, message, progress: "", phase })
    if (phase === "actions") focusInput()
  }

  async function useCandidatePath(candidatePath = store.candidatePath) {
    if (!candidatePath.trim()) {
      finish("Enter the workspace’s new folder path first.")
      return
    }
    if (!begin("Checking workspace path…")) return
    const currentGeneration = generation
    try {
      const recovered = await recoverWorkspaceAtPath({
        indexedPath: props.workspacePath,
        candidatePath,
        projectName: props.workspaceName,
        workspaceID: props.workspaceID,
      })
      if (currentGeneration !== generation) return
      await props.onRecovered(recovered)
    } catch (error) {
      if (currentGeneration !== generation) return
      finish(error instanceof Error ? error.message : String(error))
    }
  }

  function promptScan() {
    if (!props.workspaceID) {
      finish("This legacy index entry has no workspace ID. Enter its new path instead.")
      return
    }
    const plan = scanPlan()
    if (plan.roots.length === 0) {
      finish("No local search folders are available. Enter the new path instead.")
      return
    }
    setStore({
      active: "scan",
      phase: "scan-confirm",
      removeArmed: false,
      message: "",
      progress: "",
      matches: [],
    })
  }

  async function runScan() {
    if (!props.workspaceID) {
      finish("This legacy index entry has no workspace ID. Enter its new path instead.")
      return
    }
    if (!begin("Scanning this computer for the workspace ID…")) return
    setStore("phase", "scanning")
    scanController?.abort()
    scanController = new AbortController()
    const currentGeneration = generation
    const plan = scanPlan()
    try {
      const result = await scanAndRecoverWorkspace({
        indexedPath: props.workspacePath,
        projectName: props.workspaceName,
        workspaceID: props.workspaceID,
        roots: plan.roots,
        signal: scanController.signal,
        onProgress(progress) {
          if (currentGeneration !== generation) return
          setStore("progress", `${progress.visited} folders · ${truncatePathTail(progress.currentPath, 56)}`)
        },
      })
      if (currentGeneration !== generation) return
      if (result.status === "found") {
        await props.onRecovered(result.path)
        return
      }
      if (result.status === "ambiguous") {
        setStore({
          busy: false,
          phase: "matches",
          matches: result.matches,
          selectedMatch: 0,
          message: `Found ${result.matches.length} folders with this workspace ID. Choose one to repoint.`,
          progress: "",
        })
        return
      }
      finish("No workspace with this ID was found in the listed search locations.")
    } catch (error) {
      if (currentGeneration !== generation) return
      const message = error instanceof Error ? error.message : String(error)
      finish(message.includes("canceled") || message.includes("cancelled")
        ? "Scan canceled."
        : message)
    }
  }

  function cancelScan() {
    scanController?.abort()
    generation++
    setStore({
      busy: false,
      phase: "actions",
      message: "Scan canceled.",
      progress: "",
    })
    focusInput()
  }

  async function chooseMatch(matchPath: string) {
    setStore("candidatePath", matchPath)
    await useCandidatePath(matchPath)
  }

  async function removeFromIndex() {
    if (store.busy) return
    if (!store.removeArmed) {
      setStore({
        active: "remove",
        phase: "actions",
        removeArmed: true,
        message: "Click “Confirm remove” to forget this workspace. No workspace files will be deleted.",
      })
      return
    }
    if (!begin("Removing workspace from the index…")) return
    try {
      await unregisterWorkspace(props.workspacePath)
      await props.onRemoved()
    } catch (error) {
      finish(error instanceof Error ? error.message : String(error))
    }
  }

  const runAction = (action: MissingWorkspaceAction) => {
    if (store.busy || store.phase === "scanning") return
    setStore("active", action)
    if (action !== "remove") setStore("removeArmed", false)
    queueMicrotask(() => {
      if (action === "path") void useCandidatePath()
      if (action === "scan") promptScan()
      if (action === "remove") void removeFromIndex()
    })
  }

  const actions = ["path", "scan", "remove"] as const
  const moveAction = (offset: number) => {
    if (store.busy || store.phase !== "actions") return
    input?.blur()
    const current = Math.max(0, actions.indexOf(store.active))
    setStore("active", actions[(current + offset + actions.length) % actions.length]!)
  }

  const back = () => {
    if (store.busy || store.phase === "scanning") return
    input?.blur()
    props.onBack()
  }

  const leaveSubphase = () => {
    finish("", "actions")
    setStore({ matches: [], selectedMatch: 0 })
  }

  createEffect(() => {
    // Keep the replace-stack Esc handler pointed at the latest phase closure.
    store.phase
    store.busy
    props.onRegisterEscape?.(handleEscape)
  })

  useBindings(() => ({
    enabled: true,
    priority: 1,
    bindings: [
      {
        key: "tab",
        desc: "Next recovery action",
        group: "Dialog",
        cmd: () => {
          if (store.phase === "actions" && !store.busy) moveAction(1)
        },
      },
      {
        key: "shift+tab",
        desc: "Previous recovery action",
        group: "Dialog",
        cmd: () => {
          if (store.phase === "actions" && !store.busy) moveAction(-1)
        },
      },
      {
        key: "left",
        desc: "Previous recovery action",
        group: "Dialog",
        cmd: () => {
          if (store.phase === "actions" && !store.busy && !input?.focused) moveAction(-1)
          if (store.phase === "matches") {
            setStore("selectedMatch", Math.max(0, store.selectedMatch - 1))
          }
        },
      },
      {
        key: "right",
        desc: "Next recovery action",
        group: "Dialog",
        cmd: () => {
          if (store.phase === "actions" && !store.busy && !input?.focused) moveAction(1)
          if (store.phase === "matches") {
            setStore("selectedMatch", Math.min(store.matches.length - 1, store.selectedMatch + 1))
          }
        },
      },
      {
        key: "up",
        desc: "Previous match",
        group: "Dialog",
        cmd: () => {
          if (store.phase === "matches") {
            setStore("selectedMatch", Math.max(0, store.selectedMatch - 1))
          }
        },
      },
      {
        key: "down",
        desc: "Next match",
        group: "Dialog",
        cmd: () => {
          if (store.phase === "matches") {
            setStore("selectedMatch", Math.min(store.matches.length - 1, store.selectedMatch + 1))
          }
        },
      },
      {
        key: "return",
        desc: "Run recovery action",
        group: "Dialog",
        cmd: () => {
          if (store.phase === "scanning" || store.busy) return
          if (store.phase === "scan-confirm") {
            void runScan()
            return
          }
          if (store.phase === "matches") {
            const match = store.matches[store.selectedMatch]
            if (match) void chooseMatch(match)
            return
          }
          if (store.phase === "actions" && !input?.focused) runAction(store.active)
        },
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>Workspace not found</text>
        <HoverLabel onPress={handleEscape}>esc</HoverLabel>
      </box>
      <text fg={theme.error}>✕ {props.workspaceName}</text>
      <text fg={theme.textMuted} wrapMode="word">
        This workspace is still in your index, but its folder is missing. Delete it from the index, provide its new path, or scan this computer for its workspace ID.
      </text>
      <text fg={theme.textMuted}>{truncatePathTail(props.workspacePath, 72)}</text>
      <Show when={props.workspaceID}>
        {(workspaceID) => <text fg={theme.textMuted}>ID: {workspaceID()}</text>}
      </Show>

      <Show when={store.phase === "actions"}>
        <box paddingTop={1}>
          <input
            ref={(value: InputRenderable) => { input = value }}
            onInput={(value) => setStore("candidatePath", value)}
            onSubmit={() => void useCandidatePath()}
            placeholder="New workspace folder path"
            placeholderColor={theme.textMuted}
            textColor={theme.text}
            focusedTextColor={theme.text}
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
          />
        </box>
      </Show>

      <Show when={store.phase === "scan-confirm"}>
        <box paddingTop={1} gap={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>Privacy-first local scan</text>
          <For each={scanPlan().notes}>
            {(note) => <text fg={theme.textMuted} wrapMode="word">• {note}</text>}
          </For>
          <text fg={theme.textMuted}>Folders to scan (depth {scanPlan().maxDepth}):</text>
          <For each={scanPlan().roots}>
            {(root) => <text fg={theme.textMuted}>  · {truncatePathTail(root, 64)}</text>}
          </For>
          <box flexDirection="row" justifyContent="flex-end" gap={2} paddingTop={1}>
            <HoverChip
              paddingLeft={2}
              paddingRight={2}
              border
              label="Cancel"
              inactiveFg={theme.textMuted}
              onPress={leaveSubphase}
            />
            <HoverChip
              paddingLeft={2}
              paddingRight={2}
              border
              label="Start scan"
              inactiveFg={theme.primary}
              onPress={() => void runScan()}
            />
          </box>
        </box>
      </Show>

      <Show when={store.phase === "matches"}>
        <box paddingTop={1} gap={1}>
          <text fg={theme.warning} wrapMode="word">{store.message}</text>
          <For each={store.matches}>
            {(match, index) => {
              const active = () => store.selectedMatch === index()
              return (
                <box
                  paddingLeft={2}
                  paddingRight={2}
                  backgroundColor={buttonBackground(theme, active())}
                  border={["left"]}
                  borderColor={buttonBorder(theme, active(), theme.borderActive)}
                  onMouseOver={() => setStore("selectedMatch", index())}
                  onMouseUp={() => void chooseMatch(match)}
                >
                  <text fg={buttonText(theme, active(), theme.text)}>
                    {truncatePathTail(match, 68)}
                  </text>
                </box>
              )
            }}
          </For>
          <box flexDirection="row" justifyContent="flex-end" gap={2} paddingTop={1}>
            <HoverChip
              paddingLeft={2}
              paddingRight={2}
              border
              label="Back"
              inactiveFg={theme.textMuted}
              onPress={leaveSubphase}
            />
          </box>
        </box>
      </Show>

      <Show when={store.busy || store.phase === "scanning"}>
        <Spinner color={theme.primary}>{store.message || "Scanning…"}</Spinner>
      </Show>
      <Show when={!store.busy && store.phase === "actions" && store.message}>
        <text fg={store.removeArmed ? theme.warning : theme.textMuted} wrapMode="word">{store.message}</text>
      </Show>
      <Show when={store.progress}>
        <text fg={theme.textMuted}>{store.progress}</text>
      </Show>

      <Show when={store.phase === "scanning"}>
        <box flexDirection="row" justifyContent="flex-end" gap={2} paddingTop={1}>
          <HoverChip
            paddingLeft={2}
            paddingRight={2}
            border
            danger
            label="Cancel scan"
            onPress={cancelScan}
          />
        </box>
      </Show>

      <Show when={store.phase === "actions"}>
        <box flexDirection="row" justifyContent="flex-end" gap={2} paddingTop={1}>
          {actions.map((action) => {
            const active = () => store.active === action
            const label = () => action === "path"
              ? "Use new path"
              : action === "scan"
                ? "Scan computer"
                : store.removeArmed ? "Confirm remove" : "Remove from index"
            return (
              <box
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={buttonBackground(theme, active())}
                border={["left"]}
                borderColor={buttonBorder(theme, active(), action === "remove" ? theme.error : theme.borderActive)}
                onMouseOver={() => { if (!store.busy) setStore("active", action) }}
                onMouseUp={() => { if (!store.busy) { input?.blur(); runAction(action) } }}
              >
                <text fg={buttonText(theme, active(), action === "remove" ? theme.error : theme.primary)}>
                  {label()}
                </text>
              </box>
            )
          })}
        </box>
        <text fg={theme.textMuted}>Tab action · Enter run · Esc back</text>
      </Show>
    </box>
  )
}
