import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { TextareaRenderable, TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";
import { useTheme } from "../../context/theme";
import { useRoute } from "../../context/route";
import { useSpinosaWorkspace } from "../../context/spinosa-workspace";
import {
  createWorkspace,
  resolveWorkspacePath,
} from "@spinosa/core/commands/create";
import { OCR_MODEL_OPTIONS, type OcrModelOption } from "./onboarding-helpers";
import { useSync } from "../../context/sync";
import { useSDK } from "../../context/sdk";
import { useLocal } from "../../context/local";
import { useDialog } from "../../ui/dialog";
import { DialogProvider } from "../../component/dialog-provider";
import { DialogVisionModel, isVisionProviderSelectable } from "../../component/dialog-vision";
import { useToast } from "../../ui/toast";
import { createVisionAuthFlow } from "../../spinosa/vision-auth-flow";
import { useBackgroundImport, isBackgroundAvailable, detachImportToBackground } from "../../spinosa/import-background";
import {
  prepareOnboarding,
  completeOnboarding,
} from "@spinosa/core/commands/onboard";
import type { OnboardingContext } from "@spinosa/core/commands/onboard";
import {
  scanAndClassifySource,
  verifyAndRecoverImport,
  applyResumeFilter,
} from "@spinosa/core/import/pipeline";
import { isSpinosaCancellationError } from "@spinosa/core/import/cancellation";
import { runImportWorkflow } from "@spinosa/core/import/import-workflow";
import { createVisionTranscriber } from "../../spinosa/vision-transcribe";
import {
  buildStartupChatPrompt,
  formatStartupProgressMessage,
  STARTUP_PROGRESS_INTERVAL_MS,
  STARTUP_PROGRESS_THRESHOLD_MS,
  runStartup as tsRunStartup,
} from "@spinosa/core/commands/startup";
import { resolveFrameworkRoot } from "@spinosa/core/framework/discovery";
import {
  logStep,
  logAction,
  logPhase,
  logTool,
  logResult,
  logError,
  persistImportWizardLogLines,
} from "../../spinosa/log";
import { useExit } from "../../context/exit";
import { readStartupPrompt, writePreferredCli } from "../../spinosa/service";
import { writeWorkspaceStatus } from "@spinosa/core/workspace/meta";
import {
  normalizePathInput,
  resolveExistingUserPaths,
  isCloudStoragePath,
} from "@spinosa/core/utils/path";
import { CenteredColumn } from "../../component/centered-column";
import {
  SPINOSA_BASE_MODE,
  useOpencodeKeymap,
  useOpencodeModeStack,
} from "../../keymap";
import { buttonBackground, buttonBorder, buttonText } from "../../util/button";
import {
  buildNewWorkspacePreview,
  detectDocumentTools,
  detectLlmTools,
  resolveUserPath,
  suggestWorkspacePath,
  type NewWorkspacePreview,
} from "../../spinosa/onboarding-preview";
import { shouldClearActiveOnOnboardingCancel } from "../../spinosa/onboarding-leave";
import {
  blurIfFocused,
  confirmSpinosaBack,
  createActiveWorkTracker,
  createWorkflowGuard,
  deferPress,
  delay,
  formatImportProgressStatus,
  generateScanLines,
  ImportOptionsSelector,
  nextFocusedSourceIndexForAppend,
  runGuardedBackNavigation,
  shouldActivateWizardToolAction,
  shouldCancelSpinosaWorkOnCtrlC,
  shouldConfirmSpinosaBack,
  STOP_SCREEN_DEFAULT_HINT,
  STOP_SCREEN_MIN_DWELL_MS,
  STOP_SCREEN_STILL_HINT,
  STOP_WAIT_SOFT_MS,
  type ImportOption,
  LogScrollbox,
  LogoSummary,
  ProgressBar,
  WizardActionButton,
  WizardActionRow,
  WizardGateButton,
  WizardPanel,
  wizardScrollboxMaxHeight,
  yieldToEventLoop,
} from "./wizard-ui";
import { OnboardingView } from "./onboarding-view";
import {
  formatBytes,
  initialToolChecks,
  mergeImportOptions,
  OCR_ENGINE_HINT_LINE,
  onlyLocalOcrMissing,
  toolActionLabel as resolveToolActionLabel,
  toolCheckResults,
  toolChecksReady,
  validateSinglePath as validatePath,
  wavePulse,
  waveRow,
  waveString,
} from "./onboarding-helpers";
import {
  checkDocumentTools,
  repairDocumentTools,
} from "./onboarding-tool-actions";
import { scanOnboardingSources } from "./onboarding-scan";
import { prepareOnboardingWorkspace } from "./onboarding-workspace";
import {
  countImportProgress,
  formatImportDetailLogHint,
  importOutcomeAccentKey,
  importOutcomeHeading,
  shouldShowImportDetailLogHint,
  type ImportFileProgressItem,
} from "../../spinosa/import-progress-ui";

type WizardStep =
  | "path"
  | "name"
  | "tools"
  | "scan"
  | "imports"
  | "vision"
  | "setup"
  | "direct"
  | "markitdown"
  | "ocr"
  | "verification"
  | "provider"
  | "startup"
  | "done"
  | "error";

type ToolCheckResult = {
  label: string;
  status: "checking" | "available" | "missing" | "unsupported";
  detail?: string;
};
type CliOption = {
  value: string;
  label: string;
  description: string;
};

type SourcePathEntry = {
  id: number;
};

const CANCELABLE_STEPS = [
  "tools",
  "setup",
  "direct",
  "markitdown",
  "ocr",
  "verification",
] as const;

let nextSourceId = 1;

const CLI_OPTIONS: CliOption[] = [
  {
    value: "spinosa",
    label: "Spinosa TUI",
    description: "Open the Spinosa TUI with the startup prompt ready.",
  },
  {
    value: "opencode",
    label: "Spinosa CLI",
    description: "Run the Spinosa CLI with the startup prompt.",
  },
  {
    value: "opencode_desktop",
    label: "Spinosa Desktop",
    description: "Open Spinosa and paste the copied prompt.",
  },
  {
    value: "gemini",
    label: "Gemini",
    description: "Run the Gemini CLI in this workspace.",
  },
  {
    value: "qwen",
    label: "Qwen",
    description: "Run the Qwen CLI in this workspace.",
  },
  {
    value: "claude_code",
    label: "Claude Code",
    description: "Run the terminal CLI in this workspace.",
  },
  {
    value: "claude_code_desktop",
    label: "Claude Code Desktop",
    description: "Open the desktop app with the prompt ready.",
  },
  {
    value: "codex",
    label: "Codex",
    description: "Run the Codex terminal CLI in this workspace.",
  },
  {
    value: "codex_app",
    label: "Codex App",
    description: "Open the Codex app and paste the copied prompt.",
  },
  {
    value: "hermes",
    label: "Hermes Agent",
    description: "Run the Hermes CLI in this workspace.",
  },
  {
    value: "kilo",
    label: "Kilo",
    description: "Run the Kilo terminal CLI in this workspace.",
  },
  {
    value: "other",
    label: "Other",
    description: "Copy a generic launch command for another tool.",
  },
];

function DialogVisionPicker(props: { onPicked: (providerId: string, modelId: string) => void }) {
  return <DialogVisionModel onPicked={props.onPicked} />
}

export function Onboarding() {
  const { theme } = useTheme();
  const route = useRoute();
  const { navigate } = route;
  const spinosa = useSpinosaWorkspace();
  const sdk = useSDK();
  const dimensions = useTerminalDimensions();
  const keymap = useOpencodeKeymap();
  const modeStack = useOpencodeModeStack();
  const exit = useExit();
  const dialog = useDialog();
  const onboardingRoute =
    route.data.type === "onboarding" ? route.data : undefined;
  const resumeWorkspacePath = onboardingRoute?.workspacePath;
  const resumeSourceLocation = onboardingRoute?.sourceLocation;
  const resumeWorkspaceName = onboardingRoute?.workspaceName;
  const resumeSourcePath = resumeSourceLocation
    ? resolveExistingUserPaths([resumeSourceLocation])[0]
    : undefined;
  const resumeSourceAccepted = Boolean(
    resumeSourcePath && validatePath(resumeSourcePath) === "valid",
  );

  const [step, setStep] = createSignal<WizardStep>(
    resumeSourceAccepted ? "name" : "path",
  );
  const [sourcePaths, setSourcePaths] = createSignal<SourcePathEntry[]>([
    { id: 0 },
  ]);
  const [logLines, setLogLines] = createSignal<string[]>([]);
  const [createdWorkspace, setCreatedWorkspace] = createSignal<
    string | undefined
  >(resumeWorkspacePath);
  const [busy, setBusy] = createSignal(false);
  const [importOptions, setImportOptions] = createSignal<ImportOption[]>([]);
  const [selectedImport, setSelectedImport] = createSignal(0);
  const [selectedCli, setSelectedCli] = createSignal(0);
  const [selectedOcrModel, setSelectedOcrModel] = createSignal("tesseract-local");
  const [selectedOcrModelIndex, setSelectedOcrModelIndex] = createSignal(0);
  const sync = useSync();
  const local = useLocal();
  const toast = useToast();
  // Background-capable import run owner. Survives wizard unmount so the run
  // can detach to the workspace home; wizard + home monitor are views over it.
  const bg = useBackgroundImport();

  // Mirror service run state into wizard display signals while a run owns
  // them. Local appends before startProcessing are untouched (service idle).
  createEffect(() => {
    if (!bg.active()) return;
    setProcessingStatus(bg.phaseLabel());
    setProcessingFile(bg.currentFile());
    setVisionError(bg.visionError());
    setVisionPaused(bg.snapshot().visionPause !== undefined);
    setSelectedOcrModel(bg.modelId());
    const files = bg.files();
    setProgressFiles(files);
    const counts = countImportProgress(files);
    setProgTotal(files.length > 0 ? files.length : 1);
    setProgCurrent(counts.succeeded + counts.failed);
    setLogLines(bg.logLines());
    // Phase gates: show the wizard Continue UI unless detached (service
    // auto-passes gates in background). Launch gate ("Go to the workspace")
    // is set after done, so it never collides here.
    if (!bg.done() && !bg.background()) {
      const gate = bg.pendingGate();
      if (gate) {
        setGateLabel(gate.label);
        setGateAction(() => () => {
          logAction("gate-click", gate.label);
          bg.resolveGate(true);
        });
        setGateAutoPress(true);
        setWaitingForGate(true);
      } else {
        setWaitingForGate(false);
      }
    }
  });

  // Slow phases only: detach the run and open the workspace home. Same
  // button slot as the phase actions, different copy + function. When the
  // queue already finished, the normal "Go to the workspace" applies.
  const detachToBackground = () => {
    detachImportToBackground(bg, {
      from: "onboarding",
      notify: (message) => toast.show({ variant: "info", message }),
      navigateHome: (ws) => {
        const target = ws ?? createdWorkspace();
        if (target) void spinosa.openWorkspace(target, { route: { type: "global" } });
        else navigate({ type: "global" });
      },
    });
  };
  const backgroundAvailable = () => isBackgroundAvailable(bg);
  const ocrModelOptions = createMemo(() => {
    const base = [...OCR_MODEL_OPTIONS] as OcrModelOption[]
    const picked = selectedOcrModel()
    if (picked.includes("/")) {
      const [prov, ...rest] = picked.split("/")
      const model = rest.join("/")
      // Update the Vision button (index 1) to show the chosen model — keep 3 buttons total.
      // The name stays visible here and top-right; only gate/status copy stays generic.
      base[1] = {
        ...base[1]!,
        label: `Vision Model: ${picked} ✓`,
        detail: `Selected — ${prov}/${model} — press space to select, Continue to re-choose vision model`,
        id: "vision:provider-picker",
        kind: "vision",
        modelId: model,
        provider: prov,
        vision: true,
      }
    }
    return base
  })

  // Selector UX: focused index (hover/keyboard) vs chosen id (●). Mirrors ImportOptionsSelector pattern.
  let hasRestoredVision = false
  let hasUserInteracted = false
  const selectOcrOption = (index: number) => {
    hasUserInteracted = true
    const opts = ocrModelOptions()
    const opt = opts[index]
    if (!opt) return
    setSelectedOcrModelIndex(index)
    // Vision row click is handled by openVisionPicker — don't just set placeholder here
    if (opt.id === "vision:provider-picker") return
    setSelectedOcrModel(opt.id)
  }

  // Persist vision default: tesseract until user picks a vision model, thereafter that vision is default
  // Reads from same KV as chat (vision-model.json) — single source of truth via local.vision.
  // Only runs once on initial load; user can still pick tesseract/"don't OCR" afterwards
  createEffect(() => {
    if (hasRestoredVision) return
    if (!local.vision.ready) return
    // Wait for provider catalog to hydrate — otherwise isValid/auth checks are premature
    if (sync.data.provider.length === 0 && sync.data.provider_next.connected.length === 0) return
    if (hasUserInteracted) {
      hasRestoredVision = true
      return
    }
    const last = local.vision.current()
    if (!last) {
      hasRestoredVision = true
      return
    }
    if (selectedOcrModel() !== "tesseract-local") {
      hasRestoredVision = true
      return
    }
    const id = `${last.providerID}/${last.modelID}`
    // Guard against stale/purged vision model – fallback to tesseract with toast
    if (!local.vision.isValid()) {
      logAction("vision", `Stored vision ${id} no longer valid – staying on Tesseract`)
      hasRestoredVision = true
      return
    }
    // Don't restore a vision model whose provider isn't authenticated/available — would show openai as selected without a key
    const isProviderAvailable = sync.data.provider.some((p) => p.id === last.providerID)
    const isConnected = sync.data.provider_next.connected.includes(last.providerID)
    if (!isProviderAvailable && !isConnected) {
      logAction("vision", `Stored vision ${id} provider not authenticated – staying on Tesseract`)
      hasRestoredVision = true
      return
    }
    // ChatGPT OAuth lacks api.responses.write. Provider.source identifies the active credential
    // synchronously with the connected provider list, unlike the later auth-methods hydration.
    const providerInfo = sync.data.provider.find((provider) => provider.id === last.providerID)
    if (providerInfo && !isVisionProviderSelectable(providerInfo)) {
      logAction("vision", `Stored vision ${id} is openai oauth without api.responses.write – staying on Tesseract, use openrouter for vision`)
      hasRestoredVision = true
      return
    }
    hasRestoredVision = true
    setSelectedOcrModel(id)
    setSelectedOcrModelIndex(1)
    logAction("vision", `Restored vision default ${id} from previous pick`)
  })
  // Whenever a concrete vision model is selected, persist it as new default and also to chat recents
  createEffect(
    on(selectedOcrModel, (id) => {
      if (!id.includes("/")) return
      const [prov, ...rest] = id.split("/")
      const model = rest.join("/")
      if (!prov || !model) return
      try {
        local.vision.set({ providerID: prov, modelID: model })
      } catch {}
      try {
        local.model.set({ providerID: prov, modelID: model }, { recent: true })
      } catch {}
    }),
  )

  // True when a concrete provider/model is chosen (selectedOcrModel holds "provider/model").
  // The visible label stays generic ("Vision Model") per copy, so never gate UI on the label text.
  const hasVisionModel = () => selectedOcrModel().includes("/")

  // Shared vision provider/model auth flow (also used by the background
  // import monitor). Order: select → auth if needed → confirm.
  const visionAuth = createVisionAuthFlow({ dialog, sync, sdk, toast })
  const { isVisionProviderAvailable, ensureProviderAuth, visionCredentialNote } = visionAuth

  // Vision picker order: 1. select model → 2. auth if needed → 3. confirm.
  // No dummy probes in production: the first real file transcription is the
  // validation (auth failures pause with re-auth, empty results skip).
  const openVisionPicker = () => {
    hasUserInteracted = true
    const prevChosenId = selectedOcrModel()
    const prevFocused = selectedOcrModelIndex()
    let didPick = false
    const restorePrev = () => {
      const opts = ocrModelOptions()
      const chosenIdx = opts.findIndex((o) => o.id === prevChosenId || (prevChosenId.includes("/") && o.id === "vision:provider-picker"))
      if (chosenIdx >= 0) setSelectedOcrModelIndex(chosenIdx)
      else setSelectedOcrModelIndex(prevFocused)
    }

    logAction("vision", "Opening provider/model picker for vision")
    dialog.replace(() => <DialogVisionPicker onPicked={async (providerId, modelId) => {
      const id = `${providerId}/${modelId}`
      const authed = isVisionProviderAvailable(providerId)
        ? true
        : await ensureProviderAuth(providerId).catch((e) => {
            logAction("vision", `Vision auth sequence failed for ${id}: ${e instanceof Error ? e.message : String(e)}`)
            return false
          })
      if (!authed) {
        logAction("vision", `Vision ${id} auth cancelled — keeping ${prevChosenId}`)
        restorePrev()
        dialog.clear()
        return
      }
      // No dummy probe in production: auth is done, the first real file
      // transcription is the validation (auth failures pause with re-auth,
      // empty results skip — see onVisionFailure).
      if (dialog.stack.length === 0) {
        // Dismissed during auth: never confirm behind their back.
        logAction("vision", `Vision auth dismissed for ${id} — keeping ${prevChosenId}`)
        restorePrev()
        return
      }
      didPick = true
      setSelectedOcrModel(id)
      setSelectedOcrModelIndex(1)
      logAction("vision", `Picked vision model ${id} — press Continue or reclick to change`)
      dialog.clear()
    }} />, () => {
      if (visionAuth.wasSuppressedCancel()) return
      if (!didPick) {
        restorePrev()
        logAction("vision", `Vision picker cancelled — keeping ${prevChosenId}`)
      }
    })
  }
  // Kernel vision transcribe callback — sends only provider/model/prompt/mime+base64, never API keys
  const transcribeVision = createVisionTranscriber(sdk)

  const [focusedSource, setFocusedSource] = createSignal(0);
  const [preview, setPreview] = createSignal<NewWorkspacePreview | undefined>();
  const [toolChecks, setToolChecks] = createSignal<ToolCheckResult[]>([]);
  const toolActionLabel = createMemo(() =>
    resolveToolActionLabel(toolChecks()),
  );
  const toolAllReady = createMemo(() => toolChecksReady(toolChecks()));
  const [hoveredButton, setHoveredButton] = createSignal<string | null>(null);
  const [scanProgress, setScanProgress] = createSignal(0);
  const [scanTotal, setScanTotal] = createSignal(0);
  const [processingDone, setProcessingDone] = createSignal(false);
  const [progCurrent, setProgCurrent] = createSignal(0);
  const [progTotal, setProgTotal] = createSignal(1);
  const [failedCount, setFailedCount] = createSignal(0);
  const [stillMissingCount, setStillMissingCount] = createSignal(0);
  const [processingFile, setProcessingFile] = createSignal("");
  const [visionError, setVisionError] = createSignal<string | undefined>(undefined);
  const [visionPaused, setVisionPaused] = createSignal(false);
  const [progressFiles, setProgressFiles] = createSignal<
    ImportFileProgressItem[]
  >([]);
  const [scanDone, setScanDone] = createSignal(false);
  const importOutcome = createMemo(() => ({
    failedCount: failedCount(),
    stillMissing: stillMissingCount(),
  }));
  const importOutcomeFg = createMemo(() => {
    const key = importOutcomeAccentKey(importOutcome());
    if (key === "error") return theme.error;
    if (key === "warning") return theme.warning;
    return theme.success;
  });
  const [scanningFile, setScanningFile] = createSignal("");
  const [scanCount, setScanCount] = createSignal(0);
  const [processingStatus, setProcessingStatus] = createSignal("");
  const [verifyStatus, setVerifyStatus] = createSignal("");
  const [sourceIsCloud, setSourceIsCloud] = createSignal(
    Boolean(resumeSourcePath && isCloudStoragePath(resumeSourcePath)),
  );
  const [importSummary, setImportSummary] = createSignal("");
  const [workspaceName, setWorkspaceName] = createSignal(
    resumeWorkspaceName ?? "",
  );
  const [startupMessage, setStartupMessage] = createSignal("");
  const [startupElapsedMs, setStartupElapsedMs] = createSignal(0);
  const [startupError, setStartupError] = createSignal<string | undefined>();
  const [pathValidities, setPathValidities] = createStore<
    Record<number, "unchecked" | "valid" | "invalid">
  >({});
  const [spinIdx, setSpinIdx] = createSignal(0);
  const [stopping, setStopping] = createSignal(false);
  const [stopHint, setStopHint] = createSignal(STOP_SCREEN_DEFAULT_HINT);
  let forceLeaveResolve: (() => void) | undefined;
  let spinTimer: ReturnType<typeof setInterval> | undefined;
  const spinOn = () => {
    if (!spinTimer)
      spinTimer = setInterval(() => setSpinIdx((i) => (i + 1) % 14), 200);
  };
  // Don't freeze the stop overlay wave — abort paths call spinOff() while stopping is still shown.
  const spinOff = () => {
    if (stopping()) return;
    if (spinTimer) {
      clearInterval(spinTimer);
      spinTimer = undefined;
      setSpinIdx(0);
    }
  };
  const [gateLabel, setGateLabel] = createSignal("");
  const [gateAction, setGateAction] = createSignal<() => void>(() => {});
  const [waitingForGate, setWaitingForGate] = createSignal(false);
  // Phase gates auto-press after 30s; the terminal "Go to the workspace"
  // gate must NOT (launching without consent). View picks the component.
  const [gateAutoPress, setGateAutoPress] = createSignal(true);
  // Pre-run cancellation flag for scan phase (the run itself is service-owned).
  let abortProcessing = false;
  let sourceInput: TextareaRenderable | undefined;
  let pendingPaths: string[] | undefined =
    resumeSourcePath && resumeSourceAccepted ? [resumeSourcePath] : undefined;
  let nameInput: TextareaRenderable | undefined;
  let startupTimer: ReturnType<typeof setInterval> | undefined;

  const selectedExtensions = createMemo(() =>
    importOptions()
      .filter((item) => item.selected)
      .map((item) => item.ext),
  );

  const totalSteps = 12;
  const stepIndex = createMemo(() => {
    if (step() === "path") return 1;
    if (step() === "name") return 2;
    if (step() === "tools") return 3;
    if (step() === "scan") return 4;
    if (step() === "imports") return 5;
    if (step() === "vision") return 6;
    if (step() === "setup") return 7;
    if (step() === "direct") return 8;
    if (step() === "markitdown") return 9;
    if (step() === "ocr") return 10;
    if (step() === "verification") return 11;
    if (step() === "provider") return 12;
    if (step() === "startup") return 12;
    if (step() === "done") return totalSteps;
    return totalSteps;
  });

  const appendLogLine = (...lines: string[]) =>
    setLogLines((prev) => {
      const result = [...prev];
      for (const line of lines) {
        if (line.startsWith("\r")) {
          const clean = line.replace(/^\r+/, "").trimEnd();
          if (result.length > 0 && clean) result[result.length - 1] = clean;
          else if (clean) result.push(clean);
        } else {
          result.push(line.trimEnd());
        }
      }
      return result.slice(-200);
    });

  const clearLog = () => setLogLines([]);

  const focusSourceInput = () => {
    queueMicrotask(() => {
      if (!sourceInput || sourceInput.isDestroyed) return;
      sourceInput.focus();
      sourceInput.gotoLineEnd();
    });
  };

  const focusSourceEntry = (id: number) => {
    queueMicrotask(() => {
      const input = sourceInputs.get(id);
      if (!input || input.isDestroyed) return;
      input.focus();
      input.gotoLineEnd();
    });
  };

  const addSourcePath = (options?: { focusNewInput?: boolean }) => {
    const id = nextSourceId++;
    const nextIndex = sourcePaths().length;
    setSourcePaths((prev) => [...prev, { id }]);
    setFocusedSource((current) =>
      nextFocusedSourceIndexForAppend(current, nextIndex, options),
    );
    if (options?.focusNewInput === false) return;
    focusSourceEntry(id);
  };

  const removeSourcePath = (id: number) => {
    setSourcePaths((prev) => {
      if (prev.length <= 1) return prev;
      pathSnapshot.delete(id);
      sourceInputs.delete(id);
      return prev.filter((e) => e.id !== id);
    });
  };

  const workflow = createWorkflowGuard();
  const activeWork = createActiveWorkTracker();
  const pathSnapshot = new Map<number, string>(
    resumeSourceLocation ? [[0, resumeSourceLocation]] : [],
  );
  const sourceInputs = new Map<number, TextareaRenderable>();

  const readPathText = (id: number) => {
    const live = sourceInputs.get(id)?.plainText?.trim();
    if (live) return live;
    return pathSnapshot.get(id)?.trim() ?? "";
  };

  const snapshotSourcePaths = () => {
    for (const entry of sourcePaths()) {
      const text =
        sourceInputs.get(entry.id)?.plainText ??
        pathSnapshot.get(entry.id) ??
        "";
      pathSnapshot.set(entry.id, text);
    }
  };

  const blurSourceInputs = () => {
    for (const input of sourceInputs.values()) blurIfFocused(input);
    blurIfFocused(sourceInput);
  };

  onCleanup(() => {
    clearInterval(startupTimer);
    clearInterval(spinTimer);
  });

  const sourceInputFocused = () => focusedSourceIndex() >= 0;

  const focusedSourceIndex = () => {
    const paths = sourcePaths();
    for (let i = 0; i < paths.length; i++) {
      const input = sourceInputs.get(paths[i]!.id);
      if (input && !input.isDestroyed && input.focused) return i;
    }
    return -1;
  };

  const cycleFocusedSource = (offset: number) => {
    const paths = sourcePaths();
    const current = focusedSourceIndex();
    if (current < 0 || paths.length === 0) return;
    const next = (current + offset + paths.length) % paths.length;
    setFocusedSource(next);
    const entry = paths[next];
    if (entry) focusSourceEntry(entry.id);
  };

  const allPathsResolved = () =>
    resolveExistingUserPaths(
      sourcePaths().map((entry) => readPathText(entry.id)),
    );

  if (resumeSourceLocation)
    setPathValidities(0, validatePath(resumeSourceLocation));

  const defaultWorkspaceName = createMemo(() => {
    const resolved = allPathsResolved();
    if (resolved.length === 0) return "workspace";
    const first = resolved[0]!;
    const base = path.basename(first);
    return base || "workspace";
  });

  const hasValidPaths = createMemo(() => {
    const entries = sourcePaths();
    return entries.some((e) => pathValidities[e.id] === "valid");
  });

  const stopActiveWork = () => {
    setStopping(true);
    spinOn();
    // The background service owns gates/pauses now; Back aborts the run
    // unless it was explicitly detached to the home monitor.
    if (bg.active() && !bg.background()) bg.cancel();
    workflow.bump();
    abortProcessing = true;
    setBusy(false);
    setWaitingForGate(false);
  };

  const goHome = (reason: "cancel" | "finish" = "finish") => {
    // Resume-incomplete cancel must not leave an unfinished workspace active
    // (that would show Import/Switch/Visualizer). Brand-new create cancel keeps
    // a ready workspace. Add-files is a separate route and never hits this.
    // Finish paths keep whatever openWorkspace / active state they already set.
    if (
      reason === "cancel" &&
      shouldClearActiveOnOnboardingCancel({
        isResume: Boolean(resumeWorkspacePath),
        activePath: spinosa.activePath,
        setupStatus: spinosa.meta?.setupStatus,
      })
    ) {
      spinosa.clearActiveWorkspace();
    }
    navigate({ type: "global" });
  };
  const navigateBackFrom = (from: WizardStep) => {
    if (from === "path") {
      goHome("cancel");
      return;
    }
    if (from === "name" && resumeSourceAccepted) {
      logAction("back", `from ${from} to global`);
      goHome("cancel");
      return;
    }
    if (from === "name") {
      logAction("back", `from ${from} to path`);
      setStep("path");
      return;
    }
    if (from === "tools") {
      logAction("back", `from ${from} to name`);
      setStep("name");
      return;
    }
    if (from === "scan") {
      logAction("back", `from ${from} to path`);
      setStep("path");
      return;
    }
    if (from === "imports") {
      logAction("back", `from ${from} to scan`);
      setStep("scan");
      return;
    }
    if (from === "vision") {
      logAction("back", `from ${from} to imports`);
      setStep("imports");
      return;
    }
    if (
      from === "setup" ||
      from === "direct" ||
      from === "markitdown" ||
      from === "ocr" ||
      from === "verification"
    ) {
      logAction("back", `from ${from} to vision`);
      setStep("vision");
      return;
    }
    if (from === "provider") {
      // Back out of provider returns straight to provider selection — no
      // fake gate (a gate here would sit on a 30s auto-press timer).
      logAction("back", "from provider to provider");
      setStep("provider");
      return;
    }
    if (from === "startup") {
      setStep("provider");
      return;
    }
    if (from === "error") {
      setStep(importOptions().length > 0 ? "imports" : "path");
    }
  };

  let backNavigationPending = false;
  const requestForceLeave = () => {
    if (!forceLeaveResolve) return false;
    const resolve = forceLeaveResolve;
    forceLeaveResolve = undefined;
    resolve();
    return true;
  };
  const requestBack = (confirmIfActive = true) => {
    if (backNavigationPending) return;
    const from = step();
    backNavigationPending = true;
    setStopHint(STOP_SCREEN_DEFAULT_HINT);
    const cancelPath = shouldConfirmSpinosaBack({
      step: from,
      busy: busy(),
      waitingForGate: waitingForGate(),
      cancellableSteps: CANCELABLE_STEPS as unknown as string[],
    });
    void runGuardedBackNavigation({
      shouldConfirm: confirmIfActive && cancelPath,
      confirm: () => confirmSpinosaBack(dialog, from),
      stop: stopActiveWork,
      waitForStop: () => activeWork.wait(STOP_WAIT_SOFT_MS),
      waitUntilSettled: () => activeWork.wait(0).then(() => undefined),
      onStillStopping: () => setStopHint(STOP_SCREEN_STILL_HINT),
      waitForForceLeave: () =>
        new Promise<void>((resolve) => {
          forceLeaveResolve = resolve;
        }),
      // Keep the "Stopping process..." overlay readable even when cancel is instant.
      minStopDisplayMs: cancelPath ? STOP_SCREEN_MIN_DWELL_MS : 0,
      navigate: () => navigateBackFrom(from),
    }).finally(() => {
      forceLeaveResolve = undefined;
      backNavigationPending = false;
      setStopping(false);
      setStopHint(STOP_SCREEN_DEFAULT_HINT);
      spinOff();
    });
  };

  const handleBackPress = () => requestBack(true);
  const leavePathStep = handleBackPress;

  const handleInterrupt = () => {
    if (stopping()) {
      requestForceLeave();
      return;
    }
    if (
      !shouldCancelSpinosaWorkOnCtrlC({
        step: step(),
        busy: busy(),
        waitingForGate: waitingForGate(),
        cancellableSteps: CANCELABLE_STEPS,
      })
    ) {
      exit();
      return;
    }

    appendLogLine(
      "Cancellation requested. Stopping current Spinosa operation...",
    );
    requestBack(false);
  };

  const renderToolSummaryLine = (check: ToolCheckResult): string => {
    const icon =
      check.status === "available"
        ? "✓"
        : check.status === "missing"
          ? "✗"
          : check.status === "unsupported"
            ? "–"
            : "▁";
    const detail = check.detail ? ` | ${check.detail}` : "";
    return `${icon} ${check.label} — ${check.status}${detail}`;
  };

  const toolActionDeps = {
    setToolChecks,
    setStep,
    spinOn,
    spinOff,
    delay,
    appendLogLine,
    logStep,
    logTool,
    logAction,
    logError,
  };
  const runToolCheck = () => checkDocumentTools(toolActionDeps);
  const runToolRepair = () => repairDocumentTools(toolActionDeps);

  const handleToolAction = () => {
    if (busy()) return;
    const checks = toolChecks();
    const needsRepair = checks.some((t) => t.status === "missing");
    const toolsReady = checks.every(
      (t) => t.status === "available" || t.status === "unsupported",
    );
    if (needsRepair && !onlyLocalOcrMissing(checks)) {
      logAction(
        "repair-tools",
        `${checks.filter((t) => t.status === "missing").length} tools missing`,
      );
      void activeWork.run(async () => {
        setBusy(true)
        try {
          await runToolRepair()
        } catch (err) {
          logError("runToolRepair", err);
          appendLogLine(
            `Tool repair failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          setBusy(false)
        }
      })
    } else if (toolsReady || onlyLocalOcrMissing(checks)) {
      // Tesseract-only absence never blocks: the OCR-engine choice comes
      // later, and vision/none flows never touch local OCR.
      logAction("start-scan", onlyLocalOcrMissing(checks) ? "Continuing without local OCR" : "All tools ready");
      void startScan();
    }
  };

  const startScan = () => {
    abortProcessing = false
    workflow.bump()
    return scanOnboardingSources({
      pendingPaths,
      workspaceName,
      defaultWorkspaceName,
      setSourceIsCloud,
      setScanDone,
      setScanningFile,
      setScanCount,
      setScanTotal,
      setStep,
      delay,
      spinOn,
      spinOff,
      clearLog,
      appendLogLine,
      logStep,
      logAction,
      logError,
      setPreview,
      setImportOptions,
      shouldAbort: () => abortProcessing,
    })
  }

  const continueFromPath = async () => {
    if (busy()) return;
    logAction("continue", "Path step → Name step");
    snapshotSourcePaths();
    const resolved = allPathsResolved();
    if (resolved.length === 0) {
      appendLogLine("At least one valid source path is required.");
      setStep("error");
      return;
    }
    for (const p of resolved) {
      if (!existsSync(p)) {
        appendLogLine(`Source folder does not exist: ${p}`);
        setStep("error");
        return;
      }
    }
    pendingPaths = resolved;
    if (!workspaceName()) setWorkspaceName(defaultWorkspaceName());
    logStep("name", `Sources: ${resolved.join(", ")}`);
    setStep("name");
  };

  const continueFromName = () => {
    const primarySource = pendingPaths?.[0];
    const nextWorkspaceName = workspaceName().trim() || defaultWorkspaceName();
    if (primarySource)
      setCreatedWorkspace(
        resumeWorkspacePath ??
          resolveWorkspacePath(primarySource, nextWorkspaceName),
      );
    logAction("continue", "Name step → Tools step");
    void runToolCheck();
  };

  const continueFromImports = () => {
    if (importOptions().length === 0) {
      // Empty scan: stay put with guidance instead of dead-ending to error.
      appendLogLine("No importable files found — go back and pick a different source.");
      return;
    }
    if (selectedExtensions().length === 0) {
      appendLogLine("Select at least one file type to continue.");
      logError("continueFromImports", "No file types selected");
      setStep("error");
      return;
    }
    // Show OCR model selector as a pop-up step before setup.
    // This is the lacing point for vision MarkItDown: selected model flows into
    // scanAndClassify + processMarkitdown (llmModel) with tesseract fallback.
    logAction(
      "continue",
      `Imports → Vision (${selectedExtensions().length} types: ${selectedExtensions().join(",")})`,
    );
    setStep("vision");
  };

  const continueFromVision = () => {
    const chosenId = selectedOcrModel()
    const opts = ocrModelOptions()
    // Chosen is the ●-selected id (not the keyboard focus). Vision picker holds placeholder id
    // "vision:provider-picker" until a concrete provider/model is picked (chosenId includes "/").
    let chosenOpt: OcrModelOption | undefined
    if (chosenId.includes("/")) {
      chosenOpt = opts.find((o) => o.id === "vision:provider-picker")
    } else {
      chosenOpt = opts.find((o) => o.id === chosenId) ?? opts[selectedOcrModelIndex()]
    }
    const chosen = chosenId

    if (chosen === "vision:provider-picker") {
      // No concrete model yet — clicking Continue on vision placeholder opens picker (same as clicking the row)
      openVisionPicker()
      return
    }
    // Concrete vision model already picked (e.g. "openai/gpt-..." or "openrouter/...:free")
    if (chosen.includes("/")) {
      logAction("continue", `Vision → Processing (ocrModel=${chosen})`)
      void activeWork.run(startProcessing)
      return
    }
    setSelectedOcrModel(chosen);
    logAction("continue", `Vision → Processing (ocrModel=${chosen})`);
    void activeWork.run(startProcessing);
  };

  const startProcessing = async () => {
    if (busy()) return;
    const resolved = pendingPaths;
    if (!resolved || resolved.length === 0) {
      appendLogLine("At least one valid source path is required.");
      setStep("error");
      return;
    }
    setBusy(true);
    clearLog();
    setFailedCount(0);
    setStillMissingCount(0);
    setImportSummary("");
    setProcessingDone(false);
    setProgCurrent(0);
    setProgTotal(1);
    setProcessingFile("");
    setProgressFiles([]);
    setVerifyStatus("");
    setProcessingStatus("Starting...");
    // Hand-off happens after the workspace path is planned (service needs
    // it for the home chip + detach navigation). See below.
    const extensions = selectedExtensions().join(",");
    const primarySource = resolved[0]!;
    const plannedWorkspace =
      resumeWorkspacePath ??
      preview()?.workspacePath ??
      suggestWorkspacePath(primarySource);
    if (plannedWorkspace) setCreatedWorkspace(plannedWorkspace);
    // Hand the run to the background-capable service (single-flight: a
    // second start while one is active is refused).
    const started = bg.start({
      kind: "onboarding",
      title: "Onboarding import",
      directory: sdk.directory,
      workspacePath: plannedWorkspace,
      modelId: selectedOcrModel(),
      publish: sdk.publishJobEvent,
      localEmit: (event) => sdk.event.emit("event", event),
      credentialNote: (providerId) => visionCredentialNote(providerId),
    });
    if (!started) {
      appendLogLine("An import is already running — finish or cancel it first.");
      setBusy(false);
      return;
    }
    const { job, shouldAbort } = started;
    // (service owns the job from here; local `job` alias keeps the tail readable)
    const sharedProg = job.prog;
    sharedProg.on((e) => bg.reportProgress(e));
    const onPhaseLog = job.wrapLog((msg: string) => bg.reportPhaseLog(msg, formatImportProgressStatus));
    bg.setPhase("setup");
    bg.reportStatus("Starting...");
    spinOn();
    await delay(200);

    try {
      setStep("setup");
      setProcessingStatus("Creating workspace...");
      // Drive the progress bar off the setup sub-steps emitted by createWorkspace
      // so the bar is truthful (0% → 100%) instead of a frozen placeholder.
      const setupSteps = [
        "Creating workspace directory",
        "Resuming interrupted workspace",
        "Copying workspace template",
        "Creating user-state directories",
        "Writing workspace metadata",
        "Registering in global registry",
        "Writing setup files",
      ];
      let setupDone = 0;
      bg.setProgTotal(setupSteps.length);
      bg.setProgCurrent(0);
      const setupProgress = (msg: string) => {
        bg.appendLog(msg);
        bg.reportStatus(msg);
        if (setupSteps.some((s) => msg.startsWith(s))) {
          setupDone = Math.min(setupSteps.length, setupDone + 1);
          bg.setProgCurrent(setupDone);
          sharedProg.file("setup", setupDone, setupSteps.length, msg);
        }
      };
      await yieldToEventLoop();
      const preparation = await prepareOnboardingWorkspace({
        primarySource,
        workspaceName: workspaceName() || defaultWorkspaceName(),
        projectTitle: workspaceName() || path.basename(primarySource),
        resumeWorkspacePath,
        extensions,
        sourcePaths: resolved,
        onProgress: setupProgress,
        onRecover: (message) => bg.appendLog(`Note: ${message}`),
        shouldAbort,
        appendLogLine,
      });
      if (preparation.kind === "aborted") return;
      if (preparation.kind === "error") {
        bg.appendLog(preparation.message);
        setStep("error");
        return;
      }
      const { frameworkRoot, context: ctx } = preparation;

      bg.reportStatus("Preparing import plan...");
      // The scan selector merges extensions from every source. Re-apply that
      // selection after the primary workspace scan so extra-source-only
      // extensions do not cause the primary batch to fall back to select-all.
      ctx.batches.parseExtensionsFromFlag(extensions);
      const classified = await scanAndClassifySource(
        ctx.sourcePath,
        ctx.rawDir,
        ctx.batches,
        undefined,
        shouldAbort,
        bg.getModel(),
      );
      if (!classified) {
        setStep("error");
        return;
      }
      // Resume: drop already-imported files (unchanged fingerprint + route)
      // so re-runs only process new, changed, re-routed, or failed files.
      // Already-done rows render done immediately for truthful progress.
      const resume = applyResumeFilter(classified, classified.logsDir, {
        modelId: bg.getModel(),
        onLog: (m) => bg.appendLog(m),
      });
      for (const rel of resume.skippedUnchanged) bg.reportProgress({ relPath: rel, status: "done" });
      const totalMd = classified.markitdownFiles.length;
      const totalVision = (classified as unknown as { visionFiles?: typeof classified.markitdownFiles }).visionFiles?.length ?? 0;
      const totalOcr = classified.ocrFiles.length;
      const totalDirect = classified.directFiles.length;
      bg.seedQueue([
        ...classified.directFiles,
        ...classified.markitdownFiles,
        ...((classified as unknown as { visionFiles?: typeof classified.markitdownFiles }).visionFiles ?? []),
        ...classified.ocrFiles,
      ].map((file) => file.rel));
      bg.appendLog(
        `[diag] direct=${totalDirect} markitdown=${classified.markitdownFiles.length} vision=${totalVision} ocr=${classified.ocrFiles.length}`,
      );

      const phases = await runImportWorkflow(classified, {
        prog: sharedProg,
        onLog: onPhaseLog,
        shouldAbort,
        signal: job.registered.signal,
        onChild: job.registerChild,
        ocrModelId: () => bg.getModel(),
        transcribeVision,
        // Shared service policy: empty results skip, auth/other errors pause
        // until the wizard red button or the home monitor resolves.
        onVisionFailure: (rel, modelId, error) => bg.onVisionFailure(rel, modelId, error),
        onRetry: (attempt, reason) => {
          bg.reportStatus(`Retrying file (attempt ${attempt}): ${reason}`);
        },
        onRename: (original, renamed) => {
          bg.appendLog(`  renamed (name too long): ${original} → ${renamed}`);
        },
        beforePhase: async (id, count) => {
          if (id === "direct") {
            setStep("direct");
            bg.setPhase("direct");
            bg.reportStatus(`Copying text-based files to raw — ${count} files`);
            await delay(500);
            return true;
          }
          if (id === "markitdown") {
            setBusy(false);
            // Foreground: wizard Continue UI (30s auto-press) resolves the
            // service gate. Background: auto-passed, no UI.
            if (!await bg.requestGate(id, count, "Convert office docs")) return false;
            if (shouldAbort()) return false;
            setBusy(true);
            setStep("markitdown");
            bg.setPhase("markitdown");
            bg.setVisionError(undefined)
            bg.reportStatus(`Converting via MarkItDown — ${count} files — Back to change model`);
            await delay(500);
            return true;
          }
          if (id === "vision") {
            setBusy(false);
            if (!await bg.requestGate(id, count, `Transcribe images & scanned PDFs via Vision Model`)) return false;
            if (shouldAbort()) return false;
            setBusy(true);
            setStep("markitdown");
            bg.setPhase("vision");
            bg.setVisionError(undefined)
            bg.reportStatus(`Transcribing images & scanned PDFs via Vision Model — ${count} files — Back to change model`);
            await delay(500);
            return true;
          }
          setBusy(false);
          if (!await bg.requestGate(id, count, "OCR scanned PDFs with Tesseract")) return false;
          if (shouldAbort()) return false;
          setBusy(true);
          setStep("ocr");
          bg.setPhase("ocr");
          // OCR phase handles only scanned PDFs (ita+eng+fra 300dpi); images via vision/copy now externalized
          bg.reportStatus(`Running Tesseract on scanned PDFs — ${count} files — Back to change vision model`);
          await delay(500);
          return true;
        },
        afterPhase: async (id, result) => {
          if (id === "direct") {
            bg.reportStatus(`Text-based files copied — ${result.converted} files`);
            await delay(500);
          }
          if (id === "markitdown") {
            bg.setVisionError(undefined)
            bg.reportStatus(
              `Office docs converted — ${result.converted} files${result.failed ? `, ${result.failed} failed` : ""}`,
            );
            await delay(500);
          }
          if (id === "vision") {
            const visionFailed = result.failed > 0
            if (visionFailed) {
              bg.setVisionError(`Vision ${bg.getModel()} failed for ${result.failed} file(s) — check provider/key or rate limit. You can change model and retry.`)
              bg.reportStatus(
                `Vision SDK — ${result.converted} ok, ${result.failed} failed (vision ${bg.getModel()} — see error below)`
              );
            } else {
              bg.setVisionError(undefined)
              bg.reportStatus(
                `Images & scanned PDFs via vision — ${result.converted} files${result.failed ? `, ${result.failed} failed` : ""}`,
              );
            }
            await delay(visionFailed ? 2500 : 500);
          }
          if (id === "ocr") {
            bg.reportStatus(
              result.failed > 0
                ? `Scanned PDFs via Tesseract — ${result.converted} ok, ${result.failed} failed — Back to change vision model`
                : `Scanned PDFs via Tesseract — ${result.converted} files`,
            );
            await delay(1000);
          }
        },
      });
      if (classified.markitdownFiles.length === 0) {
        bg.appendLog("MarkItDown: 0 files to convert — skipping");
      }
      if (((classified as unknown as { visionFiles?: typeof classified.markitdownFiles }).visionFiles?.length ?? 0) === 0) {
        bg.appendLog("Vision: 0 images/PDFs to transcribe — skipping");
      }
      if (classified.ocrFiles.length === 0) {
        bg.appendLog("OCR: 0 files to convert — skipping");
      }
      if (shouldAbort()) {
        spinOff();
        setBusy(false);
        return;
      }

      const dr = phases.direct;
      const mr = phases.markitdown;
      const vr = (phases as unknown as { vision?: typeof mr }).vision ?? { converted: 0, skipped: 0, failed: 0, renamed: 0, recoverable: [] as typeof mr.recoverable };
      const or = phases.ocr;

      const mergePhase = (target: typeof dr, addition: typeof dr) => {
        target.converted += addition.converted;
        target.skipped += addition.skipped;
        target.failed += addition.failed;
        target.renamed += addition.renamed;
        target.recoverable.push(...addition.recoverable);
      };
      let totalRecovered = 0;
      let totalStillMissing = 0;
      const applyVerification = (verification: {
        recoveredFiles?: string[];
        stillMissingFiles?: string[];
      }) => {
        for (const file of verification.recoveredFiles ?? []) {
          bg.reportProgress({ relPath: file, status: "done" });
        }
        for (const file of verification.stillMissingFiles ?? []) {
          bg.reportProgress({ relPath: file, status: "failed" });
        }
      };

      // Namespace additional source folders so equal filenames do not overwrite
      // one another and all sources remain distinguishable in the result list.
      for (let i = 1; i < resolved.length; i++) {
        const source = resolved[i]!;
        const sourceFolder = `source-${i + 1}`;
        bg.appendLog(`Processing: ${source} → ${sourceFolder}/`);
        const extraClassified = await scanAndClassifySource(
          source,
          ctx.rawDir,
          ctx.batches,
          sourceFolder,
          shouldAbort,
          bg.getModel(),
        );
        if (!extraClassified) {
          bg.appendLog(`No importable files in: ${source}`);
          continue;
        }

        const extraResume = applyResumeFilter(extraClassified, extraClassified.logsDir, {
          modelId: bg.getModel(),
          onLog: (m) => bg.appendLog(m),
        });
        for (const rel of extraResume.skippedUnchanged) bg.reportProgress({ relPath: rel, status: "done" });

        bg.seedQueue([
          ...extraClassified.directFiles,
          ...extraClassified.markitdownFiles,
          ...((extraClassified as unknown as { visionFiles?: typeof extraClassified.markitdownFiles }).visionFiles ?? []),
          ...extraClassified.ocrFiles,
        ].map((file) => file.rel));

        const extraPhases = await runImportWorkflow(extraClassified, {
          prog: sharedProg,
          onLog: onPhaseLog,
          shouldAbort,
          signal: job.registered.signal,
          onChild: job.registerChild,
          ocrModelId: () => bg.getModel(),
          transcribeVision,
          onVisionFailure: (rel, modelId, error) => bg.onVisionFailure(rel, modelId, error),
          onRetry: (attempt, reason) => {
            bg.reportStatus(`Retrying file (attempt ${attempt}): ${reason}`);
          },
          onRename: (original, renamed) => {
            bg.appendLog(`  renamed (name too long): ${original} → ${renamed}`);
          },
          beforePhase: async (id, count) => {
            // Extra sources skip gates (primary run already gated); still
            // track phase truthfully for the monitor + BG availability.
            if (shouldAbort()) return false;
            setStep(id);
            bg.setPhase(id);
            bg.reportStatus(`${sourceFolder}: ${id} — ${count} files`);
            return true;
          },
          afterPhase: async (id, result) => {
            bg.reportStatus(
              `${sourceFolder}: ${id} complete — ${result.converted} delivered`+
              (result.failed > 0 ? `, ${result.failed} failed` : ""),
            );
          },
        });
        mergePhase(dr, extraPhases.direct);
        mergePhase(mr, extraPhases.markitdown);
        mergePhase(vr, (extraPhases as unknown as { vision?: typeof mr }).vision ?? { converted: 0, skipped: 0, failed: 0, renamed: 0, recoverable: [] as typeof mr.recoverable });
        mergePhase(or, extraPhases.ocr);

        const extraVerify = await verifyAndRecoverImport(
          source,
          ctx.rawDir,
          ctx.batches,
          true,
          true,
          onPhaseLog,
          shouldAbort,
          ctx.rawDir,
          sourceFolder,
          undefined,
          bg.getModel(),
        );
        totalRecovered += extraVerify.recovered;
        totalStillMissing += extraVerify.stillMissing;
        applyVerification(extraVerify);
      }
      if (shouldAbort()) return;

      // Summary accounting must cover every namespaced source, not only the
      // primary source scanned while creating the workspace.
      ctx.copyableCount = bg.snapshot().files.length;

      // Phase C: Finalize (verification). Keep last-phase progressFiles, bar
      // counters, and phase status so the results panel stays accurate during verify.
      setVerifyStatus("Verifying import...");
      setStep("verification");
      bg.setPhase("verification");
      bg.reportStatus("Verifying import...");
      const result = await completeOnboarding(
        ctx,
        { direct: dr, markitdown: mr, vision: vr, ocr: or },
        {
          workspacePath: ctx.workspacePath,
          frameworkRoot,
          sourcePath: ctx.sourcePath,
          projectTitle: ctx.projectTitle,
          ocrModelId: bg.getModel(),
          onPhase: (_phase, msg) => {
            setVerifyStatus(msg);
            bg.appendLog(msg);
          },
          shouldAbort,
          additionalRecovered: totalRecovered,
        },
      );
      if (shouldAbort()) return;

      if (result.verify) {
        totalRecovered += result.verify.recovered;
        totalStillMissing += result.verify.stillMissing;
        applyVerification(result.verify);
      }

      if (result.success) {
        const counts = countImportProgress(bg.snapshot().files);
        const directTotal = dr.converted + dr.skipped + dr.failed;
        const markitdownTotal = mr.converted + mr.skipped + mr.failed;
        const visionTotal = vr.converted + vr.skipped + vr.failed;
        const ocrTotal = or.converted + or.skipped + or.failed;
        const totalFailed = counts.failed;
        const totalRenamed = dr.renamed + mr.renamed + vr.renamed + or.renamed;
        setFailedCount(totalFailed);
        setStillMissingCount(totalStillMissing);
        const summary =
          `${dr.converted + dr.skipped}/${directTotal} copied · ${mr.converted + mr.skipped}/${markitdownTotal} markitdown · ${vr.converted + vr.skipped}/${visionTotal} vision · ${or.converted + or.skipped}/${ocrTotal} ocr` +
          (totalRenamed > 0 ? ` · ${totalRenamed} renamed` : "") +
          (totalFailed > 0 ? ` · ${totalFailed} failed` : "") +
          (totalRecovered > 0 ? ` · ${totalRecovered} recovered` : "") +
          (totalStillMissing > 0 && totalFailed === 0 ? ` · ${totalStillMissing} still missing` : "");
        const ok = totalFailed === 0 && totalStillMissing === 0;
        if (bg.background()) {
          // Headless finish: no wizard summary screen — the monitor dialog
          // and home chip carry the result (chip toasts on completion).
          bg.finish({
            converted: dr.converted + mr.converted + vr.converted + or.converted,
            skipped: dr.skipped + mr.skipped + vr.skipped + or.skipped,
            failed: totalFailed,
            renamed: totalRenamed,
            recovered: totalRecovered,
            stillMissing: totalStillMissing,
            text: summary,
            success: ok,
          });
          persistImportWizardLogLines(bg.snapshot().logs, "onboarding-import");
          setBusy(false);
          spinOff();
          return;
        }
        setImportSummary(summary);
        setProcessingDone(true);
        setProcessingStatus("All done");
        if (!ok) {
          persistImportWizardLogLines(bg.snapshot().logs, "onboarding-import");
          bg.finish({
            converted: dr.converted + mr.converted + vr.converted + or.converted,
            skipped: dr.skipped + mr.skipped + vr.skipped + or.skipped,
            failed: totalFailed,
            renamed: totalRenamed,
            recovered: totalRecovered,
            stillMissing: totalStillMissing,
            text: summary,
            success: false,
          });
        } else {
          bg.finish({
            converted: dr.converted + mr.converted + vr.converted + or.converted,
            skipped: dr.skipped + mr.skipped + vr.skipped + or.skipped,
            failed: totalFailed,
            renamed: totalRenamed,
            recovered: totalRecovered,
            stillMissing: totalStillMissing,
            text: summary,
            success: true,
          });
        }
        setGateLabel("Go to the workspace");
        setGateAction(() => () => {
          setWaitingForGate(false);
          void finishProvider("spinosa");
        });
        setGateAutoPress(false);
        setWaitingForGate(true);
      } else {
        const counts = countImportProgress(bg.snapshot().files);
        setFailedCount(counts.failed);
        setStillMissingCount(totalStillMissing);
        bg.finish({
          converted: 0,
          skipped: 0,
          failed: counts.failed,
          renamed: 0,
          recovered: totalRecovered,
          stillMissing: totalStillMissing,
          text: "No files were delivered to the workspace.",
          success: false,
        });
        if (bg.background()) {
          setBusy(false);
          spinOff();
          return;
        }
        setImportSummary("No files were delivered to the workspace.");
        setProcessingDone(true);
        setStep("error");
      }
    } catch (err) {
      if (isSpinosaCancellationError(err) || shouldAbort()) {
        bg.appendLog("Spinosa import cancelled.");
        bg.reportStatus("Cancelled.");
        bg.cancel();
        return;
      }
      bg.appendLog(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      bg.finish({
        converted: 0,
        skipped: 0,
        failed: 0,
        renamed: 0,
        recovered: 0,
        stillMissing: 0,
        text: err instanceof Error ? err.message : String(err),
        success: false,
      });
      if (!bg.background()) setStep("error");
    } finally {
      if (shouldAbort() && !processingDone() && !bg.background()) bg.cancel();
      spinOff();
      setBusy(false);
    }
  };

  const stopStartupProgress = () => {
    if (startupTimer) {
      clearInterval(startupTimer);
      startupTimer = undefined;
    }
  };

  const startStartupProgress = () => {
    const startedAt = Date.now();
    setStartupElapsedMs(0);
    setStartupError(undefined);
    setStartupMessage(formatStartupProgressMessage(0));
    stopStartupProgress();
    startupTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setStartupElapsedMs(elapsed);
      setStartupMessage(formatStartupProgressMessage(elapsed));
    }, STARTUP_PROGRESS_INTERVAL_MS);
  };

  const finishProvider = async (cliValue: string) => {
    logAction("finish-provider", `CLI: ${cliValue}`);
    try {
      setStep("startup");
      startStartupProgress();
      const workspacePath = createdWorkspace();
      if (workspacePath) {
        await writePreferredCli(workspacePath, cliValue);
      }
      setSelectedCli(CLI_OPTIONS.findIndex((o) => o.value === cliValue));

      if (cliValue === "spinosa") {
        if (workspacePath) {
          const prompt = await readStartupPrompt(workspacePath);
          spinosa.queuePrompt(
            buildStartupChatPrompt(
              prompt ??
                "Error: startup-prompt.md not found. Run the startup indexing workflow manually.",
            ),
            workspacePath,
          );
          setStartupMessage("Startup complete");
          stopStartupProgress();
          await delay(300);
          await spinosa.openWorkspace(workspacePath, {
            route: { type: "global" },
          });
        }
      } else {
        if (workspacePath) {
          await tsRunStartup({
            workspacePath,
            frameworkRoot: resolveFrameworkRoot() ?? "",
            preferredCli: cliValue,
          });
        }
        setStartupMessage("Startup complete");
        stopStartupProgress();
        await delay(300);
        goHome();
      }
      logAction("finish-done", `Workspace: ${workspacePath}, CLI: ${cliValue}`);
    } catch (err) {
      stopStartupProgress();
      logError("finishProvider", err);
      const msg = err instanceof Error ? err.message : String(err);
      setStartupError(msg);
      setStartupMessage(
        formatStartupProgressMessage(
          Math.max(startupElapsedMs(), STARTUP_PROGRESS_THRESHOLD_MS),
        ),
      );
      appendLogLine(`Failed to launch ${cliValue}: ${msg}`);
      setStep("startup");
    }
  };
  const finish = async () => {
    const workspacePath = createdWorkspace();
    if (workspacePath) {
      await spinosa.openWorkspace(workspacePath);
      return;
    }
    goHome();
  };

  const toggleImport = (index: number) =>
    setImportOptions((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, selected: !item.selected } : item,
      ),
    );

  const toggleAllImports = () => {
    const shouldEnableAll = importOptions().some((item) => !item.selected);
    setImportOptions((items) =>
      items.map((item) => ({ ...item, selected: shouldEnableAll })),
    );
  };

  onMount(() => {
    if (step() === "name") {
      queueMicrotask(() => {
        if (!nameInput || nameInput.isDestroyed) return;
        nameInput.focus();
        nameInput.gotoLineEnd();
      });
    } else {
      focusSourceInput();
    }

    // Auto-add new path input when last input has content
    const autoAddTimer = setInterval(() => {
      if (step() !== "path") return;
      const entries = sourcePaths();
      if (entries.length === 0) return;
      const last = entries[entries.length - 1];
      const input = sourceInputs.get(last.id);
      if (!input || input.isDestroyed) return;
      if (input.plainText?.trim()?.length > 0) {
        addSourcePath({ focusNewInput: false });
      }
    }, 300);

    // Path validation: periodically re-validate all path inputs
    const validateTimer = setInterval(() => {
      if (step() !== "path") return;
      for (const entry of sourcePaths()) {
        const text = normalizePathInput(readPathText(entry.id));
        if (!text) {
          setPathValidities(entry.id, "unchecked");
          continue;
        }
        const resolved = resolveUserPath(text);
        if (!resolved) {
          setPathValidities(entry.id, "invalid");
          continue;
        }
        setPathValidities(entry.id, validatePath(resolved));
      }
    }, 400);

    // Ctrl+C closes the TUI (SIGINT) — handled in the keymap intercept above.
    // No back-navigation wrapping: SIGINT always terminates the session.

    // Sync workspace name from textarea
    const nameSyncTimer = setInterval(() => {
      if (step() !== "name") return;
      if (!nameInput || nameInput.isDestroyed) return;
      setWorkspaceName(nameInput.plainText?.trim() ?? defaultWorkspaceName());
    }, 300);
    const off = keymap.intercept("key", ({ event, consume }) => {
      if (modeStack.current() !== SPINOSA_BASE_MODE) return;
      setHoveredButton(null);

      if (event.ctrl && event.name === "c") {
        handleInterrupt();
        consume();
        return;
      }
      if (event.name === "escape") {
        if (stopping() && requestForceLeave()) {
          consume();
          return;
        }
        handleBackPress();
        consume();
        return;
      }

      // Slow-phase shortcuts (run phases keep busy() true, so these precede
      // the busy guard; no text inputs exist while a run is active).
      if (!sourceInputFocused()) {
        if (event.name === "b" && backgroundAvailable()) {
          detachToBackground();
          consume();
          return;
        }
        if (event.name === "v" && bg.active() && !bg.done() && (bg.phase() === "vision" || bg.phase() === "ocr")) {
          openMidRunVisionPicker();
          consume();
          return;
        }
      }

      if (busy()) return;

      if (
        waitingForGate() &&
        (step() === "tools" ||
          step() === "scan" ||
          step() === "setup" ||
          step() === "direct" ||
          step() === "markitdown" ||
          step() === "ocr" ||
          step() === "verification") &&
        event.name === "return"
      ) {
        gateAction()();
        consume();
        return;
      }

      if (step() === "path") {
        const pathsLen = sourcePaths().length;
        const editingIndex = focusedSourceIndex();

        if (editingIndex >= 0) {
          if (event.name === "up" || event.name === "k") {
            cycleFocusedSource(-1);
            consume();
            return;
          }
          if (event.name === "down" || event.name === "j") {
            cycleFocusedSource(1);
            consume();
            return;
          }
        }

        if (!sourceInputFocused()) {
          if (event.name === "up" || event.name === "k") {
            setFocusedSource((v) => Math.max(0, v - 1));
            consume();
            return;
          }
          if (event.name === "down" || event.name === "j") {
            setFocusedSource((v) => Math.min(pathsLen + 1, v + 1));
            consume();
            return;
          }
          if (event.name === "backspace") {
            // Delete the focused source row (not while editing its text).
            const entries = sourcePaths();
            const entry = entries[Math.min(focusedSource(), entries.length - 1)];
            if (entry && entries.length > 1) {
              removeSourcePath(entry.id);
              const nextIdx = Math.min(focusedSource(), sourcePaths().length - 1);
              setFocusedSource(nextIdx);
              const next = sourcePaths()[nextIdx];
              if (next) focusSourceEntry(next.id);
              consume();
              return;
            }
          }
          if (event.name === "return") {
            const focus = focusedSource();
            if (focus < pathsLen) {
              const entry = sourcePaths()[focus];
              if (entry) focusSourceEntry(entry.id);
            } else if (focus === pathsLen) {
              leavePathStep();
            } else {
              void continueFromPath();
            }
            consume();
            return;
          }
        }
      }

      if (step() === "name") {
        if (event.name === "return") {
          continueFromName();
          consume();
          return;
        }
        if (event.name === "escape") {
          handleBackPress();
          consume();
          return;
        }
      }

      if (step() === "scan" && scanDone()) {
        const listLength = importOptions().length + 1;
        if (event.name === "up" || event.name === "k") {
          setSelectedImport((value) => Math.max(0, value - 1));
          consume();
          return;
        }
        if (event.name === "down" || event.name === "j") {
          setSelectedImport((value) => Math.min(listLength - 1, value + 1));
          consume();
          return;
        }
        if (event.name === "space") {
          if (selectedImport() === 0) {
            toggleAllImports();
          } else {
            toggleImport(selectedImport() - 1);
          }
          consume();
          return;
        }
        if (event.name === "a") {
          toggleAllImports();
          consume();
          return;
        }
        if (event.name === "return") {
          continueFromImports();
          consume();
          return;
        }
      }

      if (step() === "vision") {
        const len = ocrModelOptions().length;
        if (event.name === "up" || event.name === "k") {
          setSelectedOcrModelIndex((v) => Math.max(0, v - 1));
          consume();
          return;
        }
        if (event.name === "down" || event.name === "j") {
          setSelectedOcrModelIndex((v) => Math.min(len - 1, v + 1));
          consume();
          return;
        }
        if (event.name === "space") {
          const idx = selectedOcrModelIndex()
          if (idx === 1) {
            openVisionPicker()
          } else {
            selectOcrOption(idx)
          }
          consume();
          return;
        }
        if (event.name === "return") {
          // Return is Continue — if focus differs from chosen, adopt focus first (radio arrow semantics)
          const opts = ocrModelOptions();
          const focusedOpt = opts[selectedOcrModelIndex()];
          const chosenId = selectedOcrModel();
          const isChosenVision = chosenId.includes("/");
          const focusedIsPicker = focusedOpt?.id === "vision:provider-picker";
          if (focusedOpt && focusedOpt.id !== chosenId && !(focusedIsPicker && isChosenVision)) {
            selectOcrOption(selectedOcrModelIndex());
          }
          continueFromVision();
          consume();
          return;
        }
      }

      if (
        shouldActivateWizardToolAction({
          step: step(),
          keyName: event.name,
          busy: busy(),
          toolChecks: toolChecks(),
        })
      ) {
        handleToolAction();
        consume();
        return;
      }

      if (step() === "provider") {
        if (event.name === "up" || event.name === "k") {
          setSelectedCli((value) => Math.max(0, value - 1));
          consume();
          return;
        }
        if (event.name === "down" || event.name === "j") {
          setSelectedCli((value) =>
            Math.min(CLI_OPTIONS.length - 1, value + 1),
          );
          consume();
          return;
        }
        if (event.name === "return") {
          void finishProvider(CLI_OPTIONS[selectedCli()]!.value).catch((err) =>
            appendLogLine(
              `Provider error: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
          consume();
          return;
        }
      }

      if (step() === "done" && event.name === "return") {
        void finish();
        consume();
        return;
      }

      if (step() === "error" && event.name === "return") {
        handleBackPress();
        consume();
        return;
      }
    });
    onCleanup(() => {
      clearInterval(autoAddTimer);
      clearInterval(validateTimer);
      clearInterval(nameSyncTimer);
      stopActiveWork();
      off();
    });
  });

  createEffect(
    on(
      step,
      (current, previous) => {
        if (current === "path" && current !== previous) focusSourceInput();
        if (current === "name" && current !== previous) {
          queueMicrotask(() => {
            if (!nameInput || nameInput.isDestroyed) return;
            nameInput.focus();
            nameInput.gotoLineEnd();
          });
        }
      },
      { defer: true },
    ),
  );

  const registerSourceInput = (
    id: number,
    value: TextareaRenderable,
    first: boolean,
  ) => {
    sourceInputs.set(id, value);
    if (first) sourceInput = value;
    value.traits = { status: "PATH" };
  };
  const registerNameInput = (value: TextareaRenderable) => {
    nameInput = value;
    value.traits = { status: "NAME" };
  };

  // Mid-run model switch (red Vision button + `v` shortcut): overlay picker,
  // never aborts — the current file keeps the old model, next uses the new.
  const openMidRunVisionPicker = () => {
    logAction("change-vision", `from ${step()} picker opened — current task continues with ${bg.getModel()}, next file will use new model`)
    // Don't abort — keep current markitdown file running with old model; dialog is overlay on step 9.
    // Same order as the vision-step picker: select → auth if needed → confirm.
    dialog.replace(() => <DialogVisionPicker onPicked={async (providerId, modelId) => {
      const id = `${providerId}/${modelId}`
      const forceReauth = bg.lastAuthFailedProvider() === providerId
      const needsAuth = !isVisionProviderAvailable(providerId) || forceReauth
      const authed = !needsAuth
        ? true
        : await ensureProviderAuth(providerId).catch((e) => {
            logAction("vision", `Vision auth sequence failed for ${id}: ${e instanceof Error ? e.message : String(e)}`)
            return false
          })
      if (!authed) {
        logAction("vision", `Vision ${id} auth cancelled`)
        dialog.clear()
        return
      }
      // No dummy probe in production: the first real file transcription
      // is the validation (see onVisionFailure for the failure order).
      if (dialog.stack.length === 0) {
        // Dismissed during auth: never confirm behind their back.
        logAction("vision", `Vision auth dismissed for ${id} — keeping ${bg.getModel()}`)
        dialog.clear()
        return
      }
      bg.setModel(id)
      setSelectedOcrModelIndex(1)
      logAction("vision", `Picked vision model ${id} — will apply at next file (current continues with old model)`)
      if (bg.snapshot().visionPause) {
        bg.resolvePause("retry")
      }
      dialog.clear()
    }} />, () => {
      // Escape mid-picker just closes; selection and queue are untouched.
      logAction("vision", "Mid-run model picker cancelled")
    })
  };

  const viewProps = {
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
    ocrEngineHint: () => OCR_ENGINE_HINT_LINE,
    selectedOcrModelIndex,
    setSelectedOcrModelIndex,
    selectedOcrModel,
    selectOcrOption,
    openVisionPicker,
    continueFromVision,
    visionError,
    visionPaused,
    onChangeVisionModel: openMidRunVisionPicker,
    backgroundAvailable,
    onBackground: detachToBackground,
    selectedVisionLabel: createMemo(() => {
      const opts = ocrModelOptions()
      const idx = selectedOcrModelIndex()
      const picked = selectedOcrModel()
      const opt = opts[idx]
      // Top-right button carries the concrete model name so the selection is
      // always visible. Visibility gating uses hasVisionModel(), never this text.
      if (picked.includes("/") && !opts.some((o) => o.id === picked)) return picked
      return opt?.label ?? picked
    }),
    hasVisionModel: createMemo(() => hasVisionModel()),
    waitingForGate,
    gateLabel,
    gateAction,
    gateAutoPress,
    cliOptions: CLI_OPTIONS,
    selectedCli,
    setSelectedCli,
    finishProvider,
    startupError,
    startupMessage,
    startupElapsedMs,
    finish,
  };

  return <OnboardingView {...viewProps} />;
}
