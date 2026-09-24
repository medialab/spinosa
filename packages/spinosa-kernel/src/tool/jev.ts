import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Auth } from "@/auth"
import * as Tool from "./tool"
import DESCRIPTION from "./jev.txt"

export const MAX_PASSAGES = 32
export const MAX_SNIPPET = 800
export const DEFAULT_MODEL = "jev-1.13.0"
export const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
export const AUTH_ID = "typesafe"
export const AUTH_IDS = [AUTH_ID, "jev"] as const

export const SCORE_CRITERIA = [
  "unrelated to the query — skip this passage",
  "mentions the topic but is not usable evidence — maybe read later",
  "usable evidence that could answer the query — read this next",
] as const

const PassageInput = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Source path from grep/glob. Do not invent a path.",
  }),
  text: Schema.String.annotate({
    description: "The passage to screen: a grep hit plus a little context, not a whole file.",
  }),
})

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "The researcher question these passages might answer.",
  }),
  passages: Schema.Array(PassageInput).annotate({
    description: "Grep hits or map snippets to score. At most 32. Truncated to 800 characters each.",
  }),
})

export type PassageInput = Schema.Schema.Type<typeof PassageInput>
export type JevParameters = Schema.Schema.Type<typeof Parameters>

export type NormalizedPassage = {
  id: string
  path: string
  text: string
}

export type ScreenDecision = "read" | "maybe" | "skip"

export type RankedPassage = NormalizedPassage & {
  score: number
  confidence: number
  decision: ScreenDecision
}

export function envJevApiKey() {
  return process.env.TYPESAFE_API_KEY?.trim() || process.env.JEV_API_KEY?.trim() || undefined
}

export function apiKeyFromAuth(info: Auth.Info | undefined) {
  if (!info || info.type !== "api") return undefined
  const key = info.key.trim()
  return key || undefined
}

export const resolveJevApiKey = (get: Auth.Interface["get"]) =>
  Effect.gen(function* () {
    const fromEnv = envJevApiKey()
    if (fromEnv) return fromEnv
    for (const id of AUTH_IDS) {
      const stored = yield* get(id).pipe(Effect.orElseSucceed(() => undefined))
      const key = apiKeyFromAuth(stored)
      if (key) return key
    }
  })

export function jevEndpoint() {
  return process.env.TYPESAFE_API_URL || DEFAULT_ENDPOINT
}

export function jevModel() {
  return process.env.SPINOSA_JEV_MODEL || DEFAULT_MODEL
}

export function normalizePassages(raw: readonly PassageInput[]): NormalizedPassage[] {
  const out: NormalizedPassage[] = []
  for (const item of raw) {
    if (out.length >= MAX_PASSAGES) break
    const text = item.text.trim().slice(0, MAX_SNIPPET)
    if (!text) continue
    out.push({
      id: `p${out.length}`,
      path: item.path?.trim() || "(no path)",
      text,
    })
  }
  return out
}

export function buildJevRequest(query: string, passages: readonly NormalizedPassage[], model = jevModel()) {
  const questions: Record<string, { type: "score"; instructions: string; criteria: readonly string[] }> = {}
  for (const passage of passages) {
    questions[passage.id] = {
      type: "score",
      instructions: [
        `Researcher query: ${query}`,
        `Source: ${passage.path}`,
        "Passage:",
        passage.text,
        "Score how usable this passage is as evidence for the query. Read only if a researcher should open this source next.",
      ].join("\n"),
      criteria: SCORE_CRITERIA,
    }
  }
  return {
    model,
    state: {
      query,
      passages: passages.map((passage) => ({
        id: passage.id,
        path: passage.path,
        text: passage.text,
      })),
    },
    questions,
  }
}

export function decisionForScore(score: number): ScreenDecision {
  if (score >= 1.5) return "read"
  if (score >= 0.75) return "maybe"
  return "skip"
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function rankAnswers(
  passages: readonly NormalizedPassage[],
  answers: Record<string, unknown>,
): RankedPassage[] {
  const ranked = passages.map((passage) => {
    const answer = answers[passage.id]
    const record = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {}
    const score = asNumber(record.score) ?? 0
    const confidence = asNumber(record.confidence) ?? 0
    return { ...passage, score, confidence, decision: decisionForScore(score) }
  })
  ranked.sort((a, b) => b.score - a.score || b.confidence - a.confidence)
  return ranked
}

type JevMetadata = {
  count: number
  read?: number
  configured?: boolean
  model?: string
}

function jevResult(title: string, output: string, metadata: JevMetadata) {
  return { title, output, metadata }
}

export function formatScreenOutput(query: string, ranked: readonly RankedPassage[]) {
  const counts = { read: 0, maybe: 0, skip: 0 }
  for (const item of ranked) counts[item.decision]++
  const lines = [
    `query: ${query}`,
    `counts: read=${counts.read} maybe=${counts.maybe} skip=${counts.skip}`,
    "Read the `read` band next. Skip the rest unless you are short on sources.",
    "",
  ]
  for (const item of ranked) {
    const label = item.decision.toUpperCase().padEnd(5)
    lines.push(`${label}  ${item.score.toFixed(2)}  ${item.path}`)
    lines.push(`      ${item.text.replace(/\s+/g, " ").slice(0, 160)}`)
  }
  return lines.join("\n")
}

const DecideResponse = Schema.Struct({
  model: Schema.optional(Schema.String),
  answers: Schema.Record(Schema.String, Schema.Unknown),
  error: Schema.optional(Schema.String),
})

export const JevTool = Tool.define(
  "jev",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const auth = yield* Auth.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: JevParameters, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<JevMetadata>> =>
        Effect.gen(function* () {
          const passages = normalizePassages(params.passages)
          if (passages.length === 0) {
            return jevResult("Jev: nothing to screen", "No non-empty passages. Pass grep hits as { path, text }.", {
              count: 0,
            })
          }

          yield* ctx.metadata({
            title: `Jev screen ${passages.length} passages`,
            metadata: { count: passages.length, query: params.query },
          })

          yield* ctx.ask({
            permission: "jev",
            patterns: ["*"],
            always: ["*"],
            metadata: {
              query: params.query,
              count: passages.length,
              paths: passages.map((passage) => passage.path),
            },
          })

          const key = yield* resolveJevApiKey(auth.get)
          if (!key) {
            return jevResult(
              "Jev: missing API key",
              "Store a TypeSafe key with `spinosa auth login --provider typesafe`. TYPESAFE_API_KEY still works as an override. The key is not stored in the workspace.",
              { count: passages.length, configured: false },
            )
          }

          const payload = buildJevRequest(params.query, passages)
          const response = yield* HttpClientRequest.post(jevEndpoint()).pipe(
            HttpClientRequest.setHeaders({
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            }),
            HttpClientRequest.bodyJson(payload),
            Effect.flatMap((request) => HttpClient.filterStatusOk(http).execute(request)),
            Effect.timeoutOrElse({
              duration: "20 seconds",
              orElse: () => Effect.die(new Error("Jev request timed out")),
            }),
          )
          const body = yield* response.json
          const parsed = Schema.decodeUnknownSync(DecideResponse)(body)
          if (parsed.error) {
            return jevResult("Jev: request failed", parsed.error, { count: passages.length })
          }

          const ranked = rankAnswers(passages, parsed.answers)
          const read = ranked.filter((item) => item.decision === "read").length
          return jevResult(`Jev: ${read} read / ${ranked.length} screened`, formatScreenOutput(params.query, ranked), {
            count: ranked.length,
            read,
            model: parsed.model ?? payload.model,
          })
        }).pipe(Effect.orDie),
    }
  }),
)
