import os from "os"
import { InstallationVersion } from "../../installation/version"
import { Effect } from "effect"
import { define } from "../define"
import { ProviderV2 } from "../../provider"
import type { LanguageModelV3 } from "@ai-sdk/provider"

const providerID = ProviderV2.ID.make("cloudflare-workers-ai")

export const CloudflareWorkersAIPlugin = define({
  id: "cloudflare-workers-ai",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const item = evt.provider.get(providerID)
        if (!item) return
        evt.provider.update(item.provider.id, (provider) => {
          if (provider.api.type !== "aisdk") return
          if (provider.api.url) return
          const accountId = resolveAccountId(provider.request.body)
          if (accountId) provider.api.url = workersEndpoint(accountId)
        })
      }),
    )
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        if (evt.package !== "@ai-sdk/openai-compatible") return

      const accountId = resolveAccountId(evt.options)
      const configuredBaseURL = stringOption(evt.options, "baseURL")
      const baseURL = configuredBaseURL ?? (accountId ? workersEndpoint(accountId) : undefined)
      if (!hasWorkersEndpoint(evt.model.api) && !baseURL) return
      const mod = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
      evt.sdk = mod.createOpenAICompatible(
        sdkOptions({
          ...evt.options,
          baseURL,
        }),
      )
      }),
    )
    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        evt.language = (evt.sdk as { languageModel: (modelID: string) => LanguageModelV3 }).languageModel(evt.model.api.id)
      }),
    )
  }),
})

function resolveAccountId(options: Record<string, unknown>) {
  return process.env.CLOUDFLARE_ACCOUNT_ID ?? stringOption(options, "accountId")
}

function workersEndpoint(accountId: string) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
}

function hasWorkersEndpoint(api: ProviderV2.Api) {
  return api.type === "aisdk" && Boolean(api.url)
}

type SDKOptions = Record<string, unknown> & {
  readonly baseURL?: string
  readonly apiKey?: unknown
  readonly headers?: Record<string, string>
}

function sdkOptions(options: SDKOptions) {
  const baseURL = expandAccountId(options.baseURL)
  if (!baseURL) throw new Error("Cloudflare Workers AI baseURL is required")
  return {
    ...options,
    baseURL,
    apiKey: process.env.CLOUDFLARE_API_KEY ?? stringOption(options, "apiKey"),
    headers: {
      "User-Agent": `spinosa/${InstallationVersion} cloudflare-workers-ai (${os.platform()} ${os.release()}; ${os.arch()})`,
      ...options.headers,
    },
    name: providerID,
  }
}

function expandAccountId(baseURL: unknown): string | undefined {
  if (typeof baseURL !== "string") return undefined
  return baseURL.replaceAll("${CLOUDFLARE_ACCOUNT_ID}", process.env.CLOUDFLARE_ACCOUNT_ID ?? "${CLOUDFLARE_ACCOUNT_ID}")
}

function stringOption(options: Record<string, unknown>, key: string) {
  return typeof options[key] === "string" ? options[key] : undefined
}
