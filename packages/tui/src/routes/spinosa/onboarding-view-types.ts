import type { TextareaRenderable } from "@opentui/core"
import type { Accessor, Setter } from "solid-js"
import type { Theme } from "../../context/theme"
import type { ImportOption, OcrModelOption } from "./wizard-ui"
import type { ImportFileProgressItem } from "../../spinosa/import-progress-ui"

export type WizardStep = "path" | "name" | "tools" | "scan" | "imports" | "vision" | "setup" | "direct" | "markitdown" | "ocr" | "verification" | "provider" | "startup" | "done" | "error"
export type ToolCheckResult = {
  label: string
  status: "checking" | "available" | "missing" | "unsupported"
  detail?: string
}
export type CliOption = { value: string; label: string; description: string }
export type SourcePathEntry = { id: number }
type ImportOutcome = { failedCount: number; stillMissing: number }
type PathValidity = "unchecked" | "valid" | "invalid"

export type OnboardingViewProps = {
  theme: Theme
  dimensions: Accessor<{ height: number }>
  stopping: Accessor<boolean>
  waveString: (frame: number) => string
  wavePulse: (frame: number) => string
  spinIdx: Accessor<number>
  stopHint: Accessor<string>
  hoveredButton: Accessor<string | null>
  setHoveredButton: Setter<string | null>
  deferPress: (action: () => void) => void
  handleBackPress: () => void
  busy: Accessor<boolean>
  resumeWorkspacePath: string | undefined
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
  leavePathStep: () => void
  hasValidPaths: Accessor<boolean>
  continueFromPath: () => Promise<void>
  workspaceName: Accessor<string>
  setWorkspaceName: Setter<string>
  registerNameInput: (value: TextareaRenderable) => void
  defaultWorkspaceName: Accessor<string>
  continueFromName: () => void
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
  verifyStatus: Accessor<string>
  importOutcomeFg: Accessor<Theme["error"]>
  importOutcome: Accessor<ImportOutcome>
  importOutcomeHeading: (outcome: ImportOutcome) => string
  importSummary: Accessor<string>
  failedCount: Accessor<number>
  stillMissingCount: Accessor<number>
  shouldShowImportDetailLogHint: (outcome: ImportOutcome) => boolean
  formatImportDetailLogHint: () => string
  toolActionLabel: Accessor<string>
  toolAllReady: Accessor<boolean>
  handleToolAction: () => void
  continueFromImports: () => void
  ocrModelOptions: OcrModelOption[]
  selectedOcrModelIndex: Accessor<number>
  setSelectedOcrModelIndex: Setter<number>
  continueFromVision: () => void
  visionError: Accessor<string | undefined>
  onChangeVisionModel: () => void
  waitingForGate: Accessor<boolean>
  gateLabel: Accessor<string>
  gateAction: Accessor<() => void>
  cliOptions: CliOption[]
  selectedCli: Accessor<number>
  setSelectedCli: Setter<number>
  finishProvider: (value: string) => Promise<void>
  startupError: Accessor<string | undefined>
  startupMessage: Accessor<string>
  startupElapsedMs: Accessor<number>
  finish: () => void | Promise<void>
}


