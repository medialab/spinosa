import { createWorkspace } from "@spinosa/core/commands/create";
import {
  prepareOnboarding,
  type OnboardingContext,
} from "@spinosa/core/commands/onboard";
import { resolveFrameworkRoot } from "@spinosa/core/framework/discovery";
import { writeWorkspaceStatus } from "@spinosa/core/workspace/meta";

export type WorkspacePreparationDeps = {
  primarySource: string;
  workspaceName: string;
  projectTitle?: string;
  resumeWorkspacePath?: string;
  extensions: string;
  sourcePaths?: readonly string[];
  onProgress: (message: string) => void;
  onRecover: (message: string) => void;
  shouldAbort: () => boolean;
  appendLogLine: (message: string) => void;
};

export type WorkspacePreparation =
  | { kind: "aborted" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      frameworkRoot: string;
      workspacePath: string;
      context: OnboardingContext;
    };

export async function prepareOnboardingWorkspace(
  deps: WorkspacePreparationDeps,
): Promise<WorkspacePreparation> {
  const frameworkRoot = resolveFrameworkRoot();
  if (!frameworkRoot) {
    return {
      kind: "error",
      message: "Framework root not found — cannot create workspace.",
    };
  }

  const result = await createWorkspace({
    corpusPath: deps.primarySource,
    frameworkRoot,
    workspaceName: deps.workspaceName,
    resumeWorkspacePath: deps.resumeWorkspacePath,
    onProgress: deps.onProgress,
    onRecover: deps.onRecover,
    shouldAbort: deps.shouldAbort,
  });
  if (deps.shouldAbort()) return { kind: "aborted" };
  if (!result.success)
    return { kind: "error", message: "Could not create workspace." };

  const statusOk = await writeWorkspaceStatus(
    result.workspacePath,
    "importing",
  );
  if (!statusOk)
    deps.appendLogLine(
      "Warning: could not write workspace status marker (non-fatal).",
    );

  const context = (await prepareOnboarding({
    workspacePath: result.workspacePath,
    frameworkRoot,
    sourcePath: deps.primarySource,
    projectTitle: deps.projectTitle ?? deps.workspaceName,
    flagExtensions: deps.extensions,
    allowEmptySelection: (deps.sourcePaths?.length ?? 1) > 1,
  })) as OnboardingContext;
  if ("success" in context && !context.success)
    return { kind: "error", message: "Could not prepare onboarding." };

  return {
    kind: "ready",
    frameworkRoot,
    workspacePath: result.workspacePath,
    context,
  };
}
