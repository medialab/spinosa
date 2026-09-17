import { describe, expect, test } from "bun:test"
import { deterministicRoute, heuristicAmbiguousRoute, type RouteInput } from "../src/router"

function input(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    text: "What does the corpus say about onboarding?",
    workspace: { isSpinosa: true, setupStatus: "workspace_started" },
    references: { fileCount: 0, hasSelectedRange: false, fileNames: [], mimeTypes: [] },
    ...overrides,
  }
}

describe("deterministicRoute startup precedence", () => {
  test("startup trigger wins over an explicit agent pin", () => {
    const decision = deterministicRoute(
      input({ text: "Run Spinosa startup indexing for this workspace.", explicitAgent: "build" }),
    )
    expect(decision).toMatchObject({ mode: "orchestrated", operation: "corpus", strategy: "startup_index" })
  })

  test("startup command wins over an explicit agent pin", () => {
    const decision = deterministicRoute(input({ text: "anything", command: "startup", explicitAgent: "build" }))
    expect(decision).toMatchObject({ mode: "orchestrated", operation: "corpus", strategy: "startup_index" })
  })

  test("non-startup text with an explicit agent stays general", () => {
    expect(deterministicRoute(input({ explicitAgent: "build" }))).toEqual({ mode: "general" })
  })

  test("ambiguous text without a pin needs the router model", () => {
    expect(deterministicRoute(input())).toBeUndefined()
  })

  test("non-Spinosa workspace stays general", () => {
    const decision = deterministicRoute(
      input({ text: "hello", workspace: { isSpinosa: false, setupStatus: "unknown" } }),
    )
    expect(decision).toEqual({ mode: "general" })
  })
})

describe("heuristicAmbiguousRoute fallback coverage", () => {
  test("research intents keep working", () => {
    expect(heuristicAmbiguousRoute("Find evidence about onboarding in the archive").mode).toBe("orchestrated")
    expect(heuristicAmbiguousRoute("hello there")).toEqual({ mode: "general" })
  })

  test("new-files requests route to corpus.add_sources", () => {
    const decision = heuristicAmbiguousRoute("I added new files to raw/, integrate them into the workspace corpus")
    expect(decision).toMatchObject({ mode: "orchestrated", operation: "corpus", strategy: "add_sources" })
  })

  test("hygiene requests route to maintenance", () => {
    expect(
      heuristicAmbiguousRoute("Clean up stale files in the workspace"),
    ).toMatchObject({ mode: "orchestrated", operation: "maintenance", strategy: "cleanup_proposal" })
    expect(
      heuristicAmbiguousRoute("Apply the cleanup: move stale files to .trash"),
    ).toMatchObject({ mode: "orchestrated", operation: "maintenance", strategy: "cleanup_apply" })
  })

  test("coverage questions route to meta.coverage_audit", () => {
    expect(
      heuristicAmbiguousRoute("What coverage gaps remain in the corpus maps?"),
    ).toMatchObject({ mode: "orchestrated", operation: "meta", strategy: "coverage_audit" })
  })
})
