import { Effect, Schema } from "effect"
import { formatRouteTitle, isSpinosaWorkspace, readWorkspaceMarker, spinosaRoute } from "@spinosa/core"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./spinosa-route.txt"

export const Parameters = Schema.Struct({
  text: Schema.String.annotate({ description: "The user request to classify" }),
  setupStatus: Schema.Union([
    Schema.Literal("not_started"),
    Schema.Literal("importing"),
    Schema.Literal("cli_started"),
    Schema.Literal("workspace_started"),
    Schema.Literal("unknown"),
  ]).annotate({ description: "Workspace setup status from .spinosa/workspace" }),
  fileCount: Schema.optional(Schema.Number.annotate({ description: "Attached file count" })),
  fileNames: Schema.optional(Schema.Array(Schema.String).annotate({ description: "Attached file names" })),
  explicitAgent: Schema.optional(Schema.String.annotate({ description: "User-selected agent, if any" })),
  command: Schema.optional(Schema.String.annotate({ description: "Slash command name without leading slash, if any" })),
})

type SetupStatus = Schema.Schema.Type<typeof Parameters>["setupStatus"]

export const SpinosaRouteTool = Tool.define(
  "spinosa_route",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "spinosa_route",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })
          const instance = yield* InstanceState.context
          const marker = yield* Effect.promise(() =>
            readWorkspaceMarker(instance.directory).catch(() => ({
              setupStatus: "unknown" as SetupStatus,
            })),
          )
          const result = spinosaRoute({
            text: params.text,
            isSpinosa: isSpinosaWorkspace(instance.directory),
            setupStatus: (marker.setupStatus ?? params.setupStatus) as SetupStatus,
            ...(params.fileCount !== undefined ? { fileCount: params.fileCount } : {}),
            ...(params.fileNames ? { fileNames: params.fileNames } : {}),
            ...(params.explicitAgent ? { explicitAgent: params.explicitAgent } : {}),
            ...(params.command ? { command: params.command } : {}),
          })
          return {
            title: formatRouteTitle(result.decision),
            output: [
              `<route_decision via="${result.via}" provisional="${result.provisional}">`,
              JSON.stringify(result.decision, null, 2),
              "</route_decision>",
              ...(result.provisional
                ? [
                    "Deterministic rules abstained: apply your own judgment and override this fallback when the request clearly needs more or less.",
                  ]
                : []),
            ].join("\n"),
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
