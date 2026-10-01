import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import DESCRIPTION from "./web.txt"
import { executeWebFetch, Parameters as FetchParameters } from "./webfetch"
import {
  executeWebSearch,
  Parameters as SearchParameters,
  selectWebSearchProvider,
  webSearchEnabled,
  webSearchProviderLabel,
} from "./websearch"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@spinosa/kernel-core/provider"

export const Parameters = Schema.Union([SearchParameters, FetchParameters]).annotate({
  description: "Pass exactly one of query (search) or url (fetch).",
})

export type Parameters = Schema.Schema.Type<typeof Parameters>

function isFetch(params: Parameters): params is Schema.Schema.Type<typeof FetchParameters> {
  return "url" in params && typeof params.url === "string"
}

function isSearch(params: Parameters): params is Schema.Schema.Type<typeof SearchParameters> {
  return "query" in params && typeof params.query === "string"
}

function providerIDFromExtra(extra: Tool.Context["extra"]): ProviderV2.ID | undefined {
  const model = extra?.model
  if (!model || typeof model !== "object") return undefined
  if ("providerID" in model && typeof model.providerID === "string") {
    return model.providerID as ProviderV2.ID
  }
  return undefined
}

export const WebTool = Tool.define(
  "web",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Parameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const fetchMode = isFetch(params)
          const searchMode = isSearch(params)
          if (fetchMode === searchMode) {
            return {
              title: "Invalid web args",
              output: "Provide exactly one of `query` (search) or `url` (fetch).",
              metadata: {},
            }
          }

          if (fetchMode) {
            return yield* executeWebFetch(http, params, ctx, "web")
          }

          const providerID = providerIDFromExtra(ctx.extra)
          if (
            providerID !== undefined &&
            !webSearchEnabled(providerID, {
              exa: flags.enableExa,
              parallel: flags.enableParallel,
            })
          ) {
            return {
              title: "Web search unavailable",
              output:
                "Web search is not enabled for this session. Enable Exa or Parallel, or use `url` to fetch a page.",
              metadata: {},
            }
          }
          if (providerID === undefined && !flags.enableExa && !flags.enableParallel) {
            return {
              title: "Web search unavailable",
              output:
                "Web search is not enabled for this session. Enable Exa or Parallel, or use `url` to fetch a page.",
              metadata: {},
            }
          }

          const provider = selectWebSearchProvider(ctx.sessionID, {
            exa: flags.enableExa,
            parallel: flags.enableParallel,
          })
          yield* ctx.metadata({
            title: `${webSearchProviderLabel(provider)} "${params.query}"`,
            metadata: { provider, mode: "search" },
          })
          return yield* executeWebSearch(http, params, ctx, "web", provider)
        }).pipe(Effect.orDie),
    }
  }),
)
