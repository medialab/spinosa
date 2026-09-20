import { Effect, Schema } from "effect"
import { spinosaMap } from "@spinosa/core"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./spinosa-map.txt"

const Passage = Schema.Struct({
  quote: Schema.String.annotate({ description: "Short grounded quote or close paraphrase" }),
  path: Schema.optional(Schema.String.annotate({ description: "raw/ path for this quote" })),
  lines: Schema.optional(Schema.String.annotate({ description: "Line range such as L12-L15" })),
})

const Packet = Schema.Struct({
  filename: Schema.String.annotate({ description: "File basename" }),
  path: Schema.String.annotate({ description: "raw/ relative path" }),
  sourceType: Schema.optional(Schema.String.annotate({ description: "Inferred source type" })),
  language: Schema.optional(Schema.String.annotate({ description: "en or fr or the file language" })),
  summary: Schema.optional(Schema.String.annotate({ description: "3-5 sentence content-grounded summary" })),
  passages: Schema.optional(Schema.Array(Passage).annotate({ description: "2-5 key passages" })),
  concepts: Schema.optional(Schema.Array(Schema.String).annotate({ description: "Dictionary canonical terms" })),
  tags: Schema.optional(Schema.Array(Schema.String).annotate({ description: "Obsidian tags including #concept/ #type/ #group/" })),
  connections: Schema.optional(
    Schema.Array(Schema.String).annotate({ description: "Related raw/ paths or none" }),
  ),
  status: Schema.optional(
    Schema.Union([Schema.Literal("extracted"), Schema.Literal("unreadable")]).annotate({
      description: "extracted (default) or unreadable",
    }),
  ),
})

export const Parameters = Schema.Struct({
  action: Schema.Union([
    Schema.Literal("begin"),
    Schema.Literal("write_extraction"),
    Schema.Literal("write_map"),
    Schema.Literal("check"),
    Schema.Literal("cover"),
  ]).annotate({
    description: "begin scaffold, write_extraction, write_map, check, or cover",
  }),
  batchId: Schema.optional(
    Schema.String.annotate({ description: "Descriptive kebab batch slug for extraction actions" }),
  ),
  files: Schema.optional(Schema.Array(Schema.String).annotate({ description: "raw/ paths for begin" })),
  packets: Schema.optional(Schema.Array(Packet).annotate({ description: "Structured packets for write_extraction" })),
  mapPath: Schema.optional(Schema.String.annotate({ description: "maps/... path for write_map" })),
  mapKind: Schema.optional(
    Schema.Union([Schema.Literal("hub"), Schema.Literal("group"), Schema.Literal("theme")]).annotate({
      description: "Map kind; inferred from path when omitted",
    }),
  ),
  title: Schema.optional(Schema.String.annotate({ description: "Map H1 title" })),
  tags: Schema.optional(Schema.Array(Schema.String).annotate({ description: "Obsidian tags placed under the H1" })),
  body: Schema.optional(Schema.String.annotate({ description: "Map prose with wikilinks. No tables." })),
  links: Schema.optional(
    Schema.Array(Schema.String).annotate({ description: "Wikilink targets that must appear in the map" }),
  ),
  mode: Schema.optional(
    Schema.Union([Schema.Literal("create"), Schema.Literal("replace"), Schema.Literal("enrich")]).annotate({
      description: "write_map behavior when the file exists (default replace)",
    }),
  ),
  relativePath: Schema.optional(Schema.String.annotate({ description: "Existing extraction or map path for check/cover" })),
  workspacePath: Schema.optional(
    Schema.String.annotate({ description: "Workspace root override (defaults to session directory)" }),
  ),
})

export const SpinosaMapTool = Tool.define(
  "spinosa_map",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "spinosa_map",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })
          const instance = yield* InstanceState.context
          const result = yield* Effect.promise(() =>
            spinosaMap({
              action: params.action,
              workspacePath: params.workspacePath ?? instance.directory,
              ...(params.batchId ? { batchId: params.batchId } : {}),
              ...(params.files ? { files: params.files } : {}),
              ...(params.packets ? { packets: params.packets } : {}),
              ...(params.mapPath ? { mapPath: params.mapPath } : {}),
              ...(params.mapKind ? { mapKind: params.mapKind } : {}),
              ...(params.title ? { title: params.title } : {}),
              ...(params.tags ? { tags: params.tags } : {}),
              ...(params.body ? { body: params.body } : {}),
              ...(params.links ? { links: params.links } : {}),
              ...(params.mode ? { mode: params.mode } : {}),
              ...(params.relativePath ? { relativePath: params.relativePath } : {}),
            }),
          )
          if (!result.ok) {
            return {
              title: "Mapping refused",
              output: `spinosa_map refused: ${result.reason}`,
              metadata: {} as Record<string, string>,
            }
          }
          return {
            title: result.title,
            output: result.output,
            metadata: {} as Record<string, string>,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
