import { Npm } from "@spinosa/kernel-core/npm"
import { Hash } from "@spinosa/kernel-core/util/hash"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import { iife } from "@/util/iife"
import { isRecord } from "@/util/record"
import { ProviderError } from "./error"
import { wrapSSE } from "@spinosa/kernel-core/sse"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { Info, Model } from "./provider"

function timeoutController(ms: number) {
  const ctl = new AbortController()
  const id = setTimeout(() => ctl.abort(new ProviderError.HeaderTimeoutError(ms)), ms)
  return {
    signal: ctl.signal,
    clear: () => clearTimeout(id),
  }
}

export function googleVertexAnthropicBaseURL(project: string | undefined, location: string | undefined) {
  if (!project) return
  if (location !== "eu" && location !== "us") return
  // Continental multi-regions require Regional Endpoint Platform domains.
  return `https://aiplatform.${location}.rep.googleapis.com/v1/projects/${project}/locations/${location}/publishers/anthropic/models`
}

export type BundledSDK = {
  languageModel(modelId: string): LanguageModelV3
  chat?: (modelId: string) => LanguageModelV3
  responses?: (modelId: string) => LanguageModelV3
  messages?: (modelId: string) => LanguageModelV3
  workflowChat?: (modelId: string, options?: Record<string, unknown>) => LanguageModelV3 & { selectedModelRef?: string }
  agenticChat?: (modelId: string, options?: Record<string, unknown>) => LanguageModelV3
}

export type ProviderFactory = (options: Record<string, unknown>) => unknown

export const BUNDLED_PROVIDERS: Record<string, () => Promise<unknown>> = {
  "@ai-sdk/amazon-bedrock": () => import("@ai-sdk/amazon-bedrock").then((m) => m.createAmazonBedrock),
  "@ai-sdk/amazon-bedrock/mantle": () => import("@ai-sdk/amazon-bedrock/mantle").then((m) => m.createBedrockMantle),
  "@ai-sdk/anthropic": () => import("@ai-sdk/anthropic").then((m) => m.createAnthropic),
  "@ai-sdk/azure": () => import("@ai-sdk/azure").then((m) => m.createAzure),
  "@ai-sdk/google": () => import("@ai-sdk/google").then((m) => m.createGoogleGenerativeAI),
  "@ai-sdk/google-vertex": () => import("@ai-sdk/google-vertex").then((m) => m.createVertex),
  "@ai-sdk/google-vertex/anthropic": () =>
    import("@ai-sdk/google-vertex/anthropic").then((m) => m.createVertexAnthropic),
  "@ai-sdk/openai": () => import("@ai-sdk/openai").then((m) => m.createOpenAI),
  "@ai-sdk/openai-compatible": () => import("@ai-sdk/openai-compatible").then((m) => m.createOpenAICompatible),
  "@openrouter/ai-sdk-provider": () => import("@openrouter/ai-sdk-provider").then((m) => m.createOpenRouter),
  "@ai-sdk/xai": () => import("@ai-sdk/xai").then((m) => m.createXai),
  "@ai-sdk/mistral": () => import("@ai-sdk/mistral").then((m) => m.createMistral),
  "@ai-sdk/groq": () => import("@ai-sdk/groq").then((m) => m.createGroq),
  "@ai-sdk/deepinfra": () => import("@ai-sdk/deepinfra").then((m) => m.createDeepInfra),
  "@ai-sdk/cerebras": () => import("@ai-sdk/cerebras").then((m) => m.createCerebras),
  "@ai-sdk/cohere": () => import("@ai-sdk/cohere").then((m) => m.createCohere),
  "@ai-sdk/gateway": () => import("@ai-sdk/gateway").then((m) => m.createGateway),
  "@ai-sdk/togetherai": () => import("@ai-sdk/togetherai").then((m) => m.createTogetherAI),
  "@ai-sdk/perplexity": () => import("@ai-sdk/perplexity").then((m) => m.createPerplexity),
  "@ai-sdk/vercel": () => import("@ai-sdk/vercel").then((m) => m.createVercel),
  "@ai-sdk/alibaba": () => import("@ai-sdk/alibaba").then((m) => m.createAlibaba),
  "gitlab-ai-provider": () => import("gitlab-ai-provider").then((m) => m.createGitLab),
  "@ai-sdk/github-copilot": () =>
    import("@spinosa/kernel-core/github-copilot/copilot-provider").then((m) => m.createOpenaiCompatible),
  "venice-ai-sdk-provider": () => import("venice-ai-sdk-provider").then((m) => m.createVenice),
}

function isProviderFactory(value: unknown): value is ProviderFactory {
  return typeof value === "function"
}

function isBundledSDK(value: unknown): value is BundledSDK {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false
  return typeof (value as { languageModel?: unknown }).languageModel === "function"
}

export function createBundledSDK(factory: ProviderFactory, model: Model, options: Record<string, unknown>): BundledSDK {
  const loaded = factory({ name: model.providerID, ...options })
  if (!isBundledSDK(loaded)) {
    throw new Error(`Provider ${model.api.npm} did not return a language model factory`)
  }
  return loaded
}

function isLanguageModel(value: unknown): value is LanguageModelV3 {
  return isRecord(value) && typeof value.specificationVersion === "string"
}

export function invokeLanguageModel(sdk: unknown, modelID: string): LanguageModelV3 {
  if (typeof sdk === "function") {
    const model = sdk(modelID)
    if (isLanguageModel(model)) return model
  }
  if (isBundledSDK(sdk)) return sdk.languageModel(modelID)
  throw new Error("Provider SDK cannot create a language model")
}

