import { createMemo, createResource, createSignal, For } from "solid-js"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"
import { useRoute } from "../../context/route"
import { useSpinosaWorkspace } from "../../context/spinosa-workspace"
import { useExit } from "../../context/exit"
import { useEpilogue } from "../../context/epilogue"

import { updateWorkspace } from "@spinosa/core/commands/update"
import { resolveFrameworkRoot } from "@spinosa/core/framework/discovery"
import {
  inspectWorkspaceTemplatePack,
  readBundledFrameworkVersion,
  workspaceNeedsFrameworkUpdate,
  writeWorkspaceFrameworkVersion,
  type TemplatePackFreshness,
} from "../../spinosa/service"
import { useBindings, SPINOSA_BASE_MODE } from "../../keymap"
import { usePromptRef } from "../../context/prompt"
import { buttonBackground, buttonBorder, buttonText } from "../../util/button"
import { useConnected } from "../../component/use-connected"
import { useDialog } from "../../ui/dialog"
import { DialogProvider } from "../../component/dialog-provider"
import { DialogAlert } from "../../ui/dialog-alert"
import { errorMessage } from "../../util/error"

type ActionRowItem = {
  key: string
  label: string
  onPress: () => void
}

export function SpinosaPromptChips(props: { suppressEnter?: boolean }) {
  const { theme } = useTheme()
  const toast = useToast()
  const { navigate } = useRoute()
  const spinosa = useSpinosaWorkspace()
  const exit = useExit()
  const setEpilogue = useEpilogue()
  const promptRef = usePromptRef()
  const connected = useConnected()
  const dialog = useDialog()
  const [busyAction, setBusyAction] = createSignal<"update" | "completed" | undefined>()
  const [updateLabel, setUpdateLabel] = createSignal("Updating workspace…")
  const [selectedAction, setSelectedAction] = createSignal(0)
  const [hoveredAction, setHoveredAction] = createSignal<string | undefined>()
  const workspaceReady = createMemo(() => Boolean(spinosa.activePath && !spinosa.genericMode))
  const [bundledVersion] = createResource(
    () => (workspaceReady() ? "bundled" : undefined),
    () => readBundledFrameworkVersion().catch(() => undefined),
  )
  const [packFreshness] = createResource(
    () => {
      const workspacePath = spinosa.activePath
      if (!workspacePath || spinosa.genericMode) return undefined
      return {
        workspacePath,
        workspaceVersion: spinosa.meta?.frameworkVersion,
        bundledVersion: bundledVersion(),
      }
    },
    (input) => inspectWorkspaceTemplatePack(input).catch((): TemplatePackFreshness | undefined => undefined),
  )
  const needsWorkspaceUpdate = createMemo(() => {
    const freshness = packFreshness()
    if (freshness) return freshness.refreshRecommended
    return workspaceNeedsFrameworkUpdate(spinosa.meta?.frameworkVersion, bundledVersion())
  })
  const updateChipLabel = createMemo(() => {
    if (busyAction() === "completed") return "Updated workspace!"
    if (busyAction() === "update") return updateLabel()
    return "Update workspace files"
  })

  const runWorkspaceUpdate = async () => {
    const workspacePath = spinosa.activePath
    if (!workspacePath || busyAction()) return
    setBusyAction("update")
    setUpdateLabel("Starting…")
    toast.show({
      variant: "info",
      message: "Updating workspace…",
      duration: 30000,
    })
    let result: Awaited<ReturnType<typeof updateWorkspace>>
    try {
      result = await updateWorkspace({
        workspacePath,
        frameworkRoot: resolveFrameworkRoot() ?? "",
        onPhase: (_phase, detail) => {
          const line = detail.trim()
          if (!line) return
          // Keep the full phase detail on the chip (was truncated to 22 chars).
          setUpdateLabel(line.replace(/^[#>\s]+/, ""))
        },
      })
    } catch (error) {
      setBusyAction(undefined)
      setUpdateLabel("Updating workspace…")
      const message = errorMessage(error)
      toast.show({
        title: "Couldn’t update this workspace",
        variant: "error",
        message,
        duration: 10000,
      })
      void DialogAlert.show(dialog, "Couldn’t update this workspace", message)
      return
    }
    if (result.success) {
      const version = bundledVersion() ?? (await readBundledFrameworkVersion())
      if (version) {
        await writeWorkspaceFrameworkVersion(workspacePath, version)
      }
    }
    spinosa.refresh()

    if (result.success) {
      // Protocol/agents are not hot-reloaded — exit so the user restarts Spinosa.
      if (result.changes) {
        setEpilogue(
          [
            "Workspace template pack updated.",
            "Re-run spinosa (or bun run dev) to catch up — protocol and agents are not hot-reloaded.",
          ].join("\n"),
        )
        toast.show({
          variant: "info",
          message: "Exiting so you can re-run spinosa with the updated pack…",
          duration: 4000,
        })
        exit()
        return
      }
      setBusyAction("completed")
      setUpdateLabel("Updated workspace!")
      setTimeout(() => {
        setBusyAction(undefined)
        setUpdateLabel("Updating workspace…")
      }, 2000)
      return
    }

    setBusyAction(undefined)
    setUpdateLabel("Updating workspace…")

    const message =
      result.error?.trim() ||
      "Nothing was changed. The update failed without a detailed reason."
    toast.show({
      title: "Couldn’t update this workspace",
      variant: "error",
      message,
      duration: 10000,
    })
    void DialogAlert.show(dialog, "Couldn’t update this workspace", message)
  }

  const primaryActions = createMemo<ActionRowItem[]>(() =>
    !connected()
      ? ([{
          key: "select-provider",
          label: "Select provider",
          onPress: () => dialog.replace(() => <DialogProvider />),
        }] as const)
      : workspaceReady()
      ? ([
          {
            key: "add-files",
            label: "Import files",
            onPress: () => navigate({ type: "add-files" }),
          },
          {
            key: "change-workspace",
            label: "Switch workspace",
            onPress: () => spinosa.showPicker(),
          },
          ...(needsWorkspaceUpdate() || busyAction() === "update" || busyAction() === "completed"
            ? [
                {
                  key: "update-workspace",
                  label: updateChipLabel(),
                  onPress: () => void runWorkspaceUpdate(),
                },
              ]
            : []),
        ] as const)
      : ([
          {
            key: "new-workspace",
            label: "New workspace",
            onPress: () => navigate({ type: "onboarding" }),
          },
          {
            key: "select-workspace",
            label: "Pick a workspace",
            onPress: () => spinosa.showPicker(),
          },
        ] as const),
  )

  const renderRow = (items: ActionRowItem[]) => (
    <box width="100%" flexDirection="row" gap={workspaceReady() ? 2 : 1} paddingBottom={workspaceReady() ? 2 : 1}>
      <For each={items}>
        {(item, index) => {
          const highlighted = createMemo(
            () => hoveredAction() === item.key || selectedAction() === index(),
          )

          return (
            <box
              flexGrow={1}
              minWidth={0}
              justifyContent="center"
              alignItems="center"
              paddingLeft={workspaceReady() ? 2 : 1}
              paddingRight={workspaceReady() ? 2 : 1}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={buttonBackground(theme, highlighted())}
              border={workspaceReady() ? ["left"] : ["top", "bottom", "left", "right"]}
              borderColor={buttonBorder(theme, highlighted())}
              onMouseOver={() => {
                setHoveredAction(item.key)
                setSelectedAction(index())
              }}
              onMouseOut={() => setHoveredAction(undefined)}
              onMouseDown={() => {
                setSelectedAction(index())
                setTimeout(() => item.onPress(), 0)
              }}
            >
              <text fg={buttonText(theme, highlighted())} wrapMode="none">
                {item.label}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )

  const moveSelection = (offset: number) => {
    const total = primaryActions().length
    if (total === 0) return
    setSelectedAction((current) => (current + offset + total) % total)
  }

  const runSelectedAction = () => {
    const item = primaryActions()[selectedAction()]
    if (!item) return
    item.onPress()
  }

  useBindings(() => ({
    mode: SPINOSA_BASE_MODE,
    enabled: () => !promptRef.current?.focused,
    bindings: [
      { key: "Left", desc: "Previous action", group: "Home", cmd: () => moveSelection(-1) },
      { key: "Right", desc: "Next action", group: "Home", cmd: () => moveSelection(1) },
      ...(!props.suppressEnter
        ? [{ key: "Enter", desc: "Run selected action", group: "Home", cmd: () => runSelectedAction() }]
        : []),
      ...(!connected()
        ? [{ key: "p", desc: "Select provider", group: "Home", cmd: () => dialog.replace(() => <DialogProvider />) }]
        : workspaceReady()
          ? [
              { key: "n", desc: "New workspace", group: "Home", cmd: () => navigate({ type: "onboarding" }) },
              { key: "a", desc: "Import files", group: "Home", cmd: () => navigate({ type: "add-files" }) },
              { key: "w", desc: "Switch workspace", group: "Home", cmd: () => spinosa.showPicker() },
              ...(needsWorkspaceUpdate()
                ? [{ key: "u", desc: "Update workspace files", group: "Home", cmd: () => void runWorkspaceUpdate() }]
                : []),
            ]
          : [
              { key: "n", desc: "New workspace", group: "Home", cmd: () => navigate({ type: "onboarding" }) },
              { key: "w", desc: "Pick a workspace", group: "Home", cmd: () => spinosa.showPicker() },
            ]),
    ],
  }))

  return <box width="100%" flexDirection="column">{renderRow(primaryActions())}</box>
}
