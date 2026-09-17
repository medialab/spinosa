import { readStartupPrompt, readWorkspaceMeta } from "@spinosa/core/workspace/meta"
import { resolveWorkspaceDisplayName } from "@spinosa/core/workspace-name"

export const STARTUP_PROMPT_FALLBACK =
  "Run Spinosa startup indexing for this workspace. Follow startup-prompt.md: survey corpus, batch mapper extraction, write maps, validate, and set setup_status to workspace_started."

export type WorkspaceLaunchDecision =
  | { type: "open" }
  | {
      type: "incomplete-import"
      workspacePath: string
      workspaceName: string
    }
  | {
      type: "startup-choice"
      workspacePath: string
      workspaceName: string
      prompt: string
    }

export async function getWorkspaceLaunchDecision(workspacePath: string): Promise<WorkspaceLaunchDecision> {
  const meta = await readWorkspaceMeta(workspacePath).catch(() => undefined)
  if (meta?.setupStatus === "importing") {
    return {
      type: "incomplete-import",
      workspacePath,
      workspaceName: resolveWorkspaceDisplayName(workspacePath, meta?.projectName),
    }
  }
  if (meta?.setupStatus !== "cli_started") return { type: "open" }
  return {
    type: "startup-choice",
    workspacePath,
    workspaceName: resolveWorkspaceDisplayName(workspacePath, meta.projectName),
    prompt: (await readStartupPrompt(workspacePath).catch(() => undefined)) ?? STARTUP_PROMPT_FALLBACK,
  }
}
