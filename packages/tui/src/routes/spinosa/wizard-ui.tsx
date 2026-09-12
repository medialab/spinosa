import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import type { Theme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { buttonBackground, buttonBorder, buttonText } from "../../util/button"
import { Locale } from "../../util/locale"
import type { ImportScanPreview, NewWorkspacePreview } from "../../spinosa/onboarding-preview"
import type { DialogContext } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import type { FileProgressStatus } from "@spinosa/core/progress/progress"
import {
  countImportProgress,
  displayImportFilePath,
  formatImportPhaseRecap,
  formatImportPhaseRecapFromCounters,
  formatPageMarker,
  isImportPhaseComplete,
  isTerminalImportFileStatus,
  selectImportResultsWindow,
  splitPageSuffix,
  statusAccentKey,
  statusGlyph,
  type ImportFileProgressItem,
} from "../../spinosa/import-progress-ui"

/** Soft wait after cancel before treating stop as incomplete. */
export type StopWaitOutcome = "idle" | "settled" | "timeout"

export type ImportOption = {
  ext: string
  count: number
  bytes: number
  selected: boolean
}

/** Defer press handlers so route changes do not unmount the tree mid-mousedown. */
export function deferPress(action: () => void) {
  setTimeout(() => action(), 0)
}

export function nextFocusedSourceIndexForAppend(
  currentFocusedIndex: number,
  nextIndex: number,
  options?: { focusNewInput?: boolean },
) {
  return options?.focusNewInput === false ? currentFocusedIndex : nextIndex
}

/** Blur a focused input so mouse-driven controls can receive hover and click. */
export function blurIfFocused(renderable?: { focused?: boolean; blur?: () => void; isDestroyed?: boolean }) {
  if (renderable && !renderable.isDestroyed && renderable.focused && renderable.blur) renderable.blur()
}

/** Invalidate in-flight async wizard work when the user navigates back or starts a new run. */
export function createWorkflowGuard() {
  let generation = 0
  return {
    bump: () => ++generation,
    active: (gen: number) => gen === generation,
  }
}

/** Tracks one wizard operation so cancellation can settle before navigation. */
export function createActiveWorkTracker() {
  let active: Promise<void> | undefined
  return {
    run(work: () => Promise<void>) {
      if (active) return active
      const current = work()
      active = current
      void current.then(
        () => { if (active === current) active = undefined },
        () => { if (active === current) active = undefined },
      )
      return current
    },
    /**
     * Wait for active work to settle.
     * With maxMs > 0: return "timeout" if still running (do not treat as success).
     * With maxMs <= 0: wait until settled (or "idle" if nothing active).
     */
    async wait(maxMs = 0): Promise<StopWaitOutcome> {
      if (!active) return "idle"
      const current = active
      if (maxMs <= 0) {
        await current.then(() => undefined, () => undefined)
        return "settled"
      }
      const settled = await Promise.race([
        current.then(() => true as const, () => true as const),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), maxMs)),
      ])
      return settled ? "settled" : "timeout"
    },
  }
}

export function shouldConfirmSpinosaBack(props: {
  step: string
  busy: boolean
  waitingForGate: boolean
  cancellableSteps: readonly string[]
}) {
  return props.cancellableSteps.includes(props.step) && (props.busy || props.waitingForGate)
}

export async function confirmSpinosaBack(dialog: DialogContext, step: string) {
  const operation = step === "direct"
    ? "the current file copy"
    : step === "markitdown"
      ? "the current conversion (MarkItDown / Vision)"
      : step === "ocr"
        ? "the current OCR operation"
        : step === "verification"
          ? "the current verification"
          : "the current workspace setup"
  return (await DialogConfirm.show(
    dialog,
    "Stop current operation?",
    `Going back will stop ${operation}. Files already imported will remain.`,
    { cancelLabel: "Stay", confirmLabel: "Stop and go back", defaultChoice: "cancel" },
  )) === true
}

/** Default time the "Stopping process..." overlay stays visible after cancel. */
export const STOP_SCREEN_MIN_DWELL_MS = 3000

/** Soft abort wait before showing "still stopping" / force-leave. */
export const STOP_WAIT_SOFT_MS = 2500

export const STOP_SCREEN_DEFAULT_HINT = "Stopping. Wait for a clean exit."
export const STOP_SCREEN_STILL_HINT = "Still stopping… Esc to leave anyway"

