import { For, Show } from "solid-js"
import { STARTUP_PROGRESS_THRESHOLD_MS } from "@spinosa/core/commands/startup"
import { buttonBackground, buttonText } from "../../util/button"
import { deferPress, wizardScrollboxMaxHeight, WizardActionButton, WizardActionRow, WizardPanel } from "./wizard-ui"
import type { OnboardingViewProps } from "./onboarding-view-types"

type OnboardingLaunchProps = Pick<OnboardingViewProps,
  | "theme"
  | "dimensions"
  | "deferPress"
  | "handleBackPress"
  | "step"
  | "cliOptions"
  | "selectedCli"
  | "setSelectedCli"
  | "finishProvider"
  | "startupError"
  | "startupMessage"
  | "startupElapsedMs"
>

export function OnboardingLaunchView(props: OnboardingLaunchProps) {
  const {
    theme,
    dimensions,
    deferPress,
    handleBackPress,
    step,
    cliOptions,
    selectedCli,
    setSelectedCli,
    finishProvider,
    startupError,
    startupMessage,
    startupElapsedMs,
  } = props

  return (
    <>
          <Show when={step() === "provider"}>
            <WizardPanel theme={theme} viewportHeight={dimensions().height}>
              <text fg={theme.textMuted}>Choose what opens after import</text>
              <text fg={theme.textMuted}>
                Select a tool for the next step. Spinosa opens Chat with the setup brief ready. Other tools open with the prompt.
              </text>
               <scrollbox maxHeight={wizardScrollboxMaxHeight(dimensions().height, { min: 4, ratio: 0.5, max: 12 })} verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}>
                <For each={cliOptions}>
                  {(item, index) => (
                    <box
                      paddingTop={1}
                      paddingBottom={1}
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={selectedCli() === index() ? buttonBackground(theme, true) : undefined}
                      onMouseOver={() => setSelectedCli(index())}
                      onMouseDown={() => deferPress(() => void finishProvider(item.value))}
                    >
                      <text fg={buttonText(theme, selectedCli() === index(), theme.primary)}>
                        <span style={{ bold: selectedCli() === index() }}>{item.label}</span>
                      </text>
                      <text fg={buttonText(theme, selectedCli() === index(), theme.textMuted)}> {item.description}</text>
                    </box>
                  )}
                </For>
              </scrollbox>
              <text fg={theme.textMuted}>↑↓ move · enter select</text>
            </WizardPanel>
          </Show>

          <Show when={step() === "startup"}>
            <WizardPanel theme={theme} viewportHeight={dimensions().height}>
              <text fg={theme.textMuted}>Launching startup</text>
              <text fg={startupError() ? theme.error : theme.text}>
                <span style={{ bold: true }}>{startupError() ? "Startup failed" : startupMessage()}</span>
              </text>
              <Show when={!startupError()}>
                <text fg={theme.textMuted}>
                  {startupElapsedMs() >= STARTUP_PROGRESS_THRESHOLD_MS
                    ? `Elapsed ${Math.round(startupElapsedMs() / 100) / 10}s`
                    : "Preparing the setup brief…"}
                </text>
              </Show>
              <Show when={startupError()}>
                <text fg={theme.textMuted}>{startupError()}</text>
              </Show>
            </WizardPanel>
            <WizardActionRow>
              <Show when={startupError()}>
                <WizardActionButton theme={theme} label="Back" onPress={handleBackPress} />
                <box flexGrow={1} />
                <WizardActionButton
                  theme={theme}
                  label="Retry"
                  primary
                  onPress={() => void finishProvider(cliOptions[selectedCli()]?.value ?? "spinosa")}
                />
              </Show>
            </WizardActionRow>
          </Show>


    </>
  )
}

