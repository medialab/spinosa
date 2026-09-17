import { Effect, Schema } from "effect"
import { spinosaMintPaths, type MintableArtifactKind } from "@spinosa/core"
import * as Tool from "./tool"
import DESCRIPTION from "./spinosa-mint-paths.txt"

const KindSchema = Schema.Union([
  Schema.Literal("goal"),
  Schema.Literal("evidence"),
  Schema.Literal("evidence_appendix"),
  Schema.Literal("extraction"),
  Schema.Literal("analysis"),
  Schema.Literal("serendipity"),
  Schema.Literal("report"),
  Schema.Literal("verification"),
  Schema.Literal("evaluation"),
  Schema.Literal("coverage"),
  Schema.Literal("map"),
  Schema.Literal("cleanup"),
])

export const Parameters = Schema.Struct({
  runID: Schema.String.annotate({ description: "Run ID from spinosa_frame (YYYYMMDD-short_hash)" }),
  kinds: Schema.Array(KindSchema).annotate({ description: "Artifact kinds to mint paths for" }),
  branch: Schema.optional(
    Schema.String.annotate({ description: "Descriptive branch/batch slug for evidence fan-out and extraction" }),
  ),
  reportNumber: Schema.optional(Schema.String.annotate({ description: "Next free NN for writer reports" })),
  reportSlug: Schema.optional(Schema.String.annotate({ description: "Kebab-case topic slug for writer reports" })),
})

export const SpinosaMintPathsTool = Tool.define(
  "spinosa_mint_paths",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "spinosa_mint_paths",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })
          const result = spinosaMintPaths({
            runID: params.runID,
            kinds: [...params.kinds] as MintableArtifactKind[],
            ...(params.branch ? { branch: params.branch } : {}),
            ...(params.reportNumber ? { reportNumber: params.reportNumber } : {}),
            ...(params.reportSlug ? { reportSlug: params.reportSlug } : {}),
          })
          if (!result.ok) {
            return {
              title: "Minting refused",
              output: `spinosa_mint_paths refused: ${result.reason}`,
              metadata: {} as Record<string, string>,
            }
          }
          return {
            title: `Minted ${Object.keys(result.paths).length} paths`,
            output: [
              "<artifact_paths>",
              ...Object.entries(result.paths).map(([kind, p]) => `${kind}: ${p}`),
              "</artifact_paths>",
              "Write exactly these paths. Never invent parallel filenames.",
            ].join("\n"),
            metadata: {} as Record<string, string>,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