export function factoryFromModule(module: unknown, packageName: string): ProviderFactory {
  if (isProviderFactory(module)) return module
  if (!isRecord(module)) {
    throw new Error(`Provider package ${packageName} did not export a module`)
  }

  const key = Object.keys(module).find((item) => item.startsWith("create"))
  const factory = key ? module[key] : undefined
  if (!isProviderFactory(factory)) {
    throw new Error(`Provider package ${packageName} has no create factory`)
  }
  return factory
}

export type ProviderOptions = Record<string, unknown>
export type CustomModelLoader = (
  sdk: BundledSDK,
  modelID: string,
  options?: ProviderOptions,
  model?: Model,
) => Promise<LanguageModelV3>
export type CustomVarsLoader = (options: ProviderOptions) => Record<string, string>
export type CustomDiscoverModels = () => Promise<Record<string, Model>>
export type CustomLoader = (provider: Info) => Effect.Effect<{
  autoload: boolean
  getModel?: CustomModelLoader
  vars?: CustomVarsLoader
  options?: ProviderOptions
  discoverModels?: CustomDiscoverModels
}>

export interface ProviderResolverState {
  providers: Record<string, Info>
  varsLoaders: Record<string, CustomVarsLoader>
  sdk: Map<string, BundledSDK>
}

export type ProviderInitErrorFactory = (providerID: Model["providerID"], cause: unknown) => Error

type FetchLike = (input: RequestInfo | URL, init?: BunFetchRequestInit) => Promise<Response>

function isFetchLike(value: unknown): value is FetchLike {
  return typeof value === "function"
}

export async function resolveProviderSDK(
  model: Model,
  s: ProviderResolverState,
  envs: Record<string, string | undefined>,
  createInitError: ProviderInitErrorFactory,
) {
  try {
    const provider = s.providers[model.providerID]
    const options = { ...provider.options }

    if (
      model.providerID === "google-vertex" &&
      model.api.npm === "@ai-sdk/google-vertex/anthropic" &&
      !options.baseURL
    ) {
      const baseURL = googleVertexAnthropicBaseURL(
        typeof options.project === "string" ? options.project : undefined,
        typeof options.location === "string" ? options.location : undefined,
      )
      if (baseURL) options.baseURL = baseURL
    }

    if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
      delete options.fetch
    }

    if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
      options["includeUsage"] = true
    }

    const baseURL = iife(() => {
      let url = typeof options["baseURL"] === "string" && options["baseURL"] !== "" ? options["baseURL"] : model.api.url
      if (!url) return

      const loader = s.varsLoaders[model.providerID]
      if (loader) {
        const vars = loader(options)
        for (const [key, value] of Object.entries(vars)) {
          const field = "${" + key + "}"
          url = url.replaceAll(field, value)
        }
      }

      url = url.replace(/\$\{([^}]+)\}/g, (item, key) => {
        const val = envs[String(key)]
        return val ?? item
      })
      return url
    })

    if (baseURL !== undefined) options["baseURL"] = baseURL
    if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
    if (model.headers)
      options["headers"] = {
        ...options["headers"],
        ...model.headers,
      }

    const key = Hash.fast(
      JSON.stringify({
        providerID: model.providerID,
        npm: model.api.npm,
        options,
      }),
    )
    const existing = s.sdk.get(key)
    if (existing) return existing

    const customFetch = isFetchLike(options["fetch"]) ? options["fetch"] : undefined
    const chunkTimeout = options["chunkTimeout"]
    const headerTimeout = options["headerTimeout"]
    delete options["chunkTimeout"]
    delete options["headerTimeout"]

    options["fetch"] = async (input: RequestInfo | URL, init?: BunFetchRequestInit) => {
      const fetchFn = customFetch ?? fetch
      const opts = init ?? {}
      const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
      const headerTimeoutMs = headerTimeout === false ? undefined : headerTimeout
      const headerTimeoutCtl = typeof headerTimeoutMs === "number" ? timeoutController(headerTimeoutMs) : undefined
      const signals: AbortSignal[] = []

      if (opts.signal) signals.push(opts.signal)
      if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
      if (headerTimeoutCtl) signals.push(headerTimeoutCtl.signal)
      if (options["timeout"] !== undefined && options["timeout"] !== null && options["timeout"] !== false)
        signals.push(AbortSignal.timeout(options["timeout"]))

      const combined = signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
      if (combined) opts.signal = combined

      const res = await fetchFn(input, {
        ...opts,
        // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
        timeout: false,
      }).finally(() => headerTimeoutCtl?.clear())

      if (!chunkAbortCtl) return res
      return wrapSSE(
        res,
        chunkTimeout,
        chunkAbortCtl,
        () => new ProviderError.ResponseStreamError("SSE read timed out"),
      )
    }

    const bundledLoader = BUNDLED_PROVIDERS[model.api.npm]
    if (bundledLoader) {
      const factory = factoryFromModule(await bundledLoader(), model.api.npm)
      const loaded = createBundledSDK(factory, model, options)
      s.sdk.set(key, loaded)
      return loaded
    }

    const installedPath = await (async () => {
      if (model.api.npm.startsWith("file://")) {
        return model.api.npm
      }
      const item = await Npm.add(model.api.npm)
      if (!item.entrypoint) throw new Error(`Package ${model.api.npm} has no import entrypoint`)
      return item.entrypoint
    })()

    // `installedPath` is a local entry path or an existing `file://` URL. Normalize
    // only path inputs so Node on Windows accepts the dynamic import.
    const importSpec = installedPath.startsWith("file://") ? installedPath : pathToFileURL(installedPath).href
    const mod = await import(importSpec)

    const factory = factoryFromModule(mod, model.api.npm)
    const loaded = createBundledSDK(factory, model, options)
    s.sdk.set(key, loaded)
    return loaded
  } catch (e) {
    throw createInitError(model.providerID, e)
  }
}
