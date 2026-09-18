import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { classifyPrompt, isStartupIndexingPrompt } from "../src"

const STARTUP_PROMPT = readFileSync(
  path.join(import.meta.dirname, "../../../workspace-template/startup-prompt.md"),
  "utf8",
)

describe("isStartupIndexingPrompt", () => {
  test("recognizes the workspace startup brief", () => {
    expect(isStartupIndexingPrompt(STARTUP_PROMPT)).toBe(true)
    expect(isStartupIndexingPrompt("Run Spinosa startup indexing for this workspace.")).toBe(true)
  })

  test("recognizes everyday index-this-workspace asks", () => {
    expect(isStartupIndexingPrompt("The user wants to index this workspace.")).toBe(true)
    expect(isStartupIndexingPrompt("Please index the workspace")).toBe(true)
    expect(isStartupIndexingPrompt("start indexing")).toBe(true)
  })

  test("ignores ordinary coverage audits", () => {
    expect(isStartupIndexingPrompt("Audit coverage gaps in the corpus")).toBe(false)
    expect(isStartupIndexingPrompt("What does the workspace index say about onboarding?")).toBe(false)
  })
})

describe("classifyPrompt startup guard", () => {
  test("does not route startup indexing through Q5/overseer", () => {
    expect(classifyPrompt(STARTUP_PROMPT)).toBe("fast_path")
    expect(classifyPrompt("Audit coverage gaps in the corpus")).toBe("Q5")
  })
})
