import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { For, Show, type Accessor, type Setter } from "solid-js"
import type { Theme } from "../../context/theme"
import { CenteredColumn } from "../../component/centered-column"
import { buttonBackground, buttonText } from "../../util/button"
import {
  deferPress,
  ImportOptionsSelector,
  type ImportOption,
  LogScrollbox,
  ProgressBar,
  WizardActionButton,
  WizardActionRow,
  WizardGateButton,
  WizardPanel,
} from "./wizard-ui"
import {
  formatImportDetailLogHint,
  importOutcomeHeading,
  shouldShowImportDetailLogHint,
  type ImportFileProgressItem,
} from "../../spinosa/import-progress-ui"

export type WizardStep = "path" | "tools" | "scan" | "direct" | "markitdown" | "ocr" | "done" | "error"
export type ToolCheckResult = {
  label: string
  status: "checking" | "available" | "missing" | "unsupported"
  detail?: string
}
export type SourcePathEntry = { id: number }
type ImportOutcome = { failedCount: number; stillMissing: number }
type PathValidity = "unchecked" | "valid" | "invalid"

type AddFilesViewProps = {
  theme: Theme
  dimensions: Accessor<{ height: number }>
  stopping: Accessor<boolean>
  waveString: (frame: number) => string
  wavePulse: (frame: number) => string
  spinIdx: Accessor<number>
  stopHint: Accessor<string>
  hoveredButton: Accessor<string | null>
  setHoveredButton: Setter<string | null>
  busy: Accessor<boolean>
  step: Accessor<WizardStep>
  stepIndex: Accessor<number>
  totalSteps: number
  sourceIsCloud: Accessor<boolean>
  sourcePaths: Accessor<SourcePathEntry[]>
  focusedSource: Accessor<number>
  setFocusedSource: Setter<number>
  registerSourceInput: (id: number, value: TextareaRenderable, first: boolean) => void
  pathSnapshot: Map<number, string>
  pathValidities: Record<number, PathValidity>
  blurSourceInputs: () => void
  focusSourceEntry: (id: number) => void
  removeSourcePath: (id: number) => void
  hasValidPaths: Accessor<boolean>
  leavePathStep: () => void
  continueFromPath: () => Promise<void>
  toolChecks: Accessor<ToolCheckResult[]>
  logLines: Accessor<string[]>
  scanDone: Accessor<boolean>
  scanningFile: Accessor<string>
  scanCount: Accessor<number>
  scanTotal: Accessor<number>
  importOptions: Accessor<ImportOption[]>
  selectedImport: Accessor<number>
  formatBytes: (bytes: number) => string
  setSelectedImport: Setter<number>
  toggleAllImports: () => void
  toggleImport: (index: number) => void
  processingDone: Accessor<boolean>
  progCurrent: Accessor<number>
  progTotal: Accessor<number>
  processingStatus: Accessor<string>
  processingFile: Accessor<string>
  progressFiles: Accessor<ImportFileProgressItem[]>
  toolActionLabel: Accessor<string>
  toolAllReady: Accessor<boolean>
  handleBackPress: () => void
  handleToolAction: () => void
  continueFromScan: () => void
  waitingForGate: Accessor<boolean>
  gateLabel: Accessor<string>
  gateAction: Accessor<() => void>
  visionError: Accessor<string | undefined>
  visionPaused: Accessor<boolean>
  onVisionRetry: () => void
  onVisionSkip: () => void
  onOpenMonitor: () => void
  backgroundAvailable: Accessor<boolean>
  onBackground: () => void
  importOutcomeFg: Accessor<Theme["error"]>
  importOutcome: Accessor<ImportOutcome>
  importOutcomeHeading: (outcome: ImportOutcome) => string
  importSummary: Accessor<string>
  failedCount: Accessor<number>
  shouldShowImportDetailLogHint: (outcome: ImportOutcome) => boolean
  formatImportDetailLogHint: () => string
  finish: () => void
}

