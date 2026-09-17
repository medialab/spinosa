import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { ModelV2Info } from "@spinosa/sdk/v2/types"
import type { Hooks } from "./registration.js"

export type AISDKHooks = Hooks<{
  sdk: {
    readonly model: ModelV2Info
    readonly package: string
  readonly options: Record<string, unknown>
  sdk?: unknown
  }
  language: {
    readonly model: ModelV2Info
  readonly sdk: unknown
  readonly options: Record<string, unknown>
    language?: LanguageModelV3
  }
}>
