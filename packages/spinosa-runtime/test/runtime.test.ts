import { describe, expect, test } from "bun:test"
import { beginExecution, classifyPrompt, completeExecution, createResearchRun, nextExecution } from "../src"

describe("research runtime", () => {
  test("keeps greetings on the direct-chat path", () => {
    expect(classifyPrompt("Hi")).toBe("fast_path")
    expect(classifyPrompt("hello!")).toBe("fast_path")
    expect(classifyPrompt("analyze this corpus")).toBe("Q2")
  })

  test("keeps ordinary chat direct unless research intent is explicit", () => {
    expect(classifyPrompt("Can you help me?")).toBe("fast_path")
    expect(classifyPrompt("Write a function")).toBe("fast_path")
    expect(classifyPrompt("Good morning")).toBe("fast_path")
    expect(classifyPrompt("Fix this typo")).toBe("fast_path")
    expect(classifyPrompt("Compare these two arrays")).toBe("fast_path")
    expect(classifyPrompt("Archive this file")).toBe("fast_path")
    expect(classifyPrompt("Clean up these source files")).toBe("fast_path")
    expect(classifyPrompt("Show me the source code")).toBe("fast_path")

    expect(classifyPrompt("Compare the evidence in two source documents")).toBe("Q2")
    expect(classifyPrompt("Find source-grounded evidence for this topic")).toBe("Q1")
    expect(classifyPrompt("Show me evidence from the source documents")).toBe("Q1")
    expect(classifyPrompt("What does the corpus say about interviews?")).toBe("Q1")
    expect(classifyPrompt("Random quote retrieval")).toBe("Q1")
    expect(classifyPrompt("Search the archive for interviews")).toBe("Q1")
    expect(classifyPrompt("Find hidden connections across the sources")).toBe("Q3")
    expect(classifyPrompt("Hidden connections across the sources")).toBe("Q3")
    expect(classifyPrompt("Clean up stale research notes")).toBe("Q4")
    expect(classifyPrompt("Archive stale source notes")).toBe("Q4")
    expect(classifyPrompt("Audit coverage gaps in the corpus")).toBe("Q5")
    expect(classifyPrompt("What are we missing in the corpus?")).toBe("Q5")
  })

  test("runs the Q1 chain deterministically", () => {
    let run = createResearchRun({
      id: "run-1",
      workspacePath: "/tmp/workspace",
      prompt: "find evidence",
      route: "Q1",
      createdAt: "2026-07-27T00:00:00.000Z",
    })
    expect(nextExecution(run)?.agent).toBe("spinosa-searcher")
    run = beginExecution(run, "2026-07-27T00:01:00.000Z")
    expect(run.status).toBe("searching")
    run = completeExecution(run, "2026-07-27T00:02:00.000Z")
    expect(nextExecution(run)?.agent).toBe("spinosa-writer")
    run = completeExecution(run)
    run = completeExecution(run)
    run = completeExecution(run)
    expect(run.status).toBe("completed")
  })
})

