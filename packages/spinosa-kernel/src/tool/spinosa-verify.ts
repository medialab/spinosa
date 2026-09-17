import { Effect, Schema } from "effect"
import { spinosaVerify } from "@spinosa/core"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./spinosa-verify.txt"

export const Parameters = Schema.Struct({
  relativePath: Schema.String.annotate({ description: "Artifact path relative to the workspace root" }),
  validator: Schema.Union([
    Schema.Literal("goal"),
    Schema.Literal("evidence_packet"),
    Schema.Literal("analysis"),
    Schema.Literal("serendipity"),
    Schema.Literal("report"),
    Schema.Literal("verification"),
    Schema.Literal("evaluation"),
    Schema.Literal("extraction"),
    Schema.Literal("map"),
    Schema.Literal("coverage"),
    Schema.Literal("cleanup"),
  ]).annotate({ description: "Artifact kind to check against" }),
  runID: Schema.optional(Schema.String.annotate({ description: "Run ID for linkage checks" })),
  workspacePath: Schema.optional(
    Schema.String.annotate({ description: "Workspace root override (defaults to session directory)" }),
  ),
})

export const SpinosaVerifyTool = Tool.define(
  "spinosa_verify",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "spinosa_verify",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })
          const instance = yield* InstanceState.context
          const workspacePath = params.workspacePath ?? instance.directory
          const checked = yield* Effect.promise(() =>
            spinosaVerify({
              workspacePath,
              relativePath: params.relativePath,
              validator: params.validator,
              ...(params.runID ? { runID: params.runID } : {}),
            }),
          )
          if (!checked.ok) {
            return {
              title: "Verification failed",
              output: `<verification ok="false" retryable="${checked.retryable}">${checked.error}</verification>\nFix the artifact and re-verify before delivery.`,
              metadata: {} as Record<string, string>,
            }
          }
          return {
            title: `Verified (${checked.status} → ${checked.action})`,
            output: `<verification ok="true" status="${checked.status}" action="${checked.action}">${
              checked.action === "complete"
                ? "Mechanical checks pass. Quote-level truth against original sources remains your judgment."
                : checked.action === "retry"
                  ? "Verification is partial: address the gaps and re-verify."
                  : "Verification blocks delivery: do not deliver this artifact."
            }</verification>`,
            metadata: {} as Record<string, string>,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