export async function runGuardedBackNavigation(input: {
  shouldConfirm: boolean
  confirm: () => Promise<boolean>
  stop: () => void
  /** Soft-wait for cancel settlement. Return "timeout" if work is still running. */
  waitForStop: () => Promise<StopWaitOutcome | void>
  navigate: () => void
  /**
   * Minimum time to keep the stopping overlay visible after stop().
   * Cancel is often instantaneous; a short dwell lets the user read the screen.
   * Pass 0 for ordinary (non-cancel) back navigation.
   */
  minStopDisplayMs?: number
  /** Update stop overlay when soft wait timed out (work still running). */
  onStillStopping?: () => void
  /** Wait until active work fully settles (no timeout). Used after soft timeout. */
  waitUntilSettled?: () => Promise<void>
  /** Resolves when user force-leaves (Esc / Ctrl-C) during still-stopping. */
  waitForForceLeave?: () => Promise<void>
}): Promise<"stayed" | "navigated"> {
  if (input.shouldConfirm && !(await input.confirm())) return "stayed"
  const started = Date.now()
  input.stop()
  const outcome = (await input.waitForStop()) ?? "settled"
  const minMs = input.minStopDisplayMs ?? 0
  if (minMs > 0) {
    const remaining = minMs - (Date.now() - started)
    if (remaining > 0) await delay(remaining)
  }
  // Never navigate away as success while cancel is still incomplete.
  if (outcome === "timeout") {
    input.onStillStopping?.()
    const settle = input.waitUntilSettled?.() ?? Promise.resolve()
    if (input.waitForForceLeave) {
      await Promise.race([settle, input.waitForForceLeave()])
    } else {
      await settle
    }
  }
  input.navigate()
  return "navigated"
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function shouldCancelSpinosaWorkOnCtrlC(props: {
  step: string
  busy: boolean
  waitingForGate: boolean
  cancellableSteps: readonly string[]
}) {
  return props.busy || props.cancellableSteps.includes(props.step)
}

/** True when tools-step Enter should fire the Scan / repair action (matches button visibility). */
export function shouldActivateWizardToolAction(props: {
  step: string
  keyName: string
  busy: boolean
  toolChecks: ReadonlyArray<{ status: string }>
}) {
  if (props.step !== "tools" || props.keyName !== "return" || props.busy) return false
  if (props.toolChecks.length === 0) return false
  if (props.toolChecks.some((t) => t.status === "checking")) return false
  return true
}

export function yieldToEventLoop() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
}

export function generateScanLines(preview: NewWorkspacePreview | ImportScanPreview): string[] {
  const lines: string[] = []
  lines.push("Scanning source files...")
  if ("preflightRows" in preview) {
    lines.push("")
    for (const row of preview.preflightRows) {
      const icon = row.tone === "error" ? "✗" : row.tone === "success" ? "✓" : "─"
      const detail = row.detail ? ` | ${row.detail}` : ""
      lines.push(`${icon} ${row.label} — ${row.status}${detail}`)
    }
  }
  lines.push("")
  for (const row of preview.scanRows) {
    const icon = row.tone === "error" ? "✗" : "─"
    const detail = row.detail ? ` | ${row.detail}` : ""
    lines.push(`${icon} ${row.label} — ${row.status}${detail}`)
  }
  if (preview.importOptions.length > 0) {
    lines.push("")
    lines.push(`Importable file types: ${preview.importOptions.length}`)
    for (const opt of preview.importOptions) {
      lines.push(
        `  .${opt.ext} — ${opt.count} file${opt.count === 1 ? "" : "s"}${opt.selected ? "" : " (audio/video skipped — press space to include)"}`,
      )
    }
  }
  return lines
}

