import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as path from "path"
import { FSUtil } from "@spinosa/kernel-core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"

const FILENAME_PATTERN = /^\d{2}_.+\.md$/

const Reproducibility = Schema.Struct({
  mapsAccessed: Schema.optional(Schema.Number).annotate({ description: "Number of maps accessed" }),
  grepPatterns: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Grep patterns used",
  }),
  globPatterns: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Glob patterns used",
  }),
  filesScanned: Schema.optional(Schema.Number).annotate({ description: "Files scanned" }),
  filesRead: Schema.optional(Schema.Number).annotate({ description: "Files read" }),
  searchRounds: Schema.optional(Schema.Number).annotate({ description: "Search rounds" }),
  agents: Schema.String.annotate({ description: "Agent chain" }),
  tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({ description: "Keywords/terms used" }),
  gaps: Schema.optional(Schema.String).annotate({ description: "Coverage gaps" }),
  sources: Schema.mutable(Schema.Array(Schema.String)).annotate({ description: "Source paths referenced" }),
})

export const Parameters = Schema.Struct({
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
type Parameters = Schema.Schema.Type<typeof Parameters>
type Metadata = { path: string; filename: string }

function formatArray(items: readonly string[] | undefined): string {
  if (!items || items.length === 0) return "—"
  if (items.length === 1) return items[0]!
  return `[${items.join(", ")}]`
}

function renderReport(params: Parameters): string {
  const now = new Date().toISOString().slice(0, 10)
  const r = params.reproducibility

  const lines: string[] = [
    "---",
    `type: report`,
    `created: ${now}`,
    `updated: ${now}`,
    `status: ${params.status}`,
    `scope: ${params.scope}`,
    `pipeline: ${params.pipeline}`,
    `query: ${params.query}`,
    "---",
    "",
    `# ${params.title}`,
    "",
    "## Goal",
    "",
    params.goal,
    "",
    "- - - - -",
    "",
    "## TLDR",
    "",
    params.tldr,
    "",
    "- - - - -",
    "",
    "## Report",
    "",
    params.report,
    "",
    "- - - - -",
    "",
    "## Conclusions",
    "",
    params.conclusions,
  ]

  if (params.serendipity) {
    lines.push("", "- - - - -", "", "## Serendipity", "", params.serendipity)
  }

  lines.push(
    "",
    "- - - - -",
    "",
    "## Reproducibility",
    "",
    "| Field   | Value |",
    "|---------|-------|",
    `| Query   | ${params.query} |`,
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

export const ReportTool = Tool.define<typeof Parameters, Metadata, FSUtil.Service>(
  "write_report",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    return {
      description: `Write a structured Spinosa report to agent_reports/ following the canonical report template. You provide the content for each section as free text; the tool assembles the YAML frontmatter, section headers, separators, and reproducibility table.

The report template includes: YAML frontmatter (type, dates, status, scope, pipeline, query), H1 title, Goal, TLDR, Report, Conclusions, optional Serendipity, and Reproducibility table with sources.

Use this tool to produce numbered agent_reports/NN_topic-slug.md files. Every required section must be non-empty. The filename must start with a 2-digit number followed by an underscore (e.g. 05_coastal-erosion.md).`,
      parameters: Parameters,
      execute: (params: Parameters, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          if (!FILENAME_PATTERN.test(params.filename)) {
            return {
              title: "Invalid filename",
              output: `Filename "${params.filename}" must match NN_{topic-slug}.md (e.g. 05_coastal-erosion.md).`,
              metadata: {} as Metadata,
            }
          }

          if (!params.goal.trim())
            return { title: "Validation failed", output: "Goal section is required.", metadata: {} as Metadata }
          if (!params.tldr.trim())
            return { title: "Validation failed", output: "TLDR section is required.", metadata: {} as Metadata }
          if (!params.report.trim())
            return { title: "Validation failed", output: "Report section is required.", metadata: {} as Metadata }
          if (!params.conclusions.trim())
            return {
              title: "Validation failed",
              output: "Conclusions section is required.",
              metadata: {} as Metadata,
            }

          const instance = yield* InstanceState.context
          const reportPath = path.join(instance.directory, "agent_reports", params.filename)
          yield* assertExternalDirectoryEffect(ctx, reportPath)

          const content = renderReport(params)

          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, reportPath)],
            always: ["*"],
            metadata: {
              filepath: reportPath,
            },
          })

          yield* fs.writeWithDirs(reportPath, content)

          return {
            title: params.filename,
            output: `Report written: agent_reports/${params.filename}`,
            metadata: { path: reportPath, filename: params.filename },
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
