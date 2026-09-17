import os from "os"
import { InstallationVersion } from "../../installation/version"
import { Effect, Option, Schema } from "effect"
import { define } from "../define"

type GatewayMetadata = Record<string, string | number | boolean | null | bigint>
type GatewayOptions = {
  readonly cacheKey?: string
  readonly cacheTtl?: number
  readonly skipCache?: boolean
  readonly metadata?: GatewayMetadata
  readonly collectLog?: boolean
  readonly headers?: Record<string, string>
}
type GatewayAPISettings = {
  readonly gateway: string
  readonly accountId: string
  readonly apiKey?: string
  readonly options?: GatewayOptions
}

export const CloudflareAIGatewayPlugin = define({
  id: "cloudflare-ai-gateway",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "ai-gateway-provider") return
        if (evt.options.baseURL) return

        const config = gatewayConfig(evt.options)
        if (!config) return
        const metadata = gatewayMetadata(evt.options)
        const { createAiGateway } = yield* Effect.promise(() => import("ai-gateway-provider")).pipe(Effect.orDie)
        const { createUnified } = yield* Effect.promise(() => import("ai-gateway-provider/providers/unified")).pipe(
          Effect.orDie,
        )
        const gateway = createAiGateway({
          accountId: config.accountId,
          gateway: config.gatewayId,
          apiKey: config.apiKey,
          options: gatewayOptions(evt.options, metadata),
        } satisfies GatewayAPISettings)
        const unified = createUnified({ apiKey: config.apiKey })
        evt.sdk = {
          languageModel(modelID: string) {
            return gateway(unified(modelID))
          },
        }
      }),
    )
  }),
})

type GatewayConfig = {
  accountId: string
  gatewayId: string
  apiKey: string
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

function gatewayConfig(options: Record<string, unknown>): GatewayConfig | undefined {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? stringOption(options, "accountId")
  // Credential projection copies key metadata into options. The prompt stores the
  // gateway as gatewayId, while older config examples may use gateway.
  const gatewayId =
    process.env.CLOUDFLARE_GATEWAY_ID ?? stringOption(options, "gatewayId") ?? stringOption(options, "gateway")
  const apiKey = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_AIG_TOKEN ?? stringOption(options, "apiKey")
  if (!accountId || !gatewayId || !apiKey) return undefined

  return { accountId, gatewayId, apiKey }
}

function gatewayMetadata(options: Record<string, unknown>): GatewayMetadata | undefined {
  // Preserve the legacy cf-aig-metadata header escape hatch for gateway logging
  // metadata, but prefer the typed metadata option when present.
  if (isGatewayMetadata(options.metadata)) return options.metadata
  const raw = stringRecord(options.headers)["cf-aig-metadata"]
  const parsed = raw ? Option.getOrUndefined(decodeJson(raw)) : undefined
  return isGatewayMetadata(parsed) ? parsed : undefined
}

function gatewayOptions(options: Record<string, unknown>, metadata: GatewayMetadata | undefined): GatewayOptions {
  return {
    metadata,
    cacheTtl: numberOption(options, "cacheTtl"),
    cacheKey: stringOption(options, "cacheKey"),
    skipCache: booleanOption(options, "skipCache"),
    collectLog: booleanOption(options, "collectLog"),
    headers: {
      "User-Agent": `spinosa/${InstallationVersion} cloudflare-ai-gateway (${os.platform()} ${os.release()}; ${os.arch()})`,
    },
  }
}

function stringOption(options: Record<string, unknown>, key: string) {
  return typeof options[key] === "string" ? options[key] : undefined
}

function numberOption(options: Record<string, unknown>, key: string) {
  return typeof options[key] === "number" ? options[key] : undefined
}

function booleanOption(options: Record<string, unknown>, key: string) {
  return typeof options[key] === "boolean" ? options[key] : undefined
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {}
  const entries = Object.entries(value)
  return entries.every(([key, item]) => typeof key === "string" && typeof item === "string")
    ? Object.fromEntries(entries)
    : {}
}

function isGatewayMetadata(value: unknown): value is GatewayMetadata {
  if (typeof value !== "object" || value === null) return false
  return Object.values(value).every(
    (item) =>
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      typeof item === "bigint",
  )
}
