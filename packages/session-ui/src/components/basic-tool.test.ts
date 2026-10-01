import { describe, expect, test } from "bun:test"
import { toolBubbleCopyText, toolBubbleTag } from "./basic-tool"

describe("toolBubbleTag", () => {
  test("maps known tools to short uppercase tags", () => {
    expect(toolBubbleTag("shell")).toBe("SHELL")
    expect(toolBubbleTag("bash")).toBe("SHELL")
    expect(toolBubbleTag("read")).toBe("READ")
    expect(toolBubbleTag("edit")).toBe("EDIT")
    expect(toolBubbleTag("apply_patch")).toBe("PATCH")
    expect(toolBubbleTag("task")).toBe("TASK")
  })

  test("falls back to a sanitized uppercase tag", () => {
    expect(toolBubbleTag("my-custom_tool")).toBe("MYCUSTOMTOOL")
    expect(toolBubbleTag("")).toBe("TOOL")
  })
})

describe("toolBubbleCopyText", () => {
  test("copies the exact shell command", () => {
    expect(toolBubbleCopyText("shell", { command: "ls -la" })).toBe("ls -la")
    expect(toolBubbleCopyText("bash", {}, { command: "pwd" })).toBe("pwd")
  })

  test("copies file paths for file tools", () => {
    expect(toolBubbleCopyText("read", { filePath: "notes.md" })).toBe("notes.md")
    expect(toolBubbleCopyText("edit", { path: "src/index.ts" })).toBe("src/index.ts")
  })

  test("copies search targets", () => {
    expect(toolBubbleCopyText("grep", { pattern: "todo", path: "src" })).toBe("todo in src")
    expect(toolBubbleCopyText("webfetch", { url: "https://example.com" })).toBe("https://example.com")
    expect(toolBubbleCopyText("websearch", { query: "solidjs" })).toBe("solidjs")
  })

  test("copies task descriptions and skill names", () => {
    expect(toolBubbleCopyText("task", { description: "Refactor billing" })).toBe("Refactor billing")
    expect(toolBubbleCopyText("skill", { name: "review" })).toBe("review")
  })

  test("returns empty string when nothing copyable", () => {
    expect(toolBubbleCopyText("todowrite", {})).toBe("")
    expect(toolBubbleCopyText("unknown-tool", {})).toBe("")
  })
})