export function WizardPanel(props: {
  theme: Theme
  accent?: boolean
  viewportHeight: number
  children: JSX.Element
}) {
  return (
    <box
      flexDirection="column"
      gap={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      minHeight={wizardPanelHeight(props.viewportHeight)}
      backgroundColor={props.theme.backgroundPanel}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={props.accent ? props.theme.primary : props.theme.border}
    >
      {props.children}
    </box>
  )
}

export function WizardActionRow(props: { children: JSX.Element }) {
  return (
    <box flexDirection="row" gap={1} flexWrap="wrap">
      {props.children}
    </box>
  )
}

export type ToolCheckStatus = "checking" | "available" | "missing" | "unsupported"

export type ToolCheckItem = {
  label: string
  status: ToolCheckStatus
  detail?: string
}

/** Left-accent color for a document-tool card, by check status. */
export function toolCheckAccent(theme: Theme, status: ToolCheckStatus) {
  switch (status) {
    case "available":
      return theme.success
    case "missing":
      return theme.error
    case "unsupported":
      return theme.warning
    case "checking":
      return theme.border
  }
}

/**
 * Document-tool status rows: plain check + text, no boxes. The label stays
 * on its own line, so long detail text wraps cleanly underneath instead of
 * mangling the first line.
 */
export function ToolChecksList(props: {
  theme: Theme
  checks: readonly ToolCheckItem[]
  spinIdx: number
  wavePulse: (frame: number) => string
}) {
  return (
    <box flexDirection="column" gap={1} paddingTop={1}>
      <For each={props.checks}>
        {(check) => {
          const settled = check.status !== "checking"
          const icon = settled ? "●" : props.wavePulse(props.spinIdx)
          const accent = toolCheckAccent(props.theme, check.status)
          return (
            <box flexDirection="column">
              <box flexDirection="row" gap={1} alignItems="center">
                <text
                  fg={check.status === "checking" ? props.theme.textMuted : accent}
                  attributes={check.status === "checking" ? undefined : TextAttributes.BOLD}
                >
                  {icon}
                </text>
                <text fg={check.status === "checking" ? props.theme.textMuted : props.theme.text}>
                  {check.label}
                </text>
              </box>
              <Show when={check.detail}>
                <box paddingLeft={2}>
                  <text fg={props.theme.textMuted} attributes={TextAttributes.DIM} wrapMode="word">
                    {check.detail}
                  </text>
                </box>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}

export function WizardActionButton(props: {
  theme: Theme
  label: string
  primary?: boolean
  onPress: () => void
  onHover?: () => void
}) {
  const [hover, setHover] = createSignal(false)
  const active = () => hover() || Boolean(props.primary)
  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={buttonBackground(props.theme, active())}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={buttonBorder(props.theme, active(), props.primary ? props.theme.success : props.theme.border)}
      onMouseOver={() => {
        props.onHover?.()
        setHover(true)
      }}
      onMouseOut={() => setHover(false)}
      onMouseDown={() => deferPress(props.onPress)}
    >
      <text fg={buttonText(props.theme, active(), props.primary ? props.theme.success : props.theme.textMuted)}>
        <span style={{ bold: props.primary || active() }}>{props.label}</span>
      </text>
    </box>
  )
}

export function WizardGateButton(props: { theme: Theme; label: string; action: () => void }) {
  const [remaining, setRemaining] = createSignal(30)
  let timer: ReturnType<typeof setInterval> | undefined

  // A reused instance showing a new gate must restart the countdown —
  // otherwise the stale timer fires the previous gate's action early.
  createEffect(() => {
    props.label
    setRemaining(30)
  })

  onMount(() => {
    timer = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(timer)
          deferPress(props.action)
          return 0
        }
        return r - 1
      })
    }, 1000)
  })

  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  return (
    <WizardActionButton
      theme={props.theme}
      label={`${props.label} (${remaining()}s)`}
      primary
      onPress={() => {
        if (timer) clearInterval(timer)
        props.action()
      }}
    />
  )
}

export function ToggleLine(props: {
  theme: Theme
  selected: boolean
  enabled: boolean
  label: string
  count: number
}) {
  // Must use buttonText when selected: parent rows paint buttonBackground(active),
  // so theme.text / textMuted on that bg reads as same-on-same.
  return (
    <text fg={buttonText(props.theme, props.selected, props.theme.textMuted)} wrapMode="none">
      <span style={{ fg: buttonText(props.theme, props.selected, props.enabled ? props.theme.text : props.theme.textMuted) }}>
        {props.enabled ? "●" : "○"}
      </span>
      <span style={{ fg: buttonText(props.theme, props.selected, props.theme.text) }}> {props.label}</span>
      <span style={{ fg: buttonText(props.theme, props.selected, props.theme.textMuted) }}> | </span>
      <span style={{ fg: buttonText(props.theme, props.selected, props.theme.borderActive) }}>
        {props.count} file{props.count === 1 ? "" : "s"}
      </span>
    </text>
  )
}

