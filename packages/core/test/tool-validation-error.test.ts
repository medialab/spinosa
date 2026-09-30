import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import type { ToolCall } from "@spinosa/llm"
import { Tool } from "../src/tool/tool"
import { formatReportValidationError, Input as ReportInput } from "../src/tool/report"

const probe = Tool.make({
  description: "probe",
  input: Schema.Struct({ text: Schema.String }),
  output: Schema.Struct({ ok: Schema.Boolean }),
  execute: (input) => Effect.succeed({ ok: input.text.length > 0 }),
})

const hinted = Tool.make({
  description: "hinted probe",
  input: Schema.Struct({ text: Schema.String }),
  output: Schema.Struct({ ok: Schema.Boolean }),
  formatValidationError: (error) => `probe says: ${String(error)}`,
  execute: (input) => Effect.succeed({ ok: input.text.length > 0 }),
})

const call = (input: unknown) =>
  ({ type: "tool-call", id: "call-1", name: "probe", input }) as unknown as ToolCall
const context = {} as unknown as Tool.Context

const captureFailure = (schema: Schema.Codec<unknown, unknown, never, never>, input: unknown): unknown => {
  try {
    Schema.decodeUnknownSync(schema)(input)
  } catch (error) {
    return error
  }
  throw new Error("expected input to fail decoding")
}

const validReport = {
  filename: "01_topic.md",
  title: "T",
  scope: "s",
  pipeline: "searcher → writer",
  query: "q",
  goal: "g",
  tldr: "t",
  report: "body",
  conclusions: "c",
  reproducibility: { agents: "searcher → writer", sources: ["raw/a.pdf"] },
}

describe("tool input validation errors", () => {
  test("settles valid input", () => {
    const result = Effect.runSync(Tool.settle(probe, call({ text: "hi" }), context))
    expect(result.structured).toEqual({ ok: true })
  })

  test("keeps the raw message without a hook", () => {
    const failure = Effect.runSync(Tool.settle(probe, call({}), context).pipe(Effect.flip))
    expect(failure.message).toContain("Invalid tool input")
  })

  test("uses the hook message when provided", () => {
    const failure = Effect.runSync(Tool.settle(hinted, call({}), context).pipe(Effect.flip))
    expect(failure.message).toContain("probe says:")
    expect(failure.message).not.toContain("Invalid tool input")
  })
})

describe("report validation hints", () => {
  test("rejects array agents with a targeted hint", () => {
    const input = { ...validReport, reproducibility: { agents: ["searcher"], sources: ["raw/a.pdf"] } }
    expect(formatReportValidationError(captureFailure(ReportInput, input))).toContain("reproducibility.agents")
  })

  test("rejects string sources with a targeted hint", () => {
    const input = { ...validReport, reproducibility: { agents: "searcher", sources: "raw/a.pdf" } }
    expect(formatReportValidationError(captureFailure(ReportInput, input))).toContain("reproducibility.sources")
  })

  test("leaves unrelated errors untouched", () => {
    expect(formatReportValidationError(new Error("boom"))).toBe("Error: boom")
  })
})
