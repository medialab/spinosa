import os from "os"
import { InstallationVersion } from "../../installation/version"
import { Effect } from "effect"
import { define } from "../define"
import { ProviderV2 } from "../../provider"
import type { GitLabProvider } from "gitlab-ai-provider"

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {}
  const entries = Object.entries(value)
  return entries.every(([, item]) => typeof item === "string") ? Object.fromEntries(entries) : {}
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (typeof value !== "object" || value === null) return {}
  const entries = Object.entries(value)
  return entries.every(([, item]) => typeof item === "boolean") ? Object.fromEntries(entries) : {}
}

export const GitLabPlugin = define({
  id: "gitlab",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "gitlab-ai-provider") return
        const mod = yield* Effect.promise(() => import("gitlab-ai-provider"))
        const options = evt.options as Record<string, unknown>
        evt.sdk = mod.createGitLab({
          ...evt.options,
          instanceUrl:
            typeof evt.options.instanceUrl === "string"
              ? evt.options.instanceUrl
              : (process.env.GITLAB_INSTANCE_URL ?? "https://gitlab.com"),
          apiKey: typeof evt.options.apiKey === "string" ? evt.options.apiKey : process.env.GITLAB_TOKEN,
          aiGatewayHeaders: {
            "User-Agent": `spinosa/${InstallationVersion} gitlab-ai-provider/${mod.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
            "anthropic-beta": "context-1m-2025-08-07",
            ...stringRecord(options.aiGatewayHeaders),
          },
          featureFlags: {
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: true,
            ...booleanRecord(options.featureFlags),
          },
        })
      }),
    )
    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.gitlab) return
        const sdk = evt.sdk as GitLabProvider
        const options = evt.options as Record<string, unknown>
        const featureFlags =
          booleanRecord(options.featureFlags)
        if (evt.model.api.id.startsWith("duo-workflow-")) {
          const gitlab = yield* Effect.promise(() => import("gitlab-ai-provider")).pipe(Effect.orDie)
          const workflowRef =
            typeof evt.model.request.body.workflowRef === "string" ? evt.model.request.body.workflowRef : undefined
          const workflowDefinition =
            typeof evt.model.request.body.workflowDefinition === "string"
              ? evt.model.request.body.workflowDefinition
              : undefined
          const language = sdk.workflowChat(
            gitlab.isWorkflowModel(evt.model.api.id) ? evt.model.api.id : "duo-workflow",
            {
              featureFlags,
              workflowDefinition,
            },
          )
          if (workflowRef) language.selectedModelRef = workflowRef
          evt.language = language
          return
        }
        evt.language = sdk.agenticChat(evt.model.api.id, {
          aiGatewayHeaders: stringRecord(options.aiGatewayHeaders),
          featureFlags,
        })
      }),
    )
  }),
})
