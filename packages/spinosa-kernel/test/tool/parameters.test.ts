import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { ToolJsonSchema } from "../../src/tool/json-schema"

// Each tool exports its parameters schema at module scope so this test can
// import them without running the tool's Effect-based init. The JSON Schema
// snapshot captures what the LLM sees; the parse assertions pin down the
// accepts/rejects contract. `ToolJsonSchema.fromSchema` is the same helper `session/
// prompt.ts` uses to emit tool schemas to the LLM, so the snapshots stay
// provider-compatible while tools use Effect Schema internally.

import { Parameters as ApplyPatch } from "../../src/tool/apply_patch"
import { Parameters as Edit } from "../../src/tool/edit"
import { Parameters as Glob } from "../../src/tool/glob"
import { Parameters as Grep } from "../../src/tool/grep"
import { Parameters as Invalid } from "../../src/tool/invalid"
import { Parameters as Lsp } from "../../src/tool/lsp"
import { Parameters as Plan } from "../../src/tool/plan"
import { Parameters as Question } from "../../src/tool/question"
import { Parameters as Read } from "../../src/tool/read"
import { Parameters as Report } from "../../src/tool/report"
import { Parameters as Shell } from "../../src/tool/shell"
import { Parameters as Skill } from "../../src/tool/skill"
import { Parameters as SpinosaFrame } from "../../src/tool/spinosa-frame"
import { Parameters as SpinosaGate } from "../../src/tool/spinosa-gate"
import { Parameters as SpinosaMintPaths } from "../../src/tool/spinosa-mint-paths"
import { Parameters as SpinosaMap } from "../../src/tool/spinosa-map"
import { Parameters as SpinosaFigure } from "../../src/tool/spinosa-figure"
import { Parameters as SpinosaRoute } from "../../src/tool/spinosa-route"
import { Parameters as SpinosaVerify } from "../../src/tool/spinosa-verify"
import { Parameters as Task } from "../../src/tool/task"
import { Parameters as Todo } from "../../src/tool/todo"
import { Parameters as WebFetch } from "../../src/tool/webfetch"
import { Parameters as WebSearch } from "../../src/tool/websearch"
import { Parameters as Write } from "../../src/tool/write"

const parse = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema)(input)

const accepts = (schema: Schema.Decoder<unknown>, input: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(input))

const toJsonSchema = ToolJsonSchema.fromSchema

