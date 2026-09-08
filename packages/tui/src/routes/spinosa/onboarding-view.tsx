import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { For, Show, type Accessor, type Setter } from "solid-js"
import { STARTUP_PROGRESS_THRESHOLD_MS } from "@spinosa/core/commands/startup"
import { CenteredColumn } from "../../component/centered-column"
import { buttonBackground, buttonText } from "../../util/button"
import {
  deferPress,
  ImportOptionsSelector,
  type ImportOption,
  LogScrollbox,
  LogoSummary,
  ProgressBar,
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
        <box width="100%" maxWidth={72} flexDirection="column" gap={1}>
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
          </box>
          <text fg={theme.textMuted}>
            Step {stepIndex()} of {totalSteps}
            {step() === "name" ? " — naming your workspace" : ""}
            {step() === "tools" ? " — checking your document tools" : ""}
            {step() === "scan" ? " — scanning your source" : ""}
            {step() === "imports" ? " — selecting file types to import" : ""}
            {step() === "setup" ? " — creating your workspace" : step() === "direct" ? " — copying files into raw/" : step() === "markitdown" ? " — converting documents with MarkItDown" : step() === "ocr" ? " — running OCR on images and PDFs" : step() === "verification" ? " — verifying the import" : ""}
            {step() === "provider" ? " — choosing your LLM provider" : ""}
            {step() === "startup" ? " — preparing your startup" : ""}
            {step() === "done" ? " — your workspace is ready" : ""}
            {step() === "error" ? " — fixing the issue and retrying" : ""}
          </text>
          <Show when={sourceIsCloud() && (step() === "scan" || step() === "setup" || step() === "direct" || step() === "markitdown" || step() === "ocr" || step() === "verification")}>
            <text fg={theme.error}>  ⚠ cloud folder — scans & copies can be slow due to sync latency</text>
          </Show>

          <Show when={step() === "path"}>
            <WizardPanel theme={theme} accent>
              <text fg={theme.textMuted}>Source folders</text>
              <text fg={theme.textMuted}>
                Add one or more source folders. Spinosa scans them, lets you choose file types, then creates a workspace beside the first folder and imports the selected files.
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
                          placeholder="Paste the corpus folder path"
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

          <Show when={step() === "name"}>
            <WizardPanel theme={theme} accent>
              <text fg={theme.textMuted}>Workspace name</text>
              <text fg={theme.textMuted}>
                The workspace folder is created beside the first source folder using this name.
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
          <Show when={step() === "tools" || step() === "scan" || step() === "setup" || step() === "direct" || step() === "markitdown" || step() === "ocr" || step() === "verification"}>
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
              <Show when={step() === "setup" || step() === "direct" || step() === "markitdown" || step() === "ocr"}>
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
                      <text fg={theme.error}>{failedCount()} file{failedCount() === 1 ? "" : "s"} failed — originals copied to raw/_failed_files/ when possible</text>
                    </box>
                  </Show>
                  <Show when={stillMissingCount() > 0 && failedCount() === 0}>
                    <box paddingTop={1} flexDirection="column" gap={0}>
                      <text fg={theme.warning}>{stillMissingCount()} file{stillMissingCount() === 1 ? "" : "s"} still missing after verify/recover</text>
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
              <Show when={step() === "scan" && scanDone()}>
                <WizardActionButton
                  theme={theme}
                  label="Continue"
                  primary
                  onPress={() => void continueFromImports()}
                />
              </Show>
              <Show when={step() !== "tools" && step() !== "scan" && waitingForGate()}>
                <WizardGateButton theme={theme} label={gateLabel()} action={() => gateAction()()} />
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
