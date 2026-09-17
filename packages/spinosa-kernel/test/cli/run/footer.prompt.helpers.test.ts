import { describe, expect, test } from "bun:test"
import {
  clonePrompt,
  emptyPrompt,
  extractLineRange,
  parseSlashCommand,
  removeLineRange,
  selectedCommand,
  slashHead,
  slashQuery,
} from "@/cli/cmd/run/footer.prompt.helpers"
import type { RunPrompt } from "@/cli/cmd/run/types"

const prompt: RunPrompt = {
  text: "hello",
  parts: [],
  mode: "shell",
  command: { name: "build", arguments: "--fast" },
}

describe("run prompt helpers", () => {
  test("clonePrompt copies prompt metadata and parts", () => {
    const copy = clonePrompt(prompt)

    expect(copy).toEqual(prompt)
    expect(copy).not.toBe(prompt)
    expect(copy.parts).not.toBe(prompt.parts)
  })

  test("creates shell and regular empty prompts", () => {
    expect(emptyPrompt(true)).toEqual({ text: "", parts: [], mode: "shell" })
    expect(emptyPrompt(false)).toEqual({ text: "", parts: [] })
  })

  test("extracts and removes valid line ranges", () => {
    expect(extractLineRange("src/file.ts#4-8")).toEqual({
      base: "src/file.ts",
      line: { start: 4, end: 8 },
    })
    expect(extractLineRange("src/file.ts#4")).toEqual({
      base: "src/file.ts",
      line: { start: 4, end: undefined },
    })
    expect(extractLineRange("src/file.ts#bad")).toEqual({
      base: "src/file.ts",
    })
    expect(removeLineRange("src/file.ts#4-8")).toBe("src/file.ts")
    expect(removeLineRange("src/file.ts")).toBe("src/file.ts")
  })

  test("parses slash command heads and autocomplete queries", () => {
    expect(slashHead("/build --fast")).toEqual({
      name: "build",
      arguments: "--fast",
      end: 6,
    })
    expect(slashHead("/build")).toEqual({
      name: "build",
      arguments: "",
      end: 6,
    })
    expect(slashHead("build")).toBeUndefined()
    expect(slashQuery("/b", 2)).toBe("b")
    expect(slashQuery("/build ", 7)).toBeUndefined()
  })

  test("classifies slash commands from loaded command list", () => {
    const commands = [{ name: "build" }] as Parameters<typeof parseSlashCommand>[1]

    expect(parseSlashCommand("hello", commands)).toEqual({ type: "none" })
    expect(parseSlashCommand("/build --fast", undefined)).toEqual({
      type: "pending",
    })
    expect(parseSlashCommand("/unknown", commands)).toEqual({ type: "none" })
    expect(parseSlashCommand("/build --fast", commands)).toEqual({
      type: "command",
      command: { name: "build", arguments: "--fast" },
    })
    expect(selectedCommand("/build now", { name: "build", arguments: "old" })).toEqual({
      name: "build",
      arguments: "now",
    })
    expect(selectedCommand("/other", { name: "build", arguments: "old" })).toBeUndefined()
  })
})
