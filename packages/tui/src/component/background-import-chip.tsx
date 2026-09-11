import { createEffect, createSignal, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useBackgroundImport } from "../spinosa/import-background"
import { openBackgroundImportMonitor } from "./dialog-background-import"
import { logAction, logError } from "../spinosa/log"

// Pause/completion toasts must fire once per run even across chip remounts.
// Keyed by run sequence so a fresh run re-arms; bounded to avoid growth.
const notifiedPauses = new Set<string>()
const notifiedDone = new Set<string>()
let notifiedSeq = -1

function gcNotified(seq: number) {
  if (notifiedSeq !== seq) {
    notifiedSeq = seq
    notifiedPauses.clear()
    notifiedDone.clear()
  }
  if (notifiedPauses.size + notifiedDone.size > 200) {
    notifiedPauses.clear()
    notifiedDone.clear()
  }
}

function runKey(s: { workspacePath?: string; kind: string }): string {
  return `${s.kind}:${s.workspacePath ?? "?"}`
}

/**
 * Persistent home indicator for a background import run: live %, red badge
 * when the queue pauses for input, completion state until dismissed.
 * Click opens the monitor dialog (same powers as the wizard final step).
 */
export function BackgroundImportChip() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const bg = useBackgroundImport()
  const [hovered, setHovered] = createSignal(false)

  const open = () => {
    logAction("import-bg", "Monitor open requested from home chip")
    try {
      openBackgroundImportMonitor(dialog)
      logAction("import-bg", `Monitor dialog replaced (stack=${dialog.stack.length})`)
    } catch (error) {
      logError("import-bg-monitor-open", error)
      toast.show({ variant: "error", message: "Could not open the import monitor." })
    }
  }

  // Mirror the home chips: defer the press out of the mouse event so the
  // dialog replace never runs re-entrantly inside event dispatch.
  const onPress = () => {
    setTimeout(() => open(), 0)
  }

  createEffect(() => {
    const s = bg.snapshot()
    gcNotified(s.runSeq)
    if (!s.background && !s.done) return
    const key = runKey(s)
    const pause = s.visionPause
    if (pause && !notifiedPauses.has(`${key}:${pause.rel}`)) {
      notifiedPauses.add(`${key}:${pause.rel}`)
      toast.show({ variant: "warning", message: `Import paused: ${pause.rel} — open the import chip to resolve.` })
    }
    // The monitor already toasts on Cancel; only toast unattended finishes.
    if (s.done && s.background && !s.cancelled && !notifiedDone.has(key)) {
      notifiedDone.add(key)
      toast.show({
        variant: s.success ? "success" : "error",
        message: s.success ? "Background import complete." : "Background import finished with failures — open the import chip.",
      })
    }
  })

  const visible = () => bg.active() || (bg.done() && bg.background() && bg.summary() !== undefined)
  const pct = () => {
    const s = bg.snapshot()
    if (s.total === 0) return 0
    return Math.round((s.finished / s.total) * 100)
  }
  const tone = () => {
    if (bg.done()) return bg.success() ? theme.success : theme.error
    if (bg.visionPause() ?? bg.visionError()) return theme.error
    return theme.primary
  }
  const label = () => {
    const s = bg.snapshot()
    if (s.done) return s.success ? "Import complete — details" : "Import finished with failures — details"
    if (s.visionPause) return `Import paused — action needed (${pct()}%)`
    return `Import running — ${s.phaseLabel || s.phase} ${pct()}%`
  }

  return (
    <Show when={visible()}>
      <box flexDirection="column" gap={0}>
        <box
          width="100%"
          flexDirection="row"
          gap={1}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          border={["left"]}
          borderColor={hovered() ? theme.text : tone()}
          backgroundColor={hovered() ? theme.backgroundPanel : undefined}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
          onMouseDown={onPress}
        >
          <text fg={tone()}>●</text>
          <text fg={theme.text}>
            <span style={{ bold: hovered() }}>{label()}</span>
          </text>
          <text fg={theme.textMuted}>open</text>
        </box>
        {/* Breathing room between the import chip and the action chips below. */}
        <box height={1} />
      </box>
    </Show>
  )
}
