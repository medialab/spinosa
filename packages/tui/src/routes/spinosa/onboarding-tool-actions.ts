import type { Accessor, Setter } from "solid-js";
import { detectDocumentTools } from "../../spinosa/onboarding-preview";
import { runReinstall } from "../../spinosa/reinstall";
import {
  readBundledFrameworkVersion,
  isPrereleaseFrameworkVersion,
} from "../../spinosa/service";
import { stripAnsi } from "./wizard-ui";
import { initialToolChecks, toolCheckResults } from "./onboarding-helpers";
import type { ToolCheckResult, WizardStep } from "./onboarding-view-types";

export type OnboardingToolActionDeps = {
  setToolChecks: Setter<ToolCheckResult[]>;
  setStep: Setter<WizardStep>;
  spinOn: () => void;
  spinOff: () => void;
  delay: (milliseconds: number) => Promise<unknown>;
  appendLogLine: (line: string) => void;
  logStep: (step: string, detail: string) => void;
  logTool: (
    label: string,
    status: ToolCheckResult["status"],
    detail?: string,
  ) => void;
  logAction: (action: string, detail: string) => void;
  logError: (action: string, error: unknown) => void;
};

export async function checkDocumentTools(
  deps: OnboardingToolActionDeps,
): Promise<void> {
  deps.logStep("tools", "Checking document processing tools");
  deps.setToolChecks(initialToolChecks());
  deps.setStep("tools");
  deps.spinOn();

  await deps.delay(80);
  const results = toolCheckResults(await detectDocumentTools());
  deps.setToolChecks(results);
  for (const result of results)
    deps.logTool(result.label, result.status, result.detail);
  deps.spinOff();
}

export async function repairDocumentTools(
  deps: OnboardingToolActionDeps,
): Promise<void> {
  deps.logAction("repair", "Tools missing — repairing");
  deps.setToolChecks((previous) =>
    previous.map((tool) =>
      tool.status === "missing" ? { ...tool, status: "checking" } : tool,
    ),
  );
  await deps.delay(80);

  const version = await readBundledFrameworkVersion();
  const channel =
    version && isPrereleaseFrameworkVersion(version) ? "beta" : "stable";
  let reinstallResult: Awaited<ReturnType<typeof runReinstall>> | undefined;
  try {
    reinstallResult = await runReinstall({
      channel,
      onStdout: (chunk) => {
        const clean = stripAnsi(chunk);
        if (clean) deps.appendLogLine(clean);
      },
      onStderr: (chunk) => {
        const clean = stripAnsi(chunk);
        if (clean) deps.appendLogLine(clean);
      },
    });
    if (reinstallResult.exitCode !== 0) {
      const detail = reinstallResult.stderr?.trim() || `exit ${reinstallResult.exitCode}`;
      deps.logError("repairDocumentTools", `Reinstall failed: ${detail}`);
      deps.appendLogLine(`Tool repair failed: ${detail}`);
    }
  } catch (err) {
    deps.logError("repairDocumentTools", err);
    deps.appendLogLine(`Tool repair failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  await deps.delay(200);
  const results = toolCheckResults(await detectDocumentTools());
  deps.setToolChecks(results);
  for (const result of results)
    deps.logTool(result.label, result.status, result.detail);
  if (reinstallResult && reinstallResult.exitCode !== 0) {
    deps.appendLogLine(`Tool repair finished with errors (exit ${reinstallResult.exitCode}) — retry or check logs.`);
  } else if (!reinstallResult) {
    deps.appendLogLine("Tool repair finished with errors — retry or check logs.");
  } else {
    deps.appendLogLine("Tool repair complete.");
  }
}
