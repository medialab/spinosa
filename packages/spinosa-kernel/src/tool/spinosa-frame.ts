import { Effect, Schema } from "effect"
import { ROUTE_STRATEGIES, spinosaFrame, type OrchestratedDecision } from "@spinosa/core"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./spinosa-frame.txt"

const DecisionSchema = Schema.Struct({
  mode: Schema.Literal("orchestrated"),
  operation: Schema.Union([
    Schema.Literal("research"),
    Schema.Literal("corpus"),
    Schema.Literal("maintenance"),
    Schema.Literal("meta"),
  ]),
  strategy: Schema.Literals(ROUTE_STRATEGIES).annotate({
    description: "Short plan name from spinosa_route. One token, not a sentence or a -> chain.",
  }),
  scope: Schema.Union([Schema.Literal("local"), Schema.Literal("subset"), Schema.Literal("corpus_wide")]),
  coverage: Schema.Union([
    Schema.Literal("opportunistic"),
    Schema.Literal("sufficient"),
    Schema.Literal("representative"),
    Schema.Literal("exhaustive"),
  ]),
  outputs: Schema.Array(
    Schema.Union([
      Schema.Literal("chat"),
      Schema.Literal("report"),
      Schema.Literal("table"),
      Schema.Literal("visualization"),
      Schema.Literal("map"),
    ]),
  ),
  mutation: Schema.Union([
    Schema.Literal("none"),
    Schema.Literal("propose"),
    Schema.Literal("allowed"),
    Schema.Literal("requires_approval"),
  ]),
  verification: Schema.Union([Schema.Literal("none"), Schema.Literal("normal"), Schema.Literal("strict")]),
  evaluation: Schema.Union([
    Schema.Literal("always"),
    Schema.Literal("on_failure"),
    Schema.Literal("sampled"),
    Schema.Literal("never"),
  ]),
  reason: Schema.String,
  confidence: Schema.Number,
})

export const Parameters = Schema.Struct({
  cleanedPrompt: Schema.String.annotate({ description: "The request, with extra preamble stripped" }),
  decision: DecisionSchema.annotate({ description: "The JSON spinosa_route returned. Pass it through unchanged." }),
  workspacePath: Schema.optional(
    Schema.String.annotate({ description: "Workspace root override (defaults to session directory)" }),
  ),
})

export const SpinosaFrameTool = Tool.define(
  "spinosa_frame",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "spinosa_frame",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })
          const instance = yield* InstanceState.context
          const workspacePath = params.workspacePath ?? instance.directory
          const framed = yield* Effect.promise(() =>
            spinosaFrame({
              workspacePath,
              cleanedPrompt: params.cleanedPrompt,
              decision: params.decision as OrchestratedDecision,
            }).catch((error) => ({
              ok: false as const,
              reason: error instanceof Error ? error.message : String(error),
            })),
          )
          if (!framed.ok) {
            return {
              title: "Couldn't start this run",
              output: framed.reason,
              metadata: {} as Record<string, string>,
            }
          }
          return {
            title: `Started: ${framed.planLabel}`,
            output: [
              `Started a research run (${framed.planLabel}).`,
              `Goal file: ${framed.goalPath}`,
              `Run id: ${framed.runID}`,
              "Dispatch subagents with this goal file. Later tools need the run id, not a workflow id.",
            ].join("\n"),
            metadata: { runID: framed.runID, goalPath: framed.goalPath } as Record<string, string>,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
