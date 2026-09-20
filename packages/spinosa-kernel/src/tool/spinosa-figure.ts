import { Effect, Schema } from "effect"
import { spinosaFigure } from "@spinosa/core"
import * as Tool from "./tool"
import DESCRIPTION from "./spinosa-figure.txt"

const BarItem = Schema.Struct({
  label: Schema.String.annotate({ description: "Category label" }),
  value: Schema.Number.annotate({ description: "Non-negative finite value" }),
})

const StackedSegment = Schema.Struct({
  label: Schema.String.annotate({ description: "Segment label" }),
  value: Schema.Number.annotate({ description: "Non-negative finite value" }),
})

const StatusRow = Schema.Struct({
  label: Schema.String.annotate({ description: "Row label" }),
  cells: Schema.Array(
    Schema.Literals(["pass", "warning", "fail", "pending", "active"]).annotate({
      description: "pass, warning, fail, pending, or active",
    }),
  ).annotate({ description: "One cell per column" }),
})

export const Parameters = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("bar").annotate({ description: "Horizontal bars for category comparison or progress" }),
    title: Schema.String.annotate({ description: "Figure title inside the top border" }),
    caption: Schema.String.annotate({ description: "Plain-language description after the fenced block" }),
    source: Schema.String.annotate({ description: "Source path or description" }),
    units: Schema.String.annotate({ description: "Units for the plotted values" }),
    items: Schema.Array(BarItem).annotate({ description: "Bars from labels and values. Empty array renders a ? placeholder." }),
  }),
  Schema.Struct({
    kind: Schema.Literal("sparkline").annotate({ description: "Compact single-series trend" }),
    title: Schema.String.annotate({ description: "Figure title inside the top border" }),
    caption: Schema.String.annotate({ description: "Plain-language description after the fenced block" }),
    source: Schema.String.annotate({ description: "Source path or description" }),
    units: Schema.String.annotate({ description: "Units for the plotted values" }),
    values: Schema.Array(Schema.Number).annotate({ description: "Ordered finite values" }),
    label: Schema.optional(Schema.String.annotate({ description: "Series label" })),
  }),
  Schema.Struct({
    kind: Schema.Literal("stacked_bar").annotate({ description: "Part-to-whole composition, at most 4 segments" }),
    title: Schema.String.annotate({ description: "Figure title inside the top border" }),
    caption: Schema.String.annotate({ description: "Plain-language description after the fenced block" }),
    source: Schema.String.annotate({ description: "Source path or description" }),
    units: Schema.String.annotate({ description: "Units for the plotted values" }),
    segments: Schema.Array(StackedSegment).annotate({ description: "Segments from labels and values" }),
  }),
  Schema.Struct({
    kind: Schema.Literal("status_matrix").annotate({ description: "Multi-variable health grid" }),
    title: Schema.String.annotate({ description: "Figure title inside the top border" }),
    caption: Schema.String.annotate({ description: "Plain-language description after the fenced block" }),
    source: Schema.String.annotate({ description: "Source path or description" }),
    units: Schema.String.annotate({ description: "Units for the plotted values" }),
    columns: Schema.Array(Schema.String).annotate({ description: "Column headers" }),
    rows: Schema.Array(StatusRow).annotate({ description: "Rows of status cells matching columns" }),
  }),
])

export const SpinosaFigureTool = Tool.define(
  "spinosa_figure",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "spinosa_figure",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })
          const result = spinosaFigure(params)
          if (!result.ok) {
            return {
              title: "Figure refused",
              output: `spinosa_figure refused: ${result.reason}`,
              metadata: {} as Record<string, string>,
            }
          }
          return {
            title: params.title,
            output: result.markdown,
            metadata: {} as Record<string, string>,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