export function wizardScrollboxMaxHeight(
  viewportHeight: number,
  options?: { min?: number; ratio?: number; max?: number },
): number {
  const min = options?.min ?? 4
  const ratio = options?.ratio ?? 0.6
  const max = options?.max
  const resolved = Math.max(min, Math.floor(viewportHeight * ratio))
  return max === undefined ? resolved : Math.min(resolved, max)
}

/**
 * Fixed height for the central wizard grey box. Same value for every step
 * (depends only on terminal height) so the panel never jumps between steps,
 * with room left for the header above and the action row below. Applied as
 * a minimum: short screens let the panel grow instead of clipping content.
 */
export function wizardPanelHeight(viewportHeight: number): number {
  return Math.max(13, Math.min(23, viewportHeight - 11))
}

export function scanOptionListMaxHeight(viewportHeight: number): number {
  return wizardScrollboxMaxHeight(viewportHeight, { min: 4, ratio: 0.35, max: 12 })
}

/** Complete-state import results: ~10–12 rows, adaptive within viewport. */
export function importResultsListMaxHeight(viewportHeight: number): number {
  return wizardScrollboxMaxHeight(viewportHeight, { min: 5, ratio: 0.3, max: 9 })
}

function scrollSelectedImportOptionIntoView(scroll: ScrollBoxRenderable | undefined, selectedIndex: number) {
  if (!scroll || selectedIndex <= 0) return
  const target = scroll.getChildren()[selectedIndex - 1]
  if (!target) return

  const y = target.y - scroll.y
  if (y >= scroll.height) {
    scroll.scrollBy(y - scroll.height + 1)
  } else if (y < 0) {
    scroll.scrollBy(y)
    if (selectedIndex === 1) scroll.scrollTo(0)
  }
}

export type OcrModelOption = {
  id: string
  label: string
  detail: string
  kind: "tesseract" | "vision" | "none"
  modelId?: string
  provider?: string
  vision: boolean
  cost?: "free" | "paid" | "offline"
  requiresKey?: string
}

export function OcrModelSelector(props: {
  theme: Theme
  options: OcrModelOption[]
  selectedIndex: number
  selectedId: string
  viewportHeight: number
  onSelectIndex: (index: number) => void
  onSelect: (index: number) => void
  /** Footer hint line. Defaults to the legacy copy; pass the shared
      OCR_ENGINE_HINT_LINE to stay in sync with engine details. */
  hint?: string
}) {
  let scroll: ScrollBoxRenderable | undefined
  createEffect(() => {
    const idx = props.selectedIndex
    queueMicrotask(() => scrollSelectedImportOptionIntoView(scroll, idx + 1))
  })
  const isChosen = (item: OcrModelOption, chosenId: string) => {
    if (item.id === chosenId) return true
    if (item.id === "vision:provider-picker" && chosenId.includes("/")) return true
    return false
  }
  return (
    <box flexDirection="column" gap={1} paddingTop={1}>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        maxHeight={scanOptionListMaxHeight(props.viewportHeight)}
        verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}
      >
        <For each={props.options}>
          {(item, index) => {
            const active = createMemo(() => props.selectedIndex === index())
            const chosen = createMemo(() => isChosen(item, props.selectedId))
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={buttonBackground(props.theme, active())}
                onMouseOver={() => props.onSelectIndex(index())}
                onMouseDown={() => deferPress(() => props.onSelect(index()))}
              >
                <box flexDirection="row" gap={1} alignItems="center">
                  <text fg={buttonText(props.theme, active(), props.theme.primary)} width={2}>
                    {chosen() ? "●" : "○"}
                  </text>
                  <box flexDirection="column" flexGrow={1}>
                    <text fg={buttonText(props.theme, active(), props.theme.text)}>{item.label}</text>
                    <text fg={buttonText(props.theme, active(), props.theme.textMuted)}>{item.detail}</text>
                  </box>
                </box>
              </box>
            )
          }}
        </For>
      </scrollbox>
      <text fg={props.theme.textMuted}>{props.hint ?? "↑↓ move · space select · enter continue · Tesseract: free offline reading (photos copied) · Vision: paid online transcription (needs key) · None: copy only"}</text>
    </box>
  )
}

