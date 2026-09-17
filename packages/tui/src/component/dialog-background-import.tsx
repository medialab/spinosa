import { createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { useBackgroundImport } from "../spinosa/import-background"
import { createVisionAuthFlow } from "../spinosa/vision-auth-flow"
import { DialogVisionModel } from "./dialog-vision"
import { ProgressBar } from "../routes/spinosa/wizard-ui"
import { WizardActionButton } from "../routes/spinosa/wizard-ui"
import { displayImportFilePath, formatPageMarker, selectImportResultsWindow, splitPageSuffix } from "../spinosa/import-progress-ui"
import { logAction, logError } from "../spinosa/log"

function shortWorkspace(path: string | undefined): string {
  if (!path) return "workspace"
  const parts = path.replace(/\/+$/, "").split("/")
  return parts.slice(-2).join("/")
}

const FILE_LIST_CAP = 40

/**
 * Open the monitor dialog. Carries its own Escape handler — without it the
 * global Escape binding does nothing (it only fires onClose/onEscape).
 */
export function openBackgroundImportMonitor(
  dialog: Pick<ReturnType<typeof useDialog>, "replace" | "clear" | "stack">,
) {
  dialog.replace(() => <DialogBackgroundImport />, undefined, () => {
    logAction("import-bg", "Monitor closed via Escape (run continues)")
    dialog.clear()
  })
}

/**
 * Home monitor for a background import run. Same powers as the wizard's
 * final step: progress + per-file states, vision pause resolve (retry /
 * skip / change model), gate resolve, cancel, completion summary.
 */
export function DialogBackgroundImport() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const bg = useBackgroundImport()
  const visionAuth = createVisionAuthFlow({ dialog, sync, sdk, toast })

  onMount(() => {
    dialog.setSize("large")
    try {
      const s = snap()
      logAction("import-bg", `Monitor mounted (phase=${s.phase} files=${s.total} paused=${s.visionPause !== undefined} done=${s.done})`)
    } catch (error) {
      logError("import-bg-monitor-mount", error)
    }
  })
  onCleanup(() => dialog.setSize("medium"))

  const snap = () => bg.snapshot()
  const header = createMemo(() => {
    const s = snap()
    if (s.done) return s.success ? "Import complete" : s.cancelled ? "Import cancelled" : "Import complete with failures"
    if (s.visionPause) return "Import paused — action needed"
    return "Importing"
  })
  const subHeader = createMemo(() => {
    const s = snap()
    const parts = [shortWorkspace(s.workspacePath), s.kind === "add-files" ? "add-files" : "onboarding"]
    if (!s.done) parts.push(`${s.finished} of ${Math.max(1, s.total)} files`)
    return parts.join(" · ")
  })
  const fileRows = createMemo(() => selectImportResultsWindow(snap().files))
  const shownFiles = createMemo(() => fileRows().slice(0, FILE_LIST_CAP))
  const hiddenFileCount = createMemo(() => Math.max(0, fileRows().length - FILE_LIST_CAP))
  const failedCount = createMemo(() => fileRows().filter((f) => f.status === "failed" || f.status === "error").length)
  const logTail = createMemo(() => snap().logs.slice(-6))

  const reopenMonitor = () => {
    openBackgroundImportMonitor(dialog)
  }

  const changeModel = () => {
    const s = snap()
    logAction("import-bg", `Change model from monitor (current ${s.modelId})`)
    dialog.replace(() => (
      <DialogVisionModel
        onPicked={async (providerId, modelId) => {
          const id = `${providerId}/${modelId}`
          const forceReauth = bg.lastAuthFailedProvider() === providerId
          const needsAuth = !visionAuth.isVisionProviderAvailable(providerId) || forceReauth
          const authed = !needsAuth
            ? true
            : await visionAuth.ensureProviderAuth(providerId).catch((e) => {
                logAction("import-bg", `Vision auth sequence failed for ${id}: ${e instanceof Error ? e.message : String(e)}`)
                return false
              })
          if (!authed) {
            logAction("import-bg", `Vision ${id} auth cancelled`)
            reopenMonitor()
            return
          }
          if (dialog.stack.length === 0) {
            logAction("import-bg", `Vision auth dismissed for ${id} — keeping ${bg.getModel()}`)
            reopenMonitor()
            return
          }
          bg.setModel(id)
          logAction("import-bg", `Picked vision model ${id} — applies at next file`)
          if (snap().visionPause) bg.resolvePause("retry")
          reopenMonitor()
        }}
      />),
      () => {
        // Escape mid-picker returns to the monitor, never strands.
        logAction("import-bg", "Change model cancelled — back to monitor")
        reopenMonitor()
      }
    )
  }

  const cancelRun = () => {
    bg.cancel()
    toast.show({ variant: "warning", message: "Background import cancelled." })
    logAction("import-bg", "Run cancelled from monitor")
  }

  const dismissAll = () => {
    logAction("import-bg", "Monitor dismissed (run state cleared)")
    bg.dismiss()
    dialog.clear()
  }

  const closeMonitor = () => {
    logAction("import-bg", "Monitor closed (run continues)")
    dialog.clear()
  }

  const retryFile = () => {
    logAction("import-bg", "Retry pressed in monitor")
    bg.resolvePause("retry")
  }

  const skipFile = () => {
    logAction("import-bg", "Skip pressed in monitor")
    bg.resolvePause("skip")
  }

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexGrow={1}>
      {/* ── Header: state + where ─────────────────────────────── */}
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>{header()}</text>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>{subHeader()}</text>
      </box>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>Model: {snap().modelId}</text>

      {/* ── Progress (bar only — the file list below is the single source) */}
      <Show when={!snap().done}>
        <ProgressBar
          theme={theme}
          current={snap().finished}
          total={Math.max(1, snap().total)}
          status={snap().phaseLabel}
          fileName={snap().currentFile}
        />
      </Show>

      {/* ── Paused: error + actions ───────────────────────────── */}
      <Show when={snap().visionError}>
        <box flexDirection="column" gap={1} paddingLeft={1} border={["left"]} borderColor={theme.error}>
          <text fg={theme.error} wrapMode="word">{snap().visionError}</text>
        </box>
        <box flexDirection="row" gap={1} flexWrap="wrap">
          <Show when={snap().visionPause}>
            <WizardActionButton theme={theme} label="Retry" primary onPress={retryFile} />
            <WizardActionButton theme={theme} label="Skip file" onPress={skipFile} />
          </Show>
          <WizardActionButton theme={theme} label="Change model" onPress={changeModel} />
          <WizardActionButton theme={theme} label="Cancel run" onPress={cancelRun} />
        </box>
      </Show>

      {/* ── Pending gate (rare — auto-passes in background) ───── */}
      <Show when={snap().pendingGate}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.warning}>Next phase waiting: {snap().pendingGate!.label}</text>
          <box flexDirection="row" gap={1}>
            <WizardActionButton theme={theme} label="Continue" primary onPress={() => bg.resolveGate(true)} />
            <WizardActionButton theme={theme} label="Skip phase" onPress={() => bg.resolveGate(false)} />
          </box>
        </box>
      </Show>

      {/* ── Files: failures first, scrollable, capped ─────────── */}
      <Show when={fileRows().length > 0}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          Files — {failedCount() > 0 ? `${failedCount()} failed · ` : ""}{snap().finished} of {snap().total} done
        </text>
        <scrollbox maxHeight={10}>
          <For each={shownFiles()}>
            {(f) => {
              const parsed = splitPageSuffix(f.rel)
              const page = f.page ?? parsed.page
              const total = f.pageTotal ?? parsed.total
              return (
                <text fg={f.status === "done" ? theme.textMuted : f.status === "processing" || f.status === "queued" ? theme.text : theme.error} wrapMode="none" overflow="hidden">
                  {f.status === "done" ? "✓" : f.status === "failed" || f.status === "error" ? "✕" : "·"} {displayImportFilePath(parsed.base)}{page !== undefined ? <span style={{ fg: theme.primary }}>{formatPageMarker(page, total)}</span> : ""}
                </text>
              )
            }}
          </For>
        </scrollbox>
        <Show when={hiddenFileCount() > 0}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>+{hiddenFileCount()} more files</text>
        </Show>
      </Show>

      {/* ── Log tail ──────────────────────────────────────────── */}
      <Show when={logTail().length > 0 && !snap().done}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>Log</text>
        <For each={logTail()}>
          {(line) => <text fg={theme.textMuted} wrapMode="none" overflow="hidden">{line.slice(0, 100)}</text>}
        </For>
      </Show>

      {/* ── Completion summary ────────────────────────────────── */}
      <Show when={snap().done && snap().summary}>
        <box flexDirection="column" gap={0} paddingLeft={1} border={["left"]} borderColor={snap().success ? theme.success : theme.error}>
          <text fg={snap().success ? theme.success : theme.error}>{snap().summary!.text}</text>
          <Show when={(snap().summary?.stillMissing ?? 0) > 0}>
            <text fg={theme.warning}>Some files are still missing — check raw/_failed_files/ or re-run the import.</text>
          </Show>
        </box>
      </Show>

      {/* ── Footer ────────────────────────────────────────────── */}
      <box flexDirection="row" gap={1} paddingTop={1}>
        <Show when={!snap().done}>
          <WizardActionButton theme={theme} label="Close (esc)" onPress={closeMonitor} />
          <WizardActionButton theme={theme} label="Cancel run" onPress={cancelRun} />
        </Show>
        <Show when={snap().done}>
          <WizardActionButton theme={theme} label="Dismiss" primary onPress={dismissAll} />
        </Show>
      </box>
    </box>
  )
}
