import { buildNewWorkspacePreview } from "../../spinosa/onboarding-preview";
import { isCloudStoragePath } from "@spinosa/core/utils/path";
import { mergeImportOptions, nextScanTotals } from "./onboarding-helpers";
import type { ImportOption } from "./wizard-ui";
import type { NewWorkspacePreview } from "../../spinosa/onboarding-preview";
import type { WizardStep } from "./onboarding-view-types";

export type OnboardingScanDeps = {
  pendingPaths: readonly string[] | undefined;
  workspaceName: () => string;
  defaultWorkspaceName: () => string;
  setSourceIsCloud: (value: boolean) => void;
  setScanDone: (value: boolean) => void;
  setScanningFile: (value: string) => void;
  setScanCount: (value: number | ((current: number) => number)) => void;
  setScanTotal: (value: number | ((current: number) => number)) => void;
  setStep: (step: WizardStep) => void;
  delay: (milliseconds: number) => Promise<unknown>;
  spinOn: () => void;
  spinOff: () => void;
  clearLog: () => void;
  appendLogLine: (line: string) => void;
  logStep: (step: string, detail: string) => void;
  logAction: (action: string, detail: string) => void;
  logError: (action: string, error: unknown) => void;
  setPreview: (preview: NewWorkspacePreview) => void;
  setImportOptions: (options: ImportOption[]) => void;
  shouldAbort: () => boolean;
};

export async function scanOnboardingSources(
  deps: OnboardingScanDeps,
): Promise<void> {
  const resolved = deps.pendingPaths;
  if (!resolved || resolved.length === 0) {
    deps.logError("startScan", "No pending paths");
    deps.setStep("error");
    return;
  }

  deps.setSourceIsCloud(resolved.some((source) => isCloudStoragePath(source)));
  deps.logStep("scan", "Scanning source folder");
  deps.clearLog();
  deps.setScanDone(false);
  deps.setScanningFile("");
  deps.setScanCount(0);
  deps.setScanTotal(0);
  deps.setStep("scan");
  await deps.delay(100);
  deps.spinOn();

  try {
    const mergedOptions: ImportOption[] = [];
    for (const source of resolved) {
      deps.appendLogLine(`Scanning: ${source}`);
      const preview = await buildNewWorkspacePreview(
        source,
        deps.workspaceName() || deps.defaultWorkspaceName(),
        (relativePath, isFile, discovered) => {
          deps.setScanningFile(relativePath);
          deps.setScanCount((count) => {
            const next = nextScanTotals(discovered, isFile, count);
            deps.setScanTotal(next.scanTotal);
            return next.scanCount;
          });
        },
        deps.shouldAbort,
      );
      deps.setPreview(preview);
      mergeImportOptions(mergedOptions, preview.importOptions);
    }
    deps.setImportOptions(mergedOptions);
    deps.clearLog();
    deps.spinOff();
    deps.setScanDone(true);
    deps.logAction("scan-done", `${mergedOptions.length} file types found`);
  } catch (error) {
    deps.logError("startScan", error);
    deps.appendLogLine(
      `Scan failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    deps.setStep("error");
  }
}