export function AddFilesView(props: AddFilesViewProps) {
  const {
    theme,
    dimensions,
    stopping,
    waveString,
    wavePulse,
    spinIdx,
    stopHint,
    hoveredButton,
    setHoveredButton,
    busy,
    step,
    stepIndex,
    totalSteps,
    sourceIsCloud,
    sourcePaths,
    focusedSource,
    setFocusedSource,
    registerSourceInput,
    pathSnapshot,
    pathValidities,
    blurSourceInputs,
    focusSourceEntry,
    removeSourcePath,
    hasValidPaths,
    leavePathStep,
    continueFromPath,
    toolChecks,
    logLines,
    scanDone,
    scanningFile,
    scanCount,
    scanTotal,
    importOptions,
    selectedImport,
    formatBytes,
    setSelectedImport,
    toggleAllImports,
    toggleImport,
    processingDone,
    progCurrent,
    progTotal,
    processingStatus,
    processingFile,
    progressFiles,
    toolActionLabel,
    toolAllReady,
    handleBackPress,
    handleToolAction,
    continueFromScan,
    waitingForGate,
    gateLabel,
    gateAction,
    visionError,
    visionPaused,
    importOutcomeFg,
    importOutcome,
    importOutcomeHeading,
    importSummary,
    failedCount,
    shouldShowImportDetailLogHint,
    formatImportDetailLogHint,
    finish,
  } = props

  return (
    <Show when={!stopping()} fallback={
      <box width="100%" height="100%" alignItems="center" justifyContent="center">
        <box flexDirection="column" alignItems="center" gap={1}>
          <text fg={theme.textMuted}>{waveString(spinIdx())}</text>
          <text fg={theme.textMuted}>{stopHint()}</text>
        </box>
      </box>
    }>
      <CenteredColumn>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box width="100%" maxWidth={80} flexDirection="column" gap={1}>
          <box flexDirection="row" alignItems="center" gap={1}>
            <box
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={buttonBackground(theme, hoveredButton() === "back")}
              onMouseOver={() => {
                blurSourceInputs()
                setHoveredButton("back")
              }}
              onMouseOut={() => setHoveredButton(null)}
              onMouseDown={() => deferPress(handleBackPress)}
            >
              <text fg={buttonText(theme, hoveredButton() === "back", theme.text)}>←</text>
            </box>
            <text fg={theme.text}>
              <span style={{ bold: true }}>{busy() ? `${waveString(spinIdx())} ` : ""}Import files into workspace</span>
            </text>
          </box>
          <text fg={theme.textMuted}>
            Step {stepIndex()} of {totalSteps}
            {step() === "path" ? " — choosing source folders" : ""}
            {step() === "tools" ? " — checking your document tools" : ""}
            {step() === "scan" ? " — scanning your source" : ""}
            {step() === "direct" ? " — copying text-based files to raw/" : step() === "markitdown" ? " — converting office docs via MarkItDown" : step() === "ocr" ? " — running Tesseract on scanned PDFs" : ""}
            {step() === "done" ? " — import complete" : ""}
            {step() === "error" ? " — fixing the issue and retrying" : ""}
          </text>
          <Show when={sourceIsCloud() && (step() === "scan" || step() === "direct" || step() === "markitdown" || step() === "ocr")}>
            <text fg={theme.error}>  ⚠ cloud folder — scans & copies can be slow due to sync latency</text>
          </Show>

          <Show when={step() === "path"}>
            <WizardPanel theme={theme} accent>
              <text fg={theme.textMuted}>Source folders</text>
              <text fg={theme.textMuted}>
                Add one or more source folders. Spinosa scans them, then imports the file types you choose into this workspace.
              </text>
              <text fg={theme.textMuted}>Click a path to edit · ↑↓ move between paths</text>
              <box flexDirection="column" gap={1} paddingTop={1}>
                <For each={sourcePaths()}>
                  {(entry, index) => (
                    <box
                      flexDirection="row"
                      gap={0}
                      alignItems="center"
                      backgroundColor={focusedSource() === index() ? theme.backgroundElement : undefined}
                      border={focusedSource() === index() ? ["left"] : []}
                      borderColor={theme.borderActive}
                    >
                      <box
                        flexGrow={1}
                        onMouseDown={() => {
                          setFocusedSource(index())
                          focusSourceEntry(entry.id)
                        }}
                      >
                        <textarea
                          ref={(value: TextareaRenderable) => registerSourceInput(entry.id, value, index() === 0)}
                          initialValue={pathSnapshot.get(entry.id) ?? ""}
                          placeholder={`Folder path ${index() + 1}`}
                          placeholderColor={theme.textMuted}
                          textColor={theme.text}
                          focusedTextColor={theme.text}
                          cursorColor={theme.primary}
                          minHeight={1}
                          maxHeight={1}
                          flexGrow={1}
                          onSubmit={() => {}}
                        />
                      </box>
                      <box
                        paddingLeft={1}
                        paddingRight={1}
                        paddingTop={0}
                        paddingBottom={0}
                      >
                        <text fg={
                          pathValidities[entry.id] === "valid"
                            ? theme.success
                            : pathValidities[entry.id] === "invalid"
                              ? theme.error
                              : theme.textMuted
                        }>
                          {pathValidities[entry.id] === "valid" ? "●" : pathValidities[entry.id] === "invalid" ? "●" : "○"}
                        </text>
                      </box>
                      <box
                        paddingLeft={1}
                        paddingRight={1}
                        paddingTop={0}
                        paddingBottom={0}
                        backgroundColor={theme.backgroundPanel}
                        onMouseOver={() => blurSourceInputs()}
                        onMouseDown={() => deferPress(() => removeSourcePath(entry.id))}
                      >
                        <text fg={theme.textMuted}>✕</text>
                      </box>
                    </box>
                  )}
                </For>
              </box>
            </WizardPanel>
            <WizardActionRow>
              <WizardActionButton
                theme={theme}
                label="Back"
                primary={focusedSource() === sourcePaths().length}
                onHover={() => {
                  blurSourceInputs()
                  setFocusedSource(sourcePaths().length)
                }}
                onPress={leavePathStep}
              />
              <box flexGrow={1} />
              <Show when={hasValidPaths()}>
                <WizardActionButton
                  theme={theme}
                  label="Continue"
                  primary={focusedSource() === sourcePaths().length + 1}
                  onHover={() => {
                    blurSourceInputs()
                    setFocusedSource(sourcePaths().length + 1)
                  }}
                  onPress={() => void continueFromPath()}
                />
              </Show>
            </WizardActionRow>
          </Show>

          <Show when={step() === "tools" || step() === "scan" || step() === "direct" || step() === "markitdown" || step() === "ocr"}>
            <WizardPanel theme={theme}>
              <Show when={step() === "tools"}>
                <text fg={theme.textMuted}>Document processing tools</text>
                <box flexDirection="column" gap={1} paddingTop={1}>
                  <For each={toolChecks()}>
                    {(check) => {
                      const icon =
                        check.status === "available" || check.status === "unsupported"
                          ? "●"
                          : check.status === "missing"
                            ? "●"
                            : wavePulse(spinIdx())
                      const color =
                        check.status === "available"
                          ? theme.success
                          : check.status === "missing"
                            ? theme.error
                            : theme.textMuted
                      return (
                        <box flexDirection="row" gap={1} alignItems="center" paddingLeft={1} paddingRight={1}>
                          <text fg={color} attributes={check.status === "checking" ? undefined : TextAttributes.BOLD}>{icon}</text>
                          <text fg={check.status === "checking" ? theme.textMuted : theme.text}> {check.label}</text>
                          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>{check.detail ?? ""}</text>
                        </box>
                      )
                    }}
                  </For>
                </box>
                <Show when={logLines().length > 0}>
                  <box height={1} />
                  <LogScrollbox theme={theme} lines={logLines()} viewportHeight={dimensions().height} />
                </Show>
              </Show>
              <Show when={step() === "scan"}>
                <Show when={!scanDone()}>
                  <text fg={theme.text}>{waveString(spinIdx())}</text>
                  <text fg={theme.textMuted}>{scanningFile() || "…"}</text>
                  <text fg={theme.textMuted}>Scanning {scanCount()} / {scanTotal()}</text>
                  <Show when={logLines().length > 0}>
                    <box height={1} />
                    <LogScrollbox theme={theme} lines={logLines()} viewportHeight={dimensions().height} />
                  </Show>
                </Show>
                <Show when={scanDone()}>
                  <text fg={theme.textMuted}>Select file types to import</text>
                  <ImportOptionsSelector
                    theme={theme}
                    options={importOptions()}
                    selectedIndex={selectedImport()}
                    viewportHeight={dimensions().height}
                    formatDetail={(item) => formatBytes(item.bytes)}
                    onSelectIndex={setSelectedImport}
                    onToggleAll={toggleAllImports}
                    onToggleItem={toggleImport}
                  />
                  <text fg={theme.textMuted}>↑↓ move · space toggle · a toggle all · enter continue</text>
                </Show>
              </Show>
              <Show when={step() === "direct" || step() === "markitdown" || step() === "ocr"}>
                <Show when={!processingDone()}>
                  <ProgressBar
                    theme={theme}
                    current={progCurrent()}
                    total={progTotal()}
                    status={processingStatus()}
                    fileName={processingFile()}
                    files={progressFiles()}
                    barWidth={20}
                    viewportHeight={dimensions().height}
                  />
                </Show>
                <Show when={visionError()}>
                  <box flexDirection="column" gap={0} border={["left"]} borderColor={theme.error} paddingLeft={1}>
                    <text fg={theme.error}>{visionError()}</text>
                  </box>
                  <Show when={visionPaused()}>
                    <box flexDirection="row" gap={1}>
                      <WizardActionButton theme={theme} label="Retry" primary onPress={() => props.onVisionRetry()} />
                      <WizardActionButton theme={theme} label="Skip file" onPress={() => props.onVisionSkip()} />
                      <WizardActionButton theme={theme} label="Open monitor" onPress={() => props.onOpenMonitor()} />
                    </box>
                    <text fg={theme.textMuted} attributes={TextAttributes.DIM}>r retry · s skip · m monitor</text>
                  </Show>
                </Show>
              </Show>
            </WizardPanel>
            <WizardActionRow>
              <WizardActionButton theme={theme} label="Back" onPress={handleBackPress} />
              <box flexGrow={1} />
              <Show when={step() === "tools" && toolActionLabel() !== "" && !toolChecks().some((t) => t.status === "checking")}>
                <WizardActionButton
                  theme={theme}
                  label={toolActionLabel()}
                  primary={toolAllReady()}
                  onPress={handleToolAction}
                />
              </Show>
              <Show when={step() === "scan" && scanDone()}>
                <WizardActionButton
                  theme={theme}
                  label="Continue"
                  primary
                  onPress={() => void continueFromScan()}
                />
              </Show>
              <Show when={step() === "direct" || step() === "markitdown" || step() === "ocr"}>
                <Show when={waitingForGate()}>
                  <WizardGateButton theme={theme} label={gateLabel()} action={() => gateAction()()} />
                </Show>
                <Show when={props.backgroundAvailable()}>
                  <WizardActionButton
                    theme={theme}
                    label="Continue in background"
                    onPress={() => props.onBackground()}
                  />
                  <text fg={theme.textMuted} attributes={TextAttributes.DIM}>b background</text>
                </Show>
              </Show>
            </WizardActionRow>
          </Show>

          <Show when={step() === "done" || step() === "error"}>
            <WizardPanel theme={theme}>
              <Show when={step() === "done"}>
                <box gap={1}>
                  <text fg={importOutcomeFg()}>{importOutcomeHeading(importOutcome())}</text>
                  <text fg={theme.textMuted}>Import finished. Review the summary and file list below.</text>
                  <Show when={progressFiles().length > 0}>
                    <ProgressBar
                      theme={theme}
                      current={progCurrent()}
                      total={progTotal()}
                      status={processingStatus()}
                      fileName={processingFile()}
                      files={progressFiles()}
                      barWidth={20}
                      viewportHeight={dimensions().height}
                    />
                  </Show>
                  <Show when={importSummary() !== ""}>
                    <box paddingTop={1} flexDirection="column" gap={0}>
                      <text fg={theme.textMuted}>{importSummary()}</text>
                    </box>
                  </Show>
                  <Show when={failedCount() > 0}>
                    <box paddingTop={1} flexDirection="column" gap={0}>
                      <text fg={theme.error}>{failedCount()} file{failedCount() === 1 ? "" : "s"} failed — originals copied to raw/_failed_files/ when possible</text>
                    </box>
                  </Show>
                  <Show when={shouldShowImportDetailLogHint(importOutcome())}>
                    <box paddingTop={1} flexDirection="column" gap={0}>
                      <text fg={theme.textMuted}>{formatImportDetailLogHint()}</text>
                    </box>
                  </Show>
                </box>
              </Show>
              <Show when={step() === "error"}>
                <text fg={theme.error}>
                  <span style={{ bold: true }}>Spinosa could not complete this step.</span>
                </text>
                <Show when={progressFiles().length > 0}>
                  <ProgressBar
                    theme={theme}
                    current={progCurrent()}
                    total={progTotal()}
                    status={processingStatus()}
                    fileName={processingFile()}
                    files={progressFiles()}
                    barWidth={20}
                    viewportHeight={dimensions().height}
                  />
                </Show>
                <Show when={importSummary() !== ""}>
                  <text fg={theme.textMuted}>{importSummary()}</text>
                </Show>
                <Show when={logLines().length > 0}>
                  <LogScrollbox theme={theme} lines={logLines()} viewportHeight={dimensions().height} />
                </Show>
              </Show>
            </WizardPanel>
            <WizardActionRow>
              <Show when={step() === "done"}>
                <WizardActionButton
                  theme={theme}
                  label="Back to workspace"
                  primary
                  onPress={finish}
                />
              </Show>
              <Show when={step() === "error"}>
                <WizardActionButton theme={theme} label="Back" onPress={handleBackPress} />
                <box flexGrow={1} />
                <WizardActionButton theme={theme} label="Retry" primary onPress={() => void continueFromPath()} />
              </Show>
            </WizardActionRow>
          </Show>
        </box>
        <box flexGrow={1} minHeight={0} />
      </box>
    </CenteredColumn>
    </Show>
  )
}
