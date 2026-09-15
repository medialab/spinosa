import { Effect, Schema } from "effect"
import { spinosaGate } from "@spinosa/core"
import * as Tool from "./tool"
import DESCRIPTION from "./spinosa-gate.txt"

export const Parameters = Schema.Struct({
  coverage: Schema.Union([
    Schema.Literal("opportunistic"),
    Schema.Literal("sufficient"),
    Schema.Literal("representative"),
    Schema.Literal("exhaustive"),
  ]).annotate({ description: "Coverage contract from the route decision" }),
  sourceCount: Schema.Number.annotate({ description: "Distinct sources evidencing the claim" }),
  strataCovered: Schema.optional(Schema.Number.annotate({ description: "Strata covered (representative)" })),
  strataTotal: Schema.optional(Schema.Number.annotate({ description: "Strata in the denominator (representative)" })),
  partitionsAccounted: Schema.optional(
    Schema.Number.annotate({ description: "Partitions accounted (exhaustive)" }),
  ),
  partitionsTotal: Schema.optional(Schema.Number.annotate({ description: "Partitions in the denominator (exhaustive)" })),
})

export const SpinosaGateTool = Tool.define(
  "spinosa_gate",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "spinosa_gate",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })
          const result = spinosaGate({
            coverage: params.coverage,
            sourceCount: params.sourceCount,
            ...(params.strataCovered !== undefined ? { strataCovered: params.strataCovered } : {}),
            ...(params.strataTotal !== undefined ? { strataTotal: params.strataTotal } : {}),
            ...(params.partitionsAccounted !== undefined ? { partitionsAccounted: params.partitionsAccounted } : {}),
            ...(params.partitionsTotal !== undefined ? { partitionsTotal: params.partitionsTotal } : {}),
          })
          return {
            title: result.pass ? "Gate passed" : "Gate failed",
            output: `<gate pass="${result.pass}">${result.reason}</gate>${
              result.pass ? "" : "\nDo not deliver the claim: gather the missing coverage first."
            }`,
            metadata: {} as Record<string, string>,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
