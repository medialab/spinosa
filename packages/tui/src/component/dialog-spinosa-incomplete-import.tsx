import { TextAttributes } from "@opentui/core"
import { createEffect, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { Spinner } from "./spinner"
import { buttonBackground, buttonBorder, buttonText } from "../util/button"
import { truncatePathTail } from "../spinosa/truncate-path"
import { unregisterWorkspace } from "@spinosa/core/workspace/registry"
import { useBindings } from "../keymap"

type IncompleteImportAction = "continue" | "delete"

/**
 * Interstitial for workspaces whose import never finished (setup_status is
 * still `importing`). The user either resumes into onboarding as normal or
 * deletes the workspace through the standard remove flow (unregister from
 * the index; no workspace files are deleted).
 */
export function DialogSpinosaIncompleteImport(props: {
  workspacePath: string
  workspaceName: string
  onBack: () => void
  onContinued: () => void | Promise<void>
  onRemoved: () => void | Promise<void>
  /** Nested Esc handler for dialog.replace stacks (returns true when handled). */
  onRegisterEscape?: (handler: () => boolean) => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    active: "continue" as IncompleteImportAction,
    busy: false,
    message: "",
    deleteArmed: false,
  })
  let generation = 0

  const handleEscape = (): boolean => {
    if (store.busy) return true
    back()
    return true
  }

  onMount(() => {
    dialog.setSize("medium")
    props.onRegisterEscape?.(handleEscape)
  })

  onCleanup(() => {
    generation++
  })

  const back = () => {
    if (store.busy) return
    props.onBack()
  }

  async function continueImport() {
    if (store.busy) return
    const currentGeneration = ++generation
    setStore({ busy: true, message: "", deleteArmed: false })
    try {
      await props.onContinued()
      if (currentGeneration !== generation) return
      setStore({ busy: false })
    } catch (error) {
      if (currentGeneration !== generation) return
      setStore({
        busy: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function deleteWorkspace() {
    if (store.busy) return
    if (!store.deleteArmed) {
      setStore({
        active: "delete",
        deleteArmed: true,
        message: "Click “Confirm delete” to forget this workspace. No workspace files will be deleted.",
      })
      return
    }
    const currentGeneration = ++generation
    setStore({ busy: true, message: "" })
    try {
      await unregisterWorkspace(props.workspacePath)
      if (currentGeneration !== generation) return
      await props.onRemoved()
    } catch (error) {
      if (currentGeneration !== generation) return
      setStore({
        busy: false,
        deleteArmed: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const runAction = (action: IncompleteImportAction) => {
    if (store.busy) return
    setStore("active", action)
    if (action !== "delete") setStore("deleteArmed", false)
    queueMicrotask(() => {
      if (action === "continue") void continueImport()
      if (action === "delete") void deleteWorkspace()
    })
  }

  const actions = ["continue", "delete"] as const
  const moveAction = (offset: number) => {
    if (store.busy) return
    const current = Math.max(0, actions.indexOf(store.active))
    const next = actions[(current + offset + actions.length) % actions.length]!
    setStore("active", next)
    if (next !== "delete") setStore("deleteArmed", false)
  }

  useBindings(() => ({
    enabled: true,
    priority: 1,
    bindings: [
      {
        key: "tab",
        desc: "Next action",
        group: "Dialog",
        cmd: () => {
          if (!store.busy) moveAction(1)
        },
      },
      {
        key: "shift+tab",
        desc: "Previous action",
        group: "Dialog",
        cmd: () => {
          if (!store.busy) moveAction(-1)
        },
      },
      {
        key: "left",
        desc: "Previous action",
        group: "Dialog",
        cmd: () => {
          if (!store.busy) moveAction(-1)
        },
      },
      {
        key: "right",
        desc: "Next action",
        group: "Dialog",
        cmd: () => {
          if (!store.busy) moveAction(1)
        },
      },
      {
        key: "return",
        desc: "Run action",
        group: "Dialog",
        cmd: () => {
          if (!store.busy) runAction(store.active)
        },
      },
    ],
  }))

  // Keep the replace-stack Esc handler pointed at the latest closure.
  createEffect(() => {
    store.busy
    props.onRegisterEscape?.(handleEscape)
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>Unfinished import</text>
        <text fg={theme.textMuted} onMouseUp={() => { handleEscape() }}>
          esc
        </text>
      </box>
      <text fg={theme.warning}>◷ {props.workspaceName}</text>
      <text fg={theme.textMuted} wrapMode="word">
        This workspace’s import never finished, so it isn’t ready to open. Continue the import where it left off, or delete the workspace and start over.
      </text>
      <text fg={theme.textMuted}>{truncatePathTail(props.workspacePath, 72)}</text>

      <Show when={store.busy}>
        <Spinner color={theme.primary}>{store.message || "Working…"}</Spinner>
      </Show>
      <Show when={!store.busy && store.message}>
        <text fg={store.deleteArmed ? theme.warning : theme.textMuted} wrapMode="word">{store.message}</text>
      </Show>

      <box flexDirection="row" justifyContent="flex-end" gap={2} paddingTop={1}>
        {actions.map((action) => {
          const active = () => store.active === action
          const label = () =>
            action === "continue"
              ? "Continue import"
              : store.deleteArmed ? "Confirm delete" : "Delete workspace"
          return (
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={buttonBackground(theme, active())}
              border={["left"]}
              borderColor={buttonBorder(theme, active(), action === "delete" ? theme.error : theme.borderActive)}
              onMouseOver={() => { if (!store.busy) setStore("active", action) }}
              onMouseUp={() => { if (!store.busy) runAction(action) }}
            >
              <text fg={buttonText(theme, active(), action === "delete" ? theme.error : theme.primary)}>
                {label()}
              </text>
            </box>
          )
        })}
      </box>
      <text fg={theme.textMuted}>Tab action · Enter run · Esc back</text>
    </box>
  )
}