export function ImportOptionsSelector(props: {
  theme: Theme
  options: ImportOption[]
  selectedIndex: number
  viewportHeight: number
  formatCount?: (item: ImportOption) => string
  formatDetail?: (item: ImportOption) => string
  onSelectIndex: (index: number) => void
  onToggleAll: () => void
  onToggleItem: (index: number) => void
}) {
  let scroll: ScrollBoxRenderable | undefined
  const totalFiles = createMemo(() => props.options.reduce((sum, item) => sum + item.count, 0))

  createEffect(() => {
    const selectedIndex = props.selectedIndex
    queueMicrotask(() => scrollSelectedImportOptionIntoView(scroll, selectedIndex))
  })

  return (
    <box flexDirection="column" gap={1} paddingTop={1}>
      <box
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={buttonBackground(props.theme, props.selectedIndex === 0)}
        onMouseOver={() => props.onSelectIndex(0)}
        onMouseDown={() => deferPress(props.onToggleAll)}
      >
        <ToggleLine
          theme={props.theme}
          selected={props.selectedIndex === 0}
          enabled={props.options.every((item) => item.selected)}
          label="All supported files"
          count={totalFiles()}
        />
      </box>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        maxHeight={scanOptionListMaxHeight(props.viewportHeight)}
        verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}
      >
        <For each={props.options}>
          {(item, index) => {
            const active = createMemo(() => props.selectedIndex === index() + 1)
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={buttonBackground(props.theme, active())}
                onMouseOver={() => props.onSelectIndex(index() + 1)}
                onMouseDown={() => deferPress(() => props.onToggleItem(index()))}
              >
                <box flexDirection="row" gap={1} alignItems="center">
                  <text fg={buttonText(props.theme, active(), props.theme.primary)} width={2}>
                    {item.selected ? "●" : "○"}
                  </text>
                  <text fg={buttonText(props.theme, active(), props.theme.text)} width={10}>
                    .{item.ext}
                  </text>
                  <text fg={buttonText(props.theme, active(), props.theme.textMuted)} width={10}>
                    {props.formatCount?.(item) ?? `${item.count} file${item.count === 1 ? "" : "s"}`}
                  </text>
                  <text fg={buttonText(props.theme, active(), props.theme.textMuted)}>
                    {props.formatDetail?.(item) ?? `${item.bytes} B`}
                  </text>
                </box>
              </box>
            )
          }}
        </For>
      </scrollbox>
    </box>
  )
}

export function LogScrollbox(props: { theme: Theme; lines: string[]; viewportHeight: number }) {
  return (
    <scrollbox
      maxHeight={wizardScrollboxMaxHeight(props.viewportHeight, { min: 3, ratio: 0.25, max: 7 })}
      stickyScroll={true}
      stickyStart="bottom"
      verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}
    >
      <For each={props.lines}>
        {(line) => <text fg={props.theme.textMuted}>{line || " "}</text>}
      </For>
    </scrollbox>
  )
}

export function LogoSummary(props: { theme: Theme; label: string }) {
  return (
    <text fg={props.theme.text}>
      <span style={{ bold: true }}>{props.label}</span>
    </text>
  )
}

export function ImportFileResults(props: {
  theme: Theme
  files: ImportFileProgressItem[]
  viewportHeight: number
  complete?: boolean
}) {
  const items = createMemo(() => {
    const files = props.files
    const pending = files.filter((item) => !isTerminalImportFileStatus(item.status))
    const terminal = selectImportResultsWindow(files)
    return props.complete ? [...terminal, ...pending] : [...pending, ...terminal]
  })
  const counts = createMemo(() => countImportProgress(props.files))
  // Fixed height (not max): the list area never resizes while files stream
  // in, so the panel stops jumping up and down mid-run.
  const resultsHeight = createMemo(() => importResultsListMaxHeight(props.viewportHeight))
  const accent = (status: FileProgressStatus) => {
    const key = statusAccentKey(status)
    if (key === "primary") return props.theme.primary
    if (key === "success") return props.theme.success
    if (key === "error") return props.theme.error
    if (key === "warning") return props.theme.warning
    return props.theme.textMuted
  }

  return (
    <Show when={items().length > 0}>
      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={props.theme.textMuted}>
          Files (<span style={{ fg: props.theme.success }}>{counts().succeeded} complete</span> · <span style={{ fg: props.theme.error }}>{counts().failed} failed</span> · <span style={{ fg: props.theme.textMuted }}>{counts().pending} pending</span>)
        </text>
        <scrollbox height={resultsHeight()} verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}>
          <For each={items()}>
            {(item) => {
              const parsed = splitPageSuffix(item.rel)
              const page = item.page ?? parsed.page
              const total = item.pageTotal ?? parsed.total
              return (
                <text fg={accent(item.status)} wrapMode="none" overflow="hidden">
                  {statusGlyph(item.status)} {displayImportFilePath(parsed.base)}{page !== undefined ? <span style={{ fg: props.theme.primary }}>{formatPageMarker(page, total)}</span> : ""}
                </text>
              )
            }}
          </For>
        </scrollbox>
      </box>
    </Show>
  )
}

