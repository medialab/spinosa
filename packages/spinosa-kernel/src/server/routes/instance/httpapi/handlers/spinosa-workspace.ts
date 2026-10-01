import { inspectTemplatePackFreshness } from "@spinosa/core/framework/template-pack-freshness"
import { resolveFrameworkRoot } from "@spinosa/core/framework/discovery"
import {
  isSpinosaWorkspace,
  readStartupPrompt,
  readWorkspaceMeta,
  writeWorkspaceFrameworkVersion,
} from "@spinosa/core/workspace/meta"
import { updateWorkspace } from "@spinosa/core/commands/update"
import { buildStartupChatPrompt, STARTUP_PROMPT_FALLBACK } from "@spinosa/core/commands/startup"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import * as InstanceState from "@/effect/instance-state"
import {
  ApiSpinosaFrameworkUnavailableError,
  ApiSpinosaWorkspaceOperationError,
  ApiSpinosaWorkspaceTargetError,
} from "../groups/spinosa-workspace"

const RESTART_MESSAGE =
  "Workspace template pack updated. Re-run spinosa (or bun run dev) to catch up — protocol and agents are not hot-reloaded."

function workspaceTarget() {
  return Effect.gen(function* () {
    const workspacePath = (yield* InstanceState.context).directory
    if (!isSpinosaWorkspace(workspacePath)) {
      return yield* new ApiSpinosaWorkspaceTargetError({
        name: "SpinosaWorkspaceTargetError",
        data: { message: `Not a Spinosa workspace: ${workspacePath}` },
      })
    }

    return workspacePath
  })
}

function target() {
  return Effect.gen(function* () {
    const workspacePath = yield* workspaceTarget()
    const frameworkRoot = resolveFrameworkRoot()
    if (!frameworkRoot) {
      return yield* new ApiSpinosaFrameworkUnavailableError({
        name: "SpinosaFrameworkUnavailableError",
        data: { message: "Spinosa framework root not found" },
      })
    }

    return { workspacePath, frameworkRoot }
  })
}

async function inspectFreshness(workspacePath: string, frameworkRoot: string) {
  const meta = await readWorkspaceMeta(workspacePath)
  return inspectTemplatePackFreshness({
    workspacePath,
    frameworkRoot,
    workspaceVersion: meta?.frameworkVersion,
  })
}

function operationError(error: unknown) {
  return new ApiSpinosaWorkspaceOperationError({
    name: "SpinosaWorkspaceOperationError",
    data: { message: error instanceof Error ? error.message : String(error) },
  })
}

export const spinosaWorkspaceHandlers = HttpApiBuilder.group(InstanceHttpApi, "spinosaWorkspace", (handlers) => {
  const startupPrompt = Effect.fn("SpinosaWorkspaceHttpApi.startupPrompt")(function* () {
    const workspacePath = yield* workspaceTarget()
    return yield* Effect.tryPromise({
      try: async () => {
        const prompt = await readStartupPrompt(workspacePath).catch(() => undefined)
        return buildStartupChatPrompt(prompt ?? STARTUP_PROMPT_FALLBACK)
      },
      catch: operationError,
    })
  })

  const freshness = Effect.fn("SpinosaWorkspaceHttpApi.freshness")(function* () {
    const { workspacePath, frameworkRoot } = yield* target()
    return yield* Effect.tryPromise({
      try: () => inspectFreshness(workspacePath, frameworkRoot),
      catch: operationError,
    })
  })

  const update = Effect.fn("SpinosaWorkspaceHttpApi.update")(function* () {
    const { workspacePath, frameworkRoot } = yield* target()
    return yield* Effect.tryPromise({
      try: async () => {
        const before = await inspectFreshness(workspacePath, frameworkRoot)
        const result = await updateWorkspace({
          workspacePath,
          frameworkRoot,
          force: true,
        })
        if (result.success) await writeWorkspaceFrameworkVersion(workspacePath, before.bundledVersion ?? "dev")

        const after = await inspectFreshness(workspacePath, frameworkRoot)
        const restartRequired = result.success && result.changes && !after.refreshRecommended
        return {
          before,
          update: result,
          freshness: after,
          restartRequired,
          ...(restartRequired ? { restartMessage: RESTART_MESSAGE } : {}),
        }
      },
      catch: operationError,
    })
  })

  return Effect.succeed(
    handlers.handle("startupPrompt", startupPrompt).handle("freshness", freshness).handle("update", update),
  )
})
