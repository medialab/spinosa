export * as ReportTool from "./report"

import { ToolFailure } from "@spinosa/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { FileMutation } from "../file-mutation"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "spinosa_report"

export const Reproducibility = Schema.Struct({
  mapsAccessed: Schema.optional(Schema.Number).annotate({ description: "Number of maps accessed" }),
  grepPatterns: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Grep patterns used" }),
  globPatterns: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Glob patterns used" }),
  filesScanned: Schema.optional(Schema.Number).annotate({ description: "Files scanned" }),
  filesRead: Schema.optional(Schema.Number).annotate({ description: "Files read" }),
  searchRounds: Schema.optional(Schema.Number).annotate({ description: "Search rounds" }),
  agents: Schema.String.annotate({ description: "Agent chain" }),
  tags: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Keywords/terms used" }),
  gaps: Schema.optional(Schema.String).annotate({ description: "Coverage gaps" }),
  sources: Schema.Array(Schema.String).annotate({ description: "Source paths referenced" }),
})

export const Input = Schema.Struct({
  filename: Schema.String.annotate({
    description:
      "Report filename: NN_{topic-slug}.md (e.g. 05_coastal-erosion-normandy.md). Must start with a 2-digit number followed by an underscore.",
  }),
  title: Schema.String.annotate({ description: "H1 headline for the report (mirrors the goal statement)" }),
  scope: Schema.String.annotate({ description: "One-line description of the report scope" }),
  pipeline: Schema.String.annotate({
    description: "Agent chain, e.g. 'searcher → writer → verifier → evaluator'",
  }),
  query: Schema.String.annotate({ description: "Original user query" }),
  // Authoring cannot award a verdict: the writer has not checked any claim
  // against a source. Only the verifier promotes this, by editing the
  // frontmatter after recording a verification artifact.
  status: Schema.Literals(["draft"])
    .annotate({ description: "Always 'draft' — only the verifier may promote a report's status" })
    .pipe(Schema.withDecodingDefault(Effect.succeed("draft" as const))),
  goal: Schema.String.annotate({ description: "What the research aimed to answer" }),
  tldr: Schema.String.annotate({ description: "Short natural-language answer, 1–3 sentences" }),
  report: Schema.String.annotate({
    description: "Main body: evidence, interpretation, analysis, patterns. Structure freely with H2/H3.",
  }),
  conclusions: Schema.String.annotate({
    description:
      "Critical reflection: what we expected vs what we found, which assumptions held or broke, implications.",
  }),
  serendipity: Schema.optional(Schema.String).annotate({
    description: "Hidden connections and alternative viewpoints. Omit entirely when serendippo did not run.",
  }),
  reproducibility: Reproducibility,
})
export type Input = typeof Input.Type

export const Output = Schema.Struct({
  path: Schema.String,
  filename: Schema.String,
})
export type Output = typeof Output.Type

const FILENAME_PATTERN = /^\d{2}_.+\.md$/

function formatArray(items: readonly string[] | undefined): string {
  if (!items || items.length === 0) return "—"
  if (items.length === 1) return items[0]!
  return `[${items.join(", ")}]`
}

function renderReport(input: Input): string {
  const now = new Date().toISOString().slice(0, 10)
  const r = input.reproducibility

  const lines: string[] = [
    "---",
    `type: report`,
    `created: ${now}`,
    `updated: ${now}`,
    `status: ${input.status}`,
    `scope: ${input.scope}`,
    `pipeline: ${input.pipeline}`,
    `query: ${input.query}`,
    "---",
    "",
    `# ${input.title}`,
    "",
    "## Goal",
    "",
    input.goal,
    "",
    "- - - - -",
    "",
    "## TLDR",
    "",
    input.tldr,
    "",
    "- - - - -",
    "",
    "## Report",
    "",
    input.report,
    "",
    "- - - - -",
    "",
    "## Conclusions",
    "",
    input.conclusions,
  ]

  if (input.serendipity) {
    lines.push("", "- - - - -", "", "## Serendipity", "", input.serendipity)
  }

  lines.push(
    "",
    "- - - - -",
    "",
    "## Reproducibility",
    "",
    `| Field   | Value |`,
    `|---------|-------|`,
    `| Query   | ${input.query} |`,
    `| Maps    | ${r.mapsAccessed ?? "—"} |`,
    `| Grep    | ${formatArray(r.grepPatterns)} |`,
    `| Glob    | ${formatArray(r.globPatterns)} |`,
    `| Scanned | ${r.filesScanned ?? "—"} |`,
    `| Read    | ${r.filesRead ?? "—"} |`,
    `| Rounds  | ${r.searchRounds ?? "—"} |`,
    `| Agents  | ${r.agents} |`,
    `| Tags    | ${formatArray(r.tags)} |`,
    `| Gaps    | ${r.gaps ?? "—"} |`,
    "",
    `**Sources:** ${r.sources.join(", ")}`,
    "",
  )

  return lines.join("\n")
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description: `Write a structured Spinosa report to agent_reports/ following the canonical report template. You provide the content for each section as free text; the tool assembles the YAML frontmatter, section headers, separators, and reproducibility table.

The report template includes: YAML frontmatter (type, dates, status, scope, pipeline, query), H1 title, Goal, TLDR, Report, Conclusions, optional Serendipity, and Reproducibility table with sources.

Use this tool to produce numbered agent_reports/NN_topic-slug.md files. Every required section must be non-empty. The filename must start with a 2-digit number followed by an underscore (e.g. 05_coastal-erosion.md).`,
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: `Report written: ${output.path}` }],
            execute: (input, context) => {
              const toFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
                effect.pipe(
                  Effect.mapError(
                    () => new ToolFailure({ message: `Unable to write report to agent_reports/${input.filename}` }),
                  ),
                )

              return Effect.gen(function* () {
                const source = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }

                if (!FILENAME_PATTERN.test(input.filename)) {
                  return yield* new ToolFailure({
                    message: `Invalid filename "${input.filename}". Must match NN_{topic-slug}.md (e.g. 05_coastal-erosion.md).`,
                  })
                }

                if (!input.goal.trim()) return yield* new ToolFailure({ message: "Goal section is required." })
                if (!input.tldr.trim()) return yield* new ToolFailure({ message: "TLDR section is required." })
                if (!input.report.trim()) return yield* new ToolFailure({ message: "Report section is required." })
                if (!input.conclusions.trim())
                  return yield* new ToolFailure({ message: "Conclusions section is required." })

                const reportPath = `agent_reports/${input.filename}`
                const target = yield* toFailure(mutation.resolve({ path: reportPath, kind: "file" }))

                const external = target.externalDirectory
                if (external)
                  yield* toFailure(
                    permission.assert({
                      ...LocationMutation.externalDirectoryPermission(external),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source,
                    }),
                  )

                yield* toFailure(
                  permission.assert({
                    action: "edit",
                    resources: [target.resource],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  }),
                )

                const content = renderReport(input)

                yield* toFailure(files.writeTextPreservingBom({ target, content }))

                return { path: target.resource, filename: input.filename }
              })
            },
          }),
          "edit",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/report",
  layer,
  deps: [ToolRegistry.node, LocationMutation.node, FileMutation.node, PermissionV2.node],
})