export function formatImportProgressStatus(message: string): string {
  const value = message.trim()
  const separator = value.indexOf("→")
  return separator === -1 ? value : value.slice(separator + 1).trim()
}

export function progressStatusLabel(status: string, complete: boolean): string {
  return complete ? "" : status.trim()
}

export function ProgressBar(props: {
  theme: Theme
  current: number
  total: number
  status: string
  fileName: string
  /** Optional live file queue with protocol statuses for accents. */
  files?: ImportFileProgressItem[]
  barWidth?: number
  /** Used to size the complete-state results ScrollBox. */
  viewportHeight?: number
}) {
  const total = createMemo(() => (props.total > 0 ? props.total : 1))
  const pct = createMemo(() => Math.min(props.current / total(), 1))
  const blocks = () => props.barWidth ?? 20
  const filled = () => Math.round(pct() * blocks())
  const bar = () => "█".repeat(filled()) + "░".repeat(blocks() - filled())
  const complete = createMemo(() => isImportPhaseComplete(props.current, props.total, props.files))
  const statusLabel = createMemo(() => progressStatusLabel(props.status, complete()))
  const recap = createMemo(() => {
    if (!complete()) return ""
    const files = props.files ?? []
    if (files.length === 0) {
      // Bar counters alone cannot assert failed/pending — avoid inventing failed: 0.
      return formatImportPhaseRecapFromCounters(props.current, props.status)
    }
    return formatImportPhaseRecap(countImportProgress(files), props.status)
  })
  const currentLabel = createMemo((): { text: string; marker: string } => {
    if (complete()) return { text: "", marker: "" }
    if (props.files && props.files.length > 0) {
      const active = props.files.find((f) => f.status === "processing")
      if (active) {
        const parsed = splitPageSuffix(active.rel)
        const page = active.page ?? parsed.page
        const total = active.pageTotal ?? parsed.total
        return {
          text: displayImportFilePath(parsed.base),
          marker: page !== undefined ? formatPageMarker(page, total) : "",
        }
      }
      // No active row in the file queue — don't fall back to stale
      // `fileName` (last emitted rel, often already done). That would leave
      // a phantom `›` (e.g. survey-results.csv) after MarkItDown finishes but
      // OCR files remain queued (`pending` → `complete()` stays false).
      return { text: "", marker: "" }
    }
    if (!props.fileName) return { text: "", marker: "" }
    const parsed = splitPageSuffix(props.fileName)
    return {
      text: displayImportFilePath(parsed.base),
      marker: parsed.page !== undefined ? formatPageMarker(parsed.page, parsed.total) : "",
    }
  })

  return (
    <box flexDirection="column" gap={1} paddingTop={1}>
      <box flexDirection="row" gap={0} alignItems="center">
        <text fg={props.theme.text}>
          {bar()} {Math.round(pct() * 100)}%
        </text>
        <text fg={props.theme.textMuted} attributes={TextAttributes.DIM}>
          {" "}{props.current} of {total()}
        </text>
      </box>
      <Show when={recap() !== ""}>
        <text fg={props.theme.textMuted} wrapMode="none" overflow="hidden">
          {recap()}
        </text>
      </Show>
      {/* Always rendered (blank when idle): mounting/unmounting this row
          between files makes the layout jump up and down mid-run. */}
      <text fg={props.theme.primary} wrapMode="none" overflow="hidden">
        {currentLabel().text !== "" ? `${statusGlyph("processing")} ${currentLabel().text}${currentLabel().marker}` : " "}
      </text>
      <Show when={statusLabel() !== ""}>
        <text fg={props.theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none" overflow="hidden">
          {Locale.truncate(statusLabel(), 80)}
        </text>
      </Show>
      <ImportFileResults
        theme={props.theme}
        files={props.files ?? []}
        viewportHeight={props.viewportHeight ?? 24}
        complete={complete()}
      />
    </box>
  )
}