describe("tool parameters", () => {
  describe("JSON Schema (wire shape)", () => {
    test("apply_patch", () => expect(toJsonSchema(ApplyPatch)).toMatchSnapshot())
    test("bash", () => expect(toJsonSchema(Shell)).toMatchSnapshot())
    test("edit", () => expect(toJsonSchema(Edit)).toMatchSnapshot())
    test("glob", () => expect(toJsonSchema(Glob)).toMatchSnapshot())
    test("grep", () => expect(toJsonSchema(Grep)).toMatchSnapshot())
    test("invalid", () => expect(toJsonSchema(Invalid)).toMatchSnapshot())
    test("lsp", () => expect(toJsonSchema(Lsp)).toMatchSnapshot())
    test("plan", () => expect(toJsonSchema(Plan)).toMatchSnapshot())
    test("question", () => expect(toJsonSchema(Question)).toMatchSnapshot())
    test("read", () => expect(toJsonSchema(Read)).toMatchSnapshot())
    test("write_report", () => expect(toJsonSchema(Report)).toMatchSnapshot())
    test("skill", () => expect(toJsonSchema(Skill)).toMatchSnapshot())
    test("spinosa_frame", () => expect(toJsonSchema(SpinosaFrame)).toMatchSnapshot())
    test("spinosa_gate", () => expect(toJsonSchema(SpinosaGate)).toMatchSnapshot())
    test("spinosa_mint_paths", () => expect(toJsonSchema(SpinosaMintPaths)).toMatchSnapshot())
    test("spinosa_map", () => expect(toJsonSchema(SpinosaMap)).toMatchSnapshot())
    test("spinosa_figure", () => expect(toJsonSchema(SpinosaFigure)).toMatchSnapshot())
    test("spinosa_route", () => expect(toJsonSchema(SpinosaRoute)).toMatchSnapshot())
    test("spinosa_verify", () => expect(toJsonSchema(SpinosaVerify)).toMatchSnapshot())
    test("task", () => expect(toJsonSchema(Task)).toMatchSnapshot())
    test("todo", () => expect(toJsonSchema(Todo)).toMatchSnapshot())
    test("webfetch", () => expect(toJsonSchema(WebFetch)).toMatchSnapshot())
    test("websearch", () => expect(toJsonSchema(WebSearch)).toMatchSnapshot())
    test("write", () => expect(toJsonSchema(Write)).toMatchSnapshot())

    test("inlines named child schemas for provider compatibility", () => {
      const schema = toJsonSchema(Question)
      expect(schema).not.toHaveProperty("$defs")
      expect(schema).toMatchObject({
        properties: {
          questions: { items: { properties: { options: { items: { properties: { label: { type: "string" } } } } } } },
        },
      })
    })

    test("preserves required nullable fields", () => {
      expect(toJsonSchema(Schema.Struct({ value: Schema.NullOr(Schema.String) }))).toMatchObject({
        properties: { value: { anyOf: expect.arrayContaining([{ type: "null" }]) } },
      })
    })

    test("keeps repeated allOf constraints instead of dropping duplicates", () => {
      expect(
        toJsonSchema(
          Schema.Struct({ value: Schema.String.check(Schema.isPattern(/^a/)).check(Schema.isPattern(/z$/)) }),
        ),
      ).toMatchObject({ properties: { value: { allOf: [{ pattern: "^a" }, { pattern: "z$" }] } } })
    })

    test("bounds bare integer fields to safe integer range", () => {
      expect(toJsonSchema(Schema.Struct({ value: Schema.Int }))).toMatchObject({
        properties: { value: { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER } },
      })
    })

    test("does not expose defaulted optional keys as nullable", () => {
      expect(toJsonSchema(WebFetch)).toMatchObject({
        properties: { format: { type: "string", enum: ["text", "markdown", "html"], default: "markdown" } },
      })
      expect(toJsonSchema(WebFetch).properties?.format).not.toHaveProperty("anyOf")
    })
  })

  describe("apply_patch", () => {
    test("accepts patchText", () => {
      expect(parse(ApplyPatch, { patchText: "*** Begin Patch\n*** End Patch" })).toEqual({
        patchText: "*** Begin Patch\n*** End Patch",
      })
    })
    test("rejects missing patchText", () => {
      expect(accepts(ApplyPatch, {})).toBe(false)
    })
    test("rejects non-string patchText", () => {
      expect(accepts(ApplyPatch, { patchText: 123 })).toBe(false)
    })
  })

  describe("shell", () => {
    test("accepts command", () => {
      expect(parse(Shell, { command: "ls" })).toEqual({ command: "ls" })
    })
    test("accepts optional timeout + workdir", () => {
      const parsed = parse(Shell, { command: "ls", timeout: 5000, workdir: "/tmp" })
      expect(parsed.timeout).toBe(5000)
      expect(parsed.workdir).toBe("/tmp")
    })
    test("rejects missing command", () => {
      expect(accepts(Shell, {})).toBe(false)
    })
  })

  describe("edit", () => {
    test("accepts all four fields", () => {
      expect(parse(Edit, { filePath: "/a", oldString: "x", newString: "y", replaceAll: true })).toEqual({
        filePath: "/a",
        oldString: "x",
        newString: "y",
        replaceAll: true,
      })
    })
    test("replaceAll is optional", () => {
      const parsed = parse(Edit, { filePath: "/a", oldString: "x", newString: "y" })
      expect(parsed.replaceAll).toBeUndefined()
    })
    test("rejects missing filePath", () => {
      expect(accepts(Edit, { oldString: "x", newString: "y" })).toBe(false)
    })
  })

  describe("glob", () => {
    test("accepts pattern-only", () => {
      expect(parse(Glob, { pattern: "**/*.ts" })).toEqual({ pattern: "**/*.ts" })
    })
    test("accepts optional path", () => {
      expect(parse(Glob, { pattern: "**/*.ts", path: "/tmp" }).path).toBe("/tmp")
    })
    test("rejects missing pattern", () => {
      expect(accepts(Glob, {})).toBe(false)
    })
  })

  describe("grep", () => {
    test("accepts pattern-only", () => {
      expect(parse(Grep, { pattern: "TODO" })).toEqual({ pattern: "TODO" })
    })
    test("accepts optional path + include", () => {
      const parsed = parse(Grep, { pattern: "TODO", path: "/tmp", include: "*.ts" })
      expect(parsed.path).toBe("/tmp")
      expect(parsed.include).toBe("*.ts")
    })
    test("rejects missing pattern", () => {
      expect(accepts(Grep, {})).toBe(false)
    })
  })

  describe("invalid", () => {
    test("accepts tool + error", () => {
      expect(parse(Invalid, { tool: "foo", error: "bar" })).toEqual({ tool: "foo", error: "bar" })
    })
    test("rejects missing fields", () => {
      expect(accepts(Invalid, { tool: "foo" })).toBe(false)
      expect(accepts(Invalid, { error: "bar" })).toBe(false)
    })
  })

  describe("lsp", () => {
    test("accepts all fields", () => {
      const parsed = parse(Lsp, { operation: "hover", filePath: "/a.ts", line: 1, character: 1 })
      expect(parsed.operation).toBe("hover")
    })
    test("rejects line < 1", () => {
      expect(accepts(Lsp, { operation: "hover", filePath: "/a.ts", line: 0, character: 1 })).toBe(false)
    })
    test("rejects character < 1", () => {
      expect(accepts(Lsp, { operation: "hover", filePath: "/a.ts", line: 1, character: 0 })).toBe(false)
    })
    test("rejects unknown operation", () => {
      expect(accepts(Lsp, { operation: "bogus", filePath: "/a.ts", line: 1, character: 1 })).toBe(false)
    })
  })

  describe("plan", () => {
    test("accepts empty object", () => {
      expect(parse(Plan, {})).toEqual({})
    })
  })

  describe("question", () => {
    test("accepts questions array", () => {
      const parsed = parse(Question, {
        questions: [
          {
            question: "pick one",
            header: "Header",
            custom: false,
            options: [{ label: "a", description: "desc" }],
          },
        ],
      })
      expect(parsed.questions.length).toBe(1)
    })
    test("rejects missing questions", () => {
      expect(accepts(Question, {})).toBe(false)
    })
  })

  describe("read", () => {
    test("accepts filePath-only", () => {
      expect(parse(Read, { filePath: "/a" }).filePath).toBe("/a")
    })
    test("accepts optional offset + limit", () => {
      const parsed = parse(Read, { filePath: "/a", offset: 10, limit: 100 })
      expect(parsed.offset).toBe(10)
      expect(parsed.limit).toBe(100)
    })
  })

  describe("skill", () => {
    test("accepts name", () => {
      expect(parse(Skill, { name: "foo" }).name).toBe("foo")
    })
    test("rejects missing name", () => {
      expect(accepts(Skill, {})).toBe(false)
    })
  })

  describe("spinosa_route", () => {
    test("accepts text + setupStatus", () => {
      const parsed = parse(SpinosaRoute, { text: "hi", setupStatus: "workspace_started" })
      expect(parsed.setupStatus).toBe("workspace_started")
    })
    test("rejects unknown setupStatus", () => {
      expect(accepts(SpinosaRoute, { text: "hi", setupStatus: "bogus" })).toBe(false)
    })
    test("rejects missing text", () => {
      expect(accepts(SpinosaRoute, { setupStatus: "unknown" })).toBe(false)
    })
  })

  describe("spinosa_frame", () => {
    const decision = {
      mode: "orchestrated", operation: "research", strategy: "targeted_evidence",
      scope: "subset", coverage: "sufficient", outputs: ["report"],
      mutation: "none", verification: "normal", evaluation: "always",
      reason: "test", confidence: 0.8,
    }
    test("accepts cleanedPrompt + orchestrated decision", () => {
      expect(parse(SpinosaFrame, { cleanedPrompt: "p", decision }).cleanedPrompt).toBe("p")
    })
    test("rejects a sentence-shaped strategy", () => {
      expect(accepts(SpinosaFrame, { cleanedPrompt: "p", decision: { ...decision, strategy: "targeted_evidence -> writer" } })).toBe(false)
    })
    test("rejects general-mode decision", () => {
      expect(accepts(SpinosaFrame, { cleanedPrompt: "p", decision: { mode: "general" } })).toBe(false)
    })
  })

  describe("spinosa_mint_paths", () => {
    test("accepts runID + kinds", () => {
      const parsed = parse(SpinosaMintPaths, { runID: "20260915-abc", kinds: ["goal", "evidence"] })
      expect(parsed.kinds).toEqual(["goal", "evidence"])
    })
    test("rejects unknown kind", () => {
      expect(accepts(SpinosaMintPaths, { runID: "20260915-abc", kinds: ["nope"] })).toBe(false)
    })
  })

  describe("spinosa_map", () => {
    test("accepts begin with batchId and files", () => {
      const parsed = parse(SpinosaMap, {
        action: "begin",
        batchId: "normandy-interviews-batch-001",
        files: ["raw/a.md"],
      })
      expect(parsed.action).toBe("begin")
    })
    test("rejects unknown action", () => {
      expect(accepts(SpinosaMap, { action: "explode" })).toBe(false)
    })
  })

  describe("spinosa_figure", () => {
    const meta = {
      title: "Coverage",
      caption: "North is larger.",
      source: "maps/corpus_overview.md",
      units: "files",
    }
    test("accepts a bar figure", () => {
      const parsed = parse(SpinosaFigure, {
        kind: "bar",
        ...meta,
        items: [{ label: "North", value: 4 }],
      })
      expect(parsed.kind).toBe("bar")
    })
    test("rejects an unknown kind", () => {
      expect(accepts(SpinosaFigure, { kind: "timeline", ...meta })).toBe(false)
    })
  })

  describe("spinosa_gate", () => {
    test("accepts coverage + sourceCount", () => {
      expect(parse(SpinosaGate, { coverage: "sufficient", sourceCount: 2 }).sourceCount).toBe(2)
    })
    test("rejects unknown coverage", () => {
      expect(accepts(SpinosaGate, { coverage: "total", sourceCount: 1 })).toBe(false)
    })
  })

  describe("write_report", () => {
    const report = {
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

    test("defaults status to draft", () => {
      expect(parse(Report, report).status).toBe("draft")
    })

    // The writer authors; only the verifier may promote a status. Accepting a
    // verdict here would let an agent self-declare verification.
    test("rejects a self-declared verified status", () => {
      expect(accepts(Report, { ...report, status: "pass" })).toBe(false)
      expect(accepts(Report, { ...report, status: "pass_with_corrections" })).toBe(false)
    })
  })

  describe("spinosa_verify", () => {
    test("accepts relativePath + validator", () => {
      const parsed = parse(SpinosaVerify, { relativePath: "agent_reports/01_x.md", validator: "report" })
      expect(parsed.validator).toBe("report")
    })
    test("rejects unknown validator", () => {
      expect(accepts(SpinosaVerify, { relativePath: "x.md", validator: "nope" })).toBe(false)
    })
  })

  describe("task", () => {
    test("accepts description + prompt + subagent_type", () => {
      const parsed = parse(Task, { description: "d", prompt: "p", subagent_type: "general" })
      expect(parsed.subagent_type).toBe("general")
    })
    test("accepts optional background flag", () => {
      const parsed = parse(Task, { description: "d", prompt: "p", subagent_type: "general", background: true })
      expect(parsed.background).toBe(true)
    })
    test("rejects missing prompt", () => {
      expect(accepts(Task, { description: "d", subagent_type: "general" })).toBe(false)
    })
  })

  describe("todo", () => {
    test("accepts todos array", () => {
      const parsed = parse(Todo, {
        todos: [{ id: "t1", content: "do x", status: "pending", priority: "medium" }],
      })
      expect(parsed.todos.length).toBe(1)
    })
    test("rejects missing todos", () => {
      expect(accepts(Todo, {})).toBe(false)
    })
  })

  describe("webfetch", () => {
    test("defaults omitted format to markdown", () => {
      expect(parse(WebFetch, { url: "https://example.com" })).toEqual({
        url: "https://example.com",
        format: "markdown",
      })
      expect(parse(WebFetch, { url: "https://example.com", format: undefined })).toEqual({
        url: "https://example.com",
        format: "markdown",
      })
    })
  })

  describe("websearch", () => {
    test("accepts query", () => {
      expect(parse(WebSearch, { query: "opencode" }).query).toBe("opencode")
    })
  })

  describe("write", () => {
    test("accepts content + filePath", () => {
      expect(parse(Write, { content: "hi", filePath: "/a" })).toEqual({ content: "hi", filePath: "/a" })
    })
    test("rejects missing filePath", () => {
      expect(accepts(Write, { content: "hi" })).toBe(false)
    })
  })
})
