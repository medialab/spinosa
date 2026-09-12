import { Show } from "solid-js"
import {
  LogScrollbox,
  LogoSummary,
  ProgressBar,
  WizardActionButton,
  WizardActionRow,
  WizardPanel,
} from "./wizard-ui"
import type { OnboardingViewProps } from "./onboarding-view-types"

type OnboardingResultProps = Pick<OnboardingViewProps,
  | "theme"
  | "dimensions"
  | "step"
  | "progressFiles"
  | "progCurrent"
  | "progTotal"
  | "processingStatus"
  | "processingFile"
  | "verifyStatus"
  | "importOutcomeFg"
  | "importOutcome"
  | "importOutcomeHeading"
  | "importSummary"
  | "failedCount"
  | "stillMissingCount"
  | "shouldShowImportDetailLogHint"
  | "formatImportDetailLogHint"
  | "logLines"
  | "handleBackPress"
  | "finish"
  | "continueFromPath"
>

export function OnboardingResultView(props: OnboardingResultProps) {
  const {
    theme,
    dimensions,
    step,
    progressFiles,
    progCurrent,
    progTotal,
    processingStatus,
    processingFile,
    verifyStatus,
    importOutcomeFg,
    importOutcome,
    importOutcomeHeading,
    importSummary,
    failedCount,
    stillMissingCount,
    shouldShowImportDetailLogHint,
    formatImportDetailLogHint,
    logLines,
    handleBackPress,
    finish,
    continueFromPath,
  } = props

  return (
          <Show when={step() === "done" || step() === "error"}>
            <WizardPanel theme={theme} viewportHeight={dimensions().height}>
              <Show when={step() === "done"}>
                <box gap={1}>
                  <LogoSummary theme={theme} label="Spinosa created the workspace." />
                  <text fg={theme.textMuted}>
                    Spinosa imported your files. Open the workspace to continue with the setup brief.
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
                  <Show when={failedCount() > 0}>
                    <text fg={theme.error}>{failedCount()} file{failedCount() === 1 ? "" : "s"} failed — Spinosa kept the originals. See raw/_failed_files/.</text>
                  </Show>
                  <Show when={stillMissingCount() > 0 && failedCount() === 0}>
                    <text fg={theme.warning}>{stillMissingCount()} file{stillMissingCount() === 1 ? "" : "s"} still missing after verification</text>
                  </Show>
                  <Show when={shouldShowImportDetailLogHint(importOutcome())}>
                    <text fg={theme.textMuted}>{formatImportDetailLogHint()}</text>
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
                <Show when={verifyStatus() !== ""}>
                  <text fg={theme.textMuted}>{verifyStatus()}</text>
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
                  label="Open workspace"
                  primary
                  onPress={() => void finish()}
                />
              </Show>
              <Show when={step() === "error"}>
                <WizardActionButton theme={theme} label="Back" onPress={handleBackPress} />
                <box flexGrow={1} />
                <WizardActionButton theme={theme} label="Start over" primary onPress={() => void continueFromPath()} />
              </Show>
            </WizardActionRow>
          </Show>
  )
}
