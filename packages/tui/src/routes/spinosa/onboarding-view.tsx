import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { For, Show, type Accessor, type Setter } from "solid-js"
import { STARTUP_PROGRESS_THRESHOLD_MS } from "@spinosa/core/commands/startup"
import { CenteredColumn } from "../../component/centered-column"
import { buttonBackground, buttonBorder, buttonText } from "../../util/button"
import {
  deferPress,
  ImportOptionsSelector,
  OcrModelSelector,
  type ImportOption,
  type OcrModelOption,
  LogScrollbox,
  LogoSummary,
  ProgressBar,
  ToolChecksList,
  wizardScrollboxMaxHeight,
  WizardActionButton,
  WizardActionRow,
  WizardGateButton,
  WizardPanel,
} from "./wizard-ui"
import { OnboardingLaunchView } from "./onboarding-launch-view"
import type { OnboardingViewProps } from "./onboarding-view-types"
import { OnboardingResultView } from "./onboarding-result-view"

export function OnboardingView(props: OnboardingViewProps) {
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
    deferPress,
    handleBackPress,
    busy,
    resumeWorkspacePath,
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
    leavePathStep,
    hasValidPaths,
    continueFromPath,
    workspaceName,
    setWorkspaceName,
    registerNameInput,
    defaultWorkspaceName,
    continueFromName,
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
    verifyStatus,
    importOutcomeFg,
    importOutcome,
    importOutcomeHeading,
    importSummary,
    failedCount,
    stillMissingCount,
    shouldShowImportDetailLogHint,
    formatImportDetailLogHint,
    toolActionLabel,
    toolAllReady,
    handleToolAction,
    continueFromImports,
    ocrModelOptions,
    selectedOcrModelIndex,
    setSelectedOcrModelIndex,
    continueFromVision,
    waitingForGate,
    gateLabel,
    gateAction,
    cliOptions,
    selectedCli,
    setSelectedCli,
    finishProvider,
    startupError,
    startupMessage,
    startupElapsedMs,
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
              <span style={{ bold: true }}>{busy() ? `${waveString(spinIdx())} ` : ""}{resumeWorkspacePath ? "Resume Spinosa workspace" : "Create Spinosa workspace"}</span>
            </text>
            <box flexGrow={1} />
            <Show when={step() === "vision"}>
              <box
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={props.visionError() ? theme.error : buttonBackground(theme, hoveredButton() === "vision-model")}
                border={["left"]}
                borderColor={(() => {
                  if (props.visionError()) return theme.error
                  if (hoveredButton() === "vision-model") return theme.text
                  return theme.success
                })()}
                onMouseOver={() => {
                  blurSourceInputs()
                  setHoveredButton("vision-model")
                }}
                onMouseOut={() => setHoveredButton(null)}
                onMouseDown={() => deferPress(props.onChangeVisionModel)}
              >
                <text fg={(() => {
                  if (props.visionError()) return theme.text
                  if (hoveredButton() === "vision-model") return buttonText(theme, true, theme.text)
                  return theme.success
                })()}>{props.selectedVisionLabel()} ▼</text>
              </box>
            </Show>
          </box>
          <text fg={theme.textMuted}>
            Step {stepIndex()} of {totalSteps}
            {step() === "name" ? " — naming your workspace" : ""}
            {step() === "tools" ? " — checking your document tools" : ""}
            {step() === "scan" && !scanDone() ? " — scanning your source" : ""}
            {(step() === "imports" || (step() === "scan" && scanDone())) ? " — selecting file types to import" : ""}
            {step() === "vision" ? " — choosing how to transcribe scans & photos" : ""}
            {step() === "setup" ? " — creating your workspace" : step() === "direct" ? " — copying text-based files" : step() === "markitdown" ? " — converting office docs via MarkItDown" : step() === "pdf" ? " — processing PDFs (text direct, image pages via engine)" : step() === "ocr" ? " — running Tesseract on scanned PDFs" : step() === "verification" ? " — verifying the import" : ""}
            {step() === "provider" ? " — choosing your LLM provider" : ""}
            {step() === "startup" ? " — preparing your startup" : ""}
            {step() === "done" ? " — your workspace is ready" : ""}
            {step() === "error" ? " — fixing the issue and retrying" : ""}
          </text>
          <Show when={sourceIsCloud() && (step() === "scan" || step() === "setup" || step() === "direct" || step() === "markitdown" || step() === "pdf" || step() === "ocr" || step() === "verification")}>
            <text fg={theme.error}>  ⚠ cloud folder — scans run slower here. Keep the folder open.</text>
          </Show>

          <Show when={step() === "path"}>
            <WizardPanel theme={theme} accent viewportHeight={dimensions().height}>
              <text fg={theme.textMuted}>Source folders</text>
              <text fg={theme.textMuted}>
                Add one or more source folders. Spinosa scans them. You select file types. Spinosa creates the workspace and imports.
              </text>
              <box flexDirection="column" gap={1} paddingTop={1}>
                <For each={sourcePaths()}>
                  {(entry, index) => (
                    <box
                      flexDirection="row"
                      gap={0}
                      alignItems="center"
                      backgroundColor={
                        focusedSource() === index()
                          ? theme.backgroundElement
                          : undefined
                      }
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
                          placeholder="Paste your documents folder path"
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
                        backgroundColor={hoveredButton() === `remove-${entry.id}` ? theme.error : theme.backgroundPanel}
                        onMouseOver={() => {
                          blurSourceInputs()
                          setHoveredButton(`remove-${entry.id}`)
                        }}
                        onMouseOut={() => setHoveredButton(null)}
                        onMouseDown={() => deferPress(() => removeSourcePath(entry.id))}
                      >
                        <text fg={hoveredButton() === `remove-${entry.id}` ? theme.text : theme.textMuted}>✕</text>
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

          <Show when={step() === "name"}>
            <WizardPanel theme={theme} accent viewportHeight={dimensions().height}>
              <text fg={theme.textMuted}>Workspace name</text>
              <text fg={theme.textMuted}>
                Spinosa creates the workspace beside the first source folder with this name.
              </text>
              <box paddingTop={1} alignItems="stretch">
                <textarea
                  ref={(value: TextareaRenderable) => registerNameInput(value)}
                  initialValue={workspaceName() || defaultWorkspaceName()}
                  placeholder="Enter workspace name"
                  placeholderColor={theme.textMuted}
                  textColor={theme.text}
                  focusedTextColor={theme.text}
                  cursorColor={theme.primary}
                  minHeight={1}
                  maxHeight={1}
                  onSubmit={() => {}}
                />
              </box>
            </WizardPanel>
            <WizardActionRow>
              <WizardActionButton
                theme={theme}
                label="Back"
                onPress={handleBackPress}
              />
              <box flexGrow={1} />
              <WizardActionButton
                theme={theme}
                label="Continue"
                primary
                onPress={continueFromName}
              />
            </WizardActionRow>
          </Show>
          <Show when={step() === "tools" || step() === "scan" || step() === "imports" || step() === "vision" || step() === "setup" || step() === "direct" || step() === "markitdown" || step() === "pdf" || step() === "ocr" || step() === "verification"}>
            <WizardPanel theme={theme} viewportHeight={dimensions().height}>
              <Show when={step() === "tools"}>
                <text fg={theme.textMuted}>Document processing tools</text>
                <ToolChecksList theme={theme} checks={toolChecks()} spinIdx={spinIdx()} wavePulse={wavePulse} />
                <Show when={logLines().length > 0}>
                  <box height={1} />
                  <LogScrollbox theme={theme} lines={logLines()} viewportHeight={dimensions().height} />
                </Show>
              </Show>
              <Show when={step() === "scan" || step() === "imports"}>
                <Show when={step() === "scan" && !scanDone()}>
                  <text fg={theme.text}>{waveString(spinIdx())}</text>
                  <text fg={theme.textMuted}>{scanningFile() || "…"}</text>
                  <text fg={theme.textMuted}>Scanning {scanCount()} / {scanTotal()}</text>
                  <Show when={logLines().length > 0}>
                    <box height={1} />
                    <LogScrollbox theme={theme} lines={logLines()} viewportHeight={dimensions().height} />
                  </Show>
                </Show>
                <Show when={step() === "imports" || scanDone()}>
                  <Show when={importOptions().length === 0} fallback={
                    <>
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
                    </>
                  }>
                    <text fg={theme.text}>Spinosa found no files to import in these folders.</text>
                    <text fg={theme.textMuted}>Go back and select a different source. Or add files such as PDF, DOCX, MD or JPG.</text>
                  </Show>
                </Show>
              </Show>
              <Show when={step() === "vision"}>
                <text fg={theme.text}>Select transcription engine for images & scanned PDFs</text>
                <text fg={theme.textMuted}>Readable PDFs copy directly. Your engine transcribes scans and photos. Tesseract is free and offline. Vision models need internet and a paid key.</text>
                <OcrModelSelector
                  theme={theme}
                  options={props.ocrModelOptions()}
                  selectedIndex={props.selectedOcrModelIndex()}
                  selectedId={props.selectedOcrModel()}
                  viewportHeight={dimensions().height}
                  hint={props.ocrEngineHint()}
                  onSelectIndex={props.setSelectedOcrModelIndex}
                  onSelect={(idx) => {
                    if (idx === 1) props.openVisionPicker()
                    else props.selectOcrOption(idx)
                  }}
                />
              </Show>
              <Show when={step() === "setup" || step() === "direct" || step() === "markitdown" || step() === "pdf" || step() === "ocr"}>
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
                {/* Vision errors render inline (no reserved blank space — the
                    error box appears only when there is an error). */}
                <Show when={(step() === "markitdown" || step() === "pdf") && props.visionError()}>
                  <box flexDirection="column" gap={1} paddingTop={1}>
                    <box flexDirection="column" gap={1} paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundPanel} border={["left"]} borderColor={theme.error}>
                      <text fg={theme.error} wrapMode="word">{props.visionError()}</text>
                      <Show when={props.visionPaused()}>
                        <text fg={theme.warning} wrapMode="word">Spinosa paused the queue. Select a new model to retry this file. Or go back to abort.</text>
                      </Show>
                    </box>
                  </box>
                </Show>
              </Show>
              <Show when={step() === "verification"}>
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
                <Show when={!processingDone()}>
                  <text fg={theme.textMuted}>{verifyStatus() || "Verifying import..."}</text>
                </Show>
                <Show when={processingDone()}>
                  <text fg={importOutcomeFg()}>{importOutcomeHeading(importOutcome())}</text>
                  <Show when={importSummary() !== ""}>
                    <box paddingTop={1} flexDirection="column" gap={0}>
                      <text fg={theme.textMuted}>{importSummary()}</text>
                    </box>
                  </Show>
                  <Show when={failedCount() > 0}>
                    <box paddingTop={1} flexDirection="column" gap={0}>
                      <text fg={theme.error}>{failedCount()} file{failedCount() === 1 ? "" : "s"} failed — Spinosa kept the originals. See raw/_failed_files/.</text>
                    </box>
                  </Show>
                  <Show when={stillMissingCount() > 0 && failedCount() === 0}>
                    <box paddingTop={1} flexDirection="column" gap={0}>
                      <text fg={theme.warning}>{stillMissingCount()} file{stillMissingCount() === 1 ? "" : "s"} still missing after verification</text>
                    </box>
                  </Show>
                  <Show when={shouldShowImportDetailLogHint(importOutcome())}>
                    <box paddingTop={1} flexDirection="column" gap={0}>
                      <text fg={theme.textMuted}>{formatImportDetailLogHint()}</text>
                    </box>
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
              <Show when={(step() === "scan" && scanDone() && importOptions().length > 0) || (step() === "imports" && importOptions().length > 0)}>
                <WizardActionButton
                  theme={theme}
                  label="Continue"
                  primary
                  onPress={() => void continueFromImports()}
                />
              </Show>
              <Show when={step() === "vision"}>
                <WizardActionButton
                  theme={theme}
                  label="Continue"
                  primary
                  onPress={() => void continueFromVision()}
                />
              </Show>
              <Show when={step() !== "tools" && step() !== "scan" && step() !== "vision" && waitingForGate()}>
                <Show when={props.gateAutoPress()} fallback={
                  <WizardActionButton theme={theme} label={gateLabel()} primary onPress={() => gateAction()()} />
                }>
                  <WizardGateButton theme={theme} label={gateLabel()} action={() => gateAction()()} />
                </Show>
              </Show>
              <Show when={props.backgroundAvailable()}>
                <WizardActionButton
                  theme={theme}
                  label="Continue in background"
                  onPress={() => props.onBackground()}
                />
              </Show>
            </WizardActionRow>
          </Show>

          <OnboardingLaunchView {...props} />

          <OnboardingResultView {...props} />
          </box>
        <box flexGrow={1} minHeight={0} />
      </box>
    </CenteredColumn>
    </Show>
  )
}
