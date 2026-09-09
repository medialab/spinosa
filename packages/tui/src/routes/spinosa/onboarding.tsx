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
import { useDialog } from "../../ui/dialog";
import { DialogSelect } from "../../ui/dialog-select";
import { DialogProvider } from "../../component/dialog-provider";
import { DialogPrompt } from "../../ui/dialog-prompt";
import {
  createImportJob,
  type ImportJobHandle,
} from "../../spinosa/job-events";
import {
  prepareOnboarding,
  completeOnboarding,
} from "@spinosa/core/commands/onboard";
import type { OnboardingContext } from "@spinosa/core/commands/onboard";
import {
  scanAndClassifySource,
  verifyAndRecoverImport,
} from "@spinosa/core/import/pipeline";
import { isSpinosaCancellationError } from "@spinosa/core/import/cancellation";
import { runImportWorkflow } from "@spinosa/core/import/import-workflow";
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
  logGate,
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
  applyImportProgressStatus,
  countImportProgress,
  formatImportDetailLogHint,
  importOutcomeAccentKey,
  importOutcomeHeading,
  seedImportQueue,
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
    label: "Spinosa",
    description: "Open the Spinosa TUI with the startup prompt ready.",
  },
  {
    value: "opencode",
    label: "Spinosa",
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
  // Reuse the same data + filtering + sorting as normal /model (DialogModel) so vision labeling is identical.
  const sync = useSync()
  const [providerId, setProviderId] = createSignal<string | null>(null)
  // All providers as shown in /model (DialogModel uses sync.data.provider sorted)
  const allProviders = createMemo(() => {
    const providers = (sync.data as unknown as { provider?: Array<{ id: string; name: string; models: Record<string, unknown> }> })?.provider ?? []
    const next = (sync.data as unknown as { provider_next?: { all?: Array<{ id: string; name: string }> } })?.provider_next?.all ?? []
    const merged = new Map<string, { id: string; name: string; models: Record<string, unknown> }>()
    for (const p of providers) merged.set(p.id, { id: p.id, name: p.name, models: p.models ?? {} as Record<string, unknown> })
    for (const p of next) if (!merged.has(p.id)) merged.set(p.id, { id: p.id, name: p.name, models: {} as Record<string, unknown> })
    if (merged.size === 0) {
      // Fallback when catalog not yet loaded — ensure dialog never empty
      return [
        { id: "openrouter", name: "OpenRouter", models: {} as Record<string, unknown> },
        { id: "openai", name: "OpenAI", models: {} as Record<string, unknown> },
        { id: "anthropic", name: "Anthropic", models: {} as Record<string, unknown> },
        { id: "google", name: "Google", models: {} as Record<string, unknown> },
      ]
    }
    return Array.from(merged.values())
  })
  const providersWithVision = createMemo(() => {
    const providers = (sync.data as unknown as { provider?: Array<{ id: string; name: string; models: Record<string, { name?: string; input?: string[]; capabilities?: { input?: string[] }; modalities?: { input?: string[] }; status?: string }> }> })?.provider ?? []
    const vision = providers.filter((p) => Object.values(p.models ?? {}).some((m) => {
      const input = (m as { capabilities?: { input?: string[] }; modalities?: { input?: string[] } }).capabilities?.input ?? (m as { modalities?: { input?: string[] } }).modalities?.input ?? (m as { input?: string[] }).input
      return Array.isArray(input) && input.includes("image") && (m as { status?: string }).status !== "deprecated"
    }))
    if (vision.length > 0) return vision
    // Fallback when catalog not yet loaded or no vision flagged — show known vision providers
    const all = allProviders()
    const withVisionFallback = all.filter((p) => ["openrouter", "openai", "anthropic", "google"].includes(p.id))
    return withVisionFallback.length > 0 ? withVisionFallback : all.slice(0, 4)
  })
  const modelsForProvider = createMemo(() => {
    const pid = providerId()
    if (!pid) return []
    const provider = (sync.data as unknown as { provider?: Array<{ id: string; models: Record<string, { name?: string; status?: string; cost?: { input?: number }; capabilities?: { input?: string[] }; modalities?: { input?: string[] }; input?: string[]; attachment?: boolean }> }> })?.provider?.find((p) => p.id === pid)
    let raw = provider ? Object.entries(provider.models ?? {}).filter(([_, info]) => (info as { status?: string }).status !== "deprecated") : []
    const mapToVision = (entries: typeof raw) => entries.map(([modelId, info]) => {
      const input = (info as { capabilities?: { input?: string[] }; modalities?: { input?: string[] } }).capabilities?.input ?? (info as { modalities?: { input?: string[] } }).modalities?.input ?? (info as { input?: string[] }).input
      const isVision = Array.isArray(input) && input.includes("image")
      return {
        providerId: pid,
        modelId,
        title: (info as { name?: string }).name ?? modelId,
        description: (info as { cost?: { input?: number } }).cost?.input === 0 ? "Vision · Free" : "Vision",
        isVision,
      }
    }).filter((m) => m.isVision).map(({ providerId, modelId, title, description }) => ({ providerId, modelId, title, description }))
    let vision = mapToVision(raw)
    // Fallback to cached models-dev file when sync has no vision (not branched or text-only) — load full catalog for that provider
    if (vision.length === 0) {
      const home = process.env.HOME ?? homedir()
      const cachePaths = [
        `${home}/.cache/spinosa/models.json`,
        `${home}/.cache/opencode/models.json`,
      ]
      for (const cp of cachePaths) {
        try {
          if (!existsSync(cp)) continue
          const txt = readFileSync(cp, "utf-8")
          const data = JSON.parse(txt) as Record<string, { models: Record<string, { name?: string; status?: string; cost?: { input?: number }; capabilities?: { input?: string[] }; modalities?: { input?: string[] }; input?: string[]; attachment?: boolean }> }>
          const prov = data[pid]
          if (prov) {
            raw = Object.entries(prov.models ?? {}).filter(([_, info]) => (info as { status?: string }).status !== "deprecated")
            vision = mapToVision(raw)
            if (vision.length > 0) break
          }
        } catch {}
      }
    }
    if (vision.length === 0) {
      // Last resort static free vision for openrouter
      if (pid === "openrouter") {
        return [
          { providerId: pid, modelId: "qwen/qwen2.5-vl-32b-instruct:free", title: "Qwen 2.5 VL 32B (free)", description: "Vision · Free" },
          { providerId: pid, modelId: "google/gemini-flash-1.5-8b:free", title: "Gemini Flash 1.5 8B (free)", description: "Vision · Free" },
        ]
      }
      return []
    }
    return vision
  })
  const providerOptions = createMemo(() => {
    const vision = providersWithVision()
    const list = vision.length > 0 ? vision : allProviders().filter((p) => Object.keys((p as { models?: Record<string, unknown> }).models ?? {}).length > 0 || (p as { id: string }).id === "openrouter")
    const displayBase = list.length > 0 ? list : allProviders().slice(0, 8)
    // Static fallback when sync not yet loaded or no providers — ensures dialog never empty
    const fallback = displayBase.length > 0 ? displayBase : [
      { id: "openrouter", name: "OpenRouter", models: {} as Record<string, unknown> },
      { id: "openai", name: "OpenAI", models: {} as Record<string, unknown> },
      { id: "anthropic", name: "Anthropic", models: {} as Record<string, unknown> },
      { id: "google", name: "Google", models: {} as Record<string, unknown> },
    ]
    return fallback.map((p) => ({
      title: (p as { name: string }).name,
      value: (p as { id: string }).id,
      description: (p as { id: string }).id,
      category: vision.length > 0 ? "Providers with vision" : "Providers",
      onSelect() {
        setProviderId((p as { id: string }).id)
      },
    }))
  })
  const modelOptions = createMemo(() =>
    modelsForProvider().map((m) => ({
      title: m.title,
      value: m.modelId,
      description: m.description,
      category: providerId() ?? undefined,
      onSelect() {
        props.onPicked(m.providerId, m.modelId)
      },
    }))
  )
  return (
    <Show when={providerId() === null} fallback={
      <DialogSelect
        title={`Select vision model — ${providerId()}`}
        options={modelOptions()}
      />
    }>
      <DialogSelect
        title="Select vision provider"
        options={providerOptions()}
      />
    </Show>
  )
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
  // Dynamic vision options: tesseract + none + provider vision models from catalog (input includes "image")
  const ocrVisionOptionsFromProviders = createMemo(() => {
    const providers = (sync.data as unknown as { provider?: Array<{ id: string; name: string; models: Record<string, { name?: string; input?: string[]; capabilities?: { input?: string[] }; status?: string; cost?: { input?: number }; release_date?: string }> }> })?.provider ?? []
    const vision: OcrModelOption[] = []
    for (const p of providers) {
      for (const [modelId, info] of Object.entries(p.models ?? {})) {
        if ((info as { status?: string }).status === "deprecated") continue
        const input = (info as { capabilities?: { input?: string[] } }).capabilities?.input ?? (info as { input?: string[] }).input
        const isVision = Array.isArray(input) && input.includes("image")
        if (!isVision) continue
        // Prefer free openrouter vision models, but show all vision models (user may have key for paid)
        const isFree = (info as { cost?: { input?: number } }).cost?.input === 0
        vision.push({
          id: `${p.id}/${modelId}`,
          label: `${p.name} · ${info.name ?? modelId}${isFree ? " (free)" : ""}`,
          detail: `Vision · ${p.id}/${modelId}${isFree ? " · free" : ""}`,
          kind: "vision",
          modelId,
          provider: p.id,
          vision: true,
          cost: isFree ? "free" : "paid",
          requiresKey: p.id === "openrouter" ? "OPENROUTER_API_KEY" : undefined,
        })
      }
    }
    // Sort free first, then by provider/name
    vision.sort((a, b) => (a.cost === "free" && b.cost !== "free" ? -1 : a.cost !== "free" && b.cost === "free" ? 1 : a.label.localeCompare(b.label)))
    // Limit to 6 vision options to keep selector short
    return vision.slice(0, 6)
  })
  const ocrModelOptions = () => OCR_MODEL_OPTIONS
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
  const updateProgressFileStatus = (
    relPath: string,
    status: ImportFileProgressItem["status"],
  ) => {
    setProgressFiles((previous) => {
      const next = applyImportProgressStatus(previous, relPath, status);
      const counts = countImportProgress(next);
      setProgTotal(next.length > 0 ? next.length : 1);
      setProgCurrent(counts.succeeded + counts.failed);
      return next;
    });
  };
  const appendProgressQueue = (rels: string[]) => {
    if (rels.length === 0) return;
    setProgressFiles((previous) => {
      const known = new Set(previous.map((item) => item.rel));
      const next = [
        ...previous,
        ...seedImportQueue(rels).filter((item) => !known.has(item.rel)),
      ];
      const counts = countImportProgress(next);
      setProgTotal(next.length > 0 ? next.length : 1);
      setProgCurrent(counts.succeeded + counts.failed);
      return next;
    });
  };
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
  let abortProcessing = false;
  let gateResolve: (() => void) | undefined;
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
  let activeJob: ImportJobHandle | undefined;
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
    if (gateResolve) {
      gateResolve();
      gateResolve = undefined;
    }
    workflow.bump();
    abortProcessing = true;
    activeJob?.cancel();
    activeJob = undefined;
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
    if (from === "vision") {
      logAction("back", `from ${from} to scan`);
      setStep("scan");
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
      setGateLabel("Choose provider");
      setGateAction(() => () => {
        setWaitingForGate(false);
        setStep("provider");
      });
      setWaitingForGate(true);
      setStep("verification");
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

  const generateToolCheckLines = (): ToolCheckResult[] => [
    {
      label: "Tesseract OCR",
      status: "checking",
      detail: "Scanned PDFs (ita+eng+fra, 300dpi)",
    },
    {
      label: "MarkItDown",
      status: "checking",
      detail: "Office docs, EPUB, HTML, text PDFs",
    },
    {
      label: "PDF.js",
      status: "checking",
      detail: "PDF text extraction and page rendering",
    },
  ];

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
    if (needsRepair) {
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
    } else if (toolsReady) {
      logAction("start-scan", "All tools ready");
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
    const opts = ocrModelOptions()
    const chosenOpt = opts[selectedOcrModelIndex()]
    const chosen = chosenOpt?.id ?? "tesseract-local";
    if (chosen === "vision:provider-picker") {
      // Open provider/model picker for vision — same catalog as /model, filtered for image input
      logAction("vision", "Opening provider/model picker for vision");
      dialog.replace(() => <DialogVisionPicker onPicked={async (providerId, modelId) => {
        const id = `${providerId}/${modelId}`
        const requiresKey = providerId === "openrouter" ? "OPENROUTER_API_KEY" : providerId === "google" ? "GOOGLE_GENERATIVE_AI_API_KEY" : `${providerId.toUpperCase()}_API_KEY`
        const hasEnvKey = Boolean(process.env[requiresKey] ?? (requiresKey === "GOOGLE_GENERATIVE_AI_API_KEY" ? process.env.GEMINI_API_KEY : undefined))
        const isConnected = sync.data.provider_next.connected.includes(providerId)
        if (!hasEnvKey && !isConnected) {
          // Seamless: prompt for key inline, persist via auth.set + set env for immediate use — no exit needed
          logAction("vision", `Vision ${id} needs ${requiresKey} — prompting`)
          const key = await new Promise<string | null>((resolve) => {
            dialog.replace(() => (
              <DialogPrompt
                title={`${providerId} API key`}
                placeholder="Paste API key"
                onConfirm={(v) => resolve(v)}
              />
            ), () => resolve(null))
          })
          if (!key) {
            logAction("vision", `Vision ${id} cancelled — no key entered`)
            dialog.clear()
            return
          }
          // Set for current process so pipeline finds it immediately
          process.env[requiresKey] = key
          if (requiresKey === "GOOGLE_GENERATIVE_AI_API_KEY") process.env.GEMINI_API_KEY = key
          try {
            await sdk.client.auth.set({ providerID: providerId, auth: { type: "api", key } })
            await sync.refreshProviders()
          } catch {}
          logAction("vision", `Vision ${id} key saved for ${providerId}`)
        }
        setSelectedOcrModel(id)
        logAction("vision", `Picked vision model ${id}`)
        dialog.clear()
        void activeWork.run(startProcessing)
      }} />)
      return
    }
    // If vision model needs API key and provider not yet branched/connected, prompt for key
    if (chosenOpt?.requiresKey) {
      const keyEnv = chosenOpt.requiresKey
      const hasKey = Boolean(process.env[keyEnv])
      // Check if provider is already in catalog (branched)
      const providerBranched = sync.data.provider.some((p) => p.id === chosenOpt.provider)
      if (!hasKey) {
        if (!providerBranched) {
          // Open provider connect dialog — same as /model → Connect provider
          logAction("vision", `Provider ${chosenOpt.provider} not branched — opening connect dialog`);
          // Keep vision selection but let user connect first
          dialog.replace(() => <DialogProvider />)
          appendLogLine(`Connect ${chosenOpt.provider} to use ${chosenOpt.label} — set ${keyEnv} or pick Tesseract.`)
          return
        }
        // Provider branched but key missing (e.g. env not set) — warn and stay
        appendLogLine(`API key ${keyEnv} missing for ${chosenOpt.label} — set ${keyEnv} in env or choose Tesseract.`)
      }
    }
    setSelectedOcrModel(chosen);
    logAction("continue", `Vision → Processing (ocrModel=${chosen})`);
    void activeWork.run(startProcessing);
  };

  const gate = (label = "Continue") =>
    new Promise<void>((resolve) => {
      gateResolve = resolve;
      logGate(label);
      setGateLabel(label);
      setGateAction(() => () => {
        logAction("gate-click", label);
        setWaitingForGate(false);
        gateResolve = undefined;
        resolve();
      });
      setWaitingForGate(true);
    });

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
    abortProcessing = false;
    const generation = workflow.bump();
    gateResolve = undefined;
    spinOn();
    await delay(200);
    const extensions = selectedExtensions().join(",");
    const primarySource = resolved[0]!;
    const plannedWorkspace =
      resumeWorkspacePath ??
      preview()?.workspacePath ??
      suggestWorkspacePath(primarySource);
    if (plannedWorkspace) setCreatedWorkspace(plannedWorkspace);
    const job = createImportJob({
      kind: "import",
      title: "Onboarding import",
      directory: plannedWorkspace ?? sdk.directory,
      publish: sdk.publishJobEvent,
      localEmit: (event) => sdk.event.emit("event", event),
    });
    activeJob = job;
    const shouldAbort = () =>
      abortProcessing || !workflow.active(generation) || job.shouldAbort();
    job.start();
    const sharedProg = job.prog;
    sharedProg.on((e) => {
      if (e.relPath && e.status === "processing") setProcessingFile(e.relPath);
      else if (e.relPath && (e.status === "done" || e.status === "failed" || e.status === "error")) {
        // Clear stale processing label when file reaches terminal state;
        // otherwise `fileName` fallback would keep a phantom `›` after phase ends
        // (e.g. survey-results.csv) while OCR files remain queued.
        if (e.relPath === processingFile()) setProcessingFile("");
      }
      if (e.status && e.relPath) {
        updateProgressFileStatus(e.relPath, e.status);
      } else if (e.phase === "setup") {
        setProgTotal(e.total > 0 ? e.total : 1);
        setProgCurrent(Math.max(0, e.current));
      }
    });
    const onPhaseLog = job.wrapLog((msg: string) => {
      if (msg.startsWith("  ")) {
        // Per-file progress lines (e.g. "file → OCR ...") are shown as the
        // status only; the emitter already drives processingFile, so setting it
        // here too would duplicate the same text as a second line.
        const label = msg.trim();
        setProcessingStatus(label);
        return;
      }
      appendLogLine(msg);
    });

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
      setProgTotal(setupSteps.length);
      setProgCurrent(0);
      const setupProgress = (msg: string) => {
        appendLogLine(msg);
        setProcessingStatus(msg);
        if (setupSteps.some((s) => msg.startsWith(s))) {
          setupDone = Math.min(setupSteps.length, setupDone + 1);
          setProgCurrent(setupDone);
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
        onRecover: (message) => appendLogLine(`Note: ${message}`),
        shouldAbort,
        appendLogLine,
      });
      if (preparation.kind === "aborted") return;
      if (preparation.kind === "error") {
        appendLogLine(preparation.message);
        setStep("error");
        return;
      }
      const { frameworkRoot, context: ctx } = preparation;

      setProcessingStatus("Preparing import plan...");
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
        selectedOcrModel(),
      );
      if (!classified) {
        setStep("error");
        return;
      }
      const totalMd = classified.markitdownFiles.length;
      const totalOcr = classified.ocrFiles.length;
      const totalDirect = classified.directFiles.length;
      appendProgressQueue([
        ...classified.directFiles,
        ...classified.markitdownFiles,
        ...classified.ocrFiles,
      ].map((file) => file.rel));
      appendLogLine(
        `[diag] direct=${totalDirect} markitdown=${classified.markitdownFiles.length} ocr=${classified.ocrFiles.length}`,
      );

      const phases = await runImportWorkflow(classified, {
        prog: sharedProg,
        onLog: onPhaseLog,
        shouldAbort,
        signal: job.registered.signal,
        onChild: job.registerChild,
        ocrModelId: selectedOcrModel(),
        onRetry: (attempt, reason) => {
          setProcessingStatus(`Retrying file (attempt ${attempt}): ${reason}`);
        },
        onRename: (original, renamed) => {
          appendLogLine(`  renamed (name too long): ${original} → ${renamed}`);
        },
        beforePhase: async (id, count) => {
          if (id === "direct") {
            setStep("direct");
            setProcessingStatus(`Copying text-based files to raw — ${count} files`);
            await delay(500);
            return true;
          }
          if (id === "markitdown") {
            setBusy(false);
            await gate("Convert office docs & text PDFs");
            if (shouldAbort()) return false;
            setBusy(true);
            setStep("markitdown");
            // Images are only in markitdown when vision (provider/model) is selected;
            // with tesseract/none they are copy-only and not counted here.
            const hasVision = selectedOcrModel().includes("/")
            const simpleHint = hasVision ? ` (images via vision:${selectedOcrModel().split("/").pop()})` : ""
            setProcessingStatus(`Converting via MarkItDown — ${count} files${simpleHint} — Back to change model`);
            await delay(500);
            return true;
          }
          setBusy(false);
          await gate("OCR scanned PDFs with Tesseract");
          if (shouldAbort()) return false;
          setBusy(true);
          setStep("ocr");
          // OCR phase handles only scanned PDFs (ita+eng+fra 300dpi); images already via markitdown/copy
          setProcessingStatus(`Running Tesseract on scanned PDFs — ${count} files — Back to change vision model`);
          await delay(500);
          return true;
        },
        afterPhase: async (id, result) => {
          if (id === "direct") {
            setProcessingStatus(`Text-based files copied — ${result.converted} files`);
            await delay(500);
          }
          if (id === "markitdown") {
            const visionFailed = result.failed > 0 && selectedOcrModel().includes("/")
            const hasVision = selectedOcrModel().includes("/")
            setProcessingStatus(
              visionFailed
                ? `MarkItDown — ${result.converted} ok, ${result.failed} failed (vision ${selectedOcrModel()} — check provider/key, Back to change)`
                : hasVision
                  ? `Office docs, text PDFs & images via vision — ${result.converted} files${result.failed ? `, ${result.failed} failed` : ""}`
                  : `Office docs & text PDFs converted — ${result.converted} files${result.failed ? `, ${result.failed} failed` : ""}`,
            );
            // Dwell longer when vision failed so provider error is readable before verify
            await delay(visionFailed ? 1500 : 500);
          }
          if (id === "ocr") {
            setProcessingStatus(
              result.failed > 0
                ? `Scanned PDFs via Tesseract — ${result.converted} ok, ${result.failed} failed — Back to change vision model`
                : `Scanned PDFs via Tesseract — ${result.converted} files`,
            );
            // Dwell so failure-first 100% results are readable before verify.
            await delay(1000);
          }
        },
      });
      if (classified.markitdownFiles.length === 0) {
        appendLogLine("MarkItDown: 0 files to convert — skipping");
      }
      if (classified.ocrFiles.length === 0) {
        appendLogLine("OCR: 0 files to convert — skipping");
      }
      if (shouldAbort()) {
        spinOff();
        setBusy(false);
        return;
      }

      const dr = phases.direct;
      const mr = phases.markitdown;
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
          updateProgressFileStatus(file, "done");
        }
        for (const file of verification.stillMissingFiles ?? []) {
          updateProgressFileStatus(file, "failed");
        }
      };

      // Namespace additional source folders so equal filenames do not overwrite
      // one another and all sources remain distinguishable in the result list.
      for (let i = 1; i < resolved.length; i++) {
        const source = resolved[i]!;
        const sourceFolder = `source-${i + 1}`;
        appendLogLine(`Processing: ${source} → ${sourceFolder}/`);
        const extraClassified = await scanAndClassifySource(
          source,
          ctx.rawDir,
          ctx.batches,
          sourceFolder,
          shouldAbort,
        );
        if (!extraClassified) {
          appendLogLine(`No importable files in: ${source}`);
          continue;
        }

        appendProgressQueue([
          ...extraClassified.directFiles,
          ...extraClassified.markitdownFiles,
          ...extraClassified.ocrFiles,
        ].map((file) => file.rel));

        const extraPhases = await runImportWorkflow(extraClassified, {
          prog: sharedProg,
          onLog: onPhaseLog,
          shouldAbort,
          signal: job.registered.signal,
          onChild: job.registerChild,
          onRetry: (attempt, reason) => {
            setProcessingStatus(`Retrying file (attempt ${attempt}): ${reason}`);
          },
          onRename: (original, renamed) => {
            appendLogLine(`  renamed (name too long): ${original} → ${renamed}`);
          },
          beforePhase: async (id, count) => {
            setStep(id);
            setProcessingStatus(`${sourceFolder}: ${id} — ${count} files`);
            return true;
          },
          afterPhase: async (id, result) => {
            setProcessingStatus(
              `${sourceFolder}: ${id} complete — ${result.converted} delivered`+
              (result.failed > 0 ? `, ${result.failed} failed` : ""),
            );
          },
        });
        mergePhase(dr, extraPhases.direct);
        mergePhase(mr, extraPhases.markitdown);
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
        );
        totalRecovered += extraVerify.recovered;
        totalStillMissing += extraVerify.stillMissing;
        applyVerification(extraVerify);
      }
      if (shouldAbort()) return;

      // Summary accounting must cover every namespaced source, not only the
      // primary source scanned while creating the workspace.
      ctx.copyableCount = progressFiles().length;

      // Phase C: Finalize (verification). Keep last-phase progressFiles, bar
      // counters, and phase status so the results panel stays accurate during verify.
      setProcessingFile("");
      setVerifyStatus("Verifying import...");
      setStep("verification");
      const result = await completeOnboarding(
        ctx,
        { direct: dr, markitdown: mr, ocr: or },
        {
          workspacePath: ctx.workspacePath,
          frameworkRoot,
          sourcePath: ctx.sourcePath,
          projectTitle: ctx.projectTitle,
          onPhase: (_phase, msg) => {
            setVerifyStatus(msg);
            appendLogLine(msg);
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
        const counts = countImportProgress(progressFiles());
        const directTotal = dr.converted + dr.skipped + dr.failed;
        const markitdownTotal = mr.converted + mr.skipped + mr.failed;
        const ocrTotal = or.converted + or.skipped + or.failed;
        const totalFailed = counts.failed;
        const totalRenamed = dr.renamed + mr.renamed + or.renamed;
        setFailedCount(totalFailed);
        setStillMissingCount(totalStillMissing);
        const summary =
          `${dr.converted + dr.skipped}/${directTotal} copied · ${mr.converted + mr.skipped}/${markitdownTotal} markitdown · ${or.converted + or.skipped}/${ocrTotal} ocr` +
          (totalRenamed > 0 ? ` · ${totalRenamed} renamed` : "") +
          (totalFailed > 0 ? ` · ${totalFailed} failed` : "") +
          (totalRecovered > 0 ? ` · ${totalRecovered} recovered` : "") +
          (totalStillMissing > 0 && totalFailed === 0 ? ` · ${totalStillMissing} still missing` : "");
        setImportSummary(summary);
        setProcessingDone(true);
        setProcessingStatus("All done");
        if (totalFailed > 0 || totalStillMissing > 0) {
          persistImportWizardLogLines(logLines(), "onboarding-import");
          job.finish("error", summary);
        } else {
          job.finish("completed", summary);
        }
        setGateLabel("Go to the workspace");
        setGateAction(() => () => {
          setWaitingForGate(false);
          void finishProvider("spinosa");
        });
        setWaitingForGate(true);
      } else {
        const counts = countImportProgress(progressFiles());
        setFailedCount(counts.failed);
        setStillMissingCount(totalStillMissing);
        setImportSummary("No files were delivered to the workspace.");
        setProcessingDone(true);
        job.finish("error", "Onboarding import failed");
        setStep("error");
      }
    } catch (err) {
      if (isSpinosaCancellationError(err) || shouldAbort()) {
        appendLogLine("Spinosa import cancelled.");
        setProcessingStatus("Cancelled.");
        job.cancel();
        return;
      }
      appendLogLine(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      job.finish("error", err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally {
      if (shouldAbort() && !processingDone()) job.cancel();
      if (activeJob === job) activeJob = undefined;
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
        const len = OCR_MODEL_OPTIONS.length;
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
        if (event.name === "return") {
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
    ocrModelOptions: ocrModelOptions(),
    selectedOcrModelIndex,
    setSelectedOcrModelIndex,
    continueFromVision,
    waitingForGate,
    gateLabel,
    gateAction,
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
