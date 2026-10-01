import { describe, expect, test } from "bun:test"
import {
  buildOptimisticSession,
  createPendingSessionID,
  partsToV2Prompt,
  resolvePromptDelivery,
  assistantPartGapBefore,
  steerControlLabel,
  toggleSteerDelivery,
  shouldNavigateBeforeCreate,
  shouldNavigateBeforePrepare,
  shouldSeedSessionBeforeNavigate,
  newSessionSubmitPhases,
  useV2SessionPrompt,
} from "../../src/util/session-prompt-v2"

describe("session-prompt-v2", () => {
  test("maps V1 parts into V2 PromptInput", () => {
    expect(
      partsToV2Prompt([
        { type: "text", text: "hello" },
        { type: "text", text: "ignored", ignored: true },
        { type: "file", url: "file:///tmp/a.png", filename: "a.png", mime: "image/png" },
        { type: "agent", name: "spinosa-generalist" },
      ]),
    ).toEqual({
      text: "hello",
      files: [{ uri: "file:///tmp/a.png", name: "a.png", mime: "image/png" }],
      agents: [{ name: "spinosa-generalist" }],
    })
  })

  test("defaults to V1 session prompt unless explicitly enabled", () => {
    const previous = process.env.SPINOSA_SESSION_V2_PROMPT
    try {
      delete process.env.SPINOSA_SESSION_V2_PROMPT
      expect(useV2SessionPrompt()).toBe(false)
      process.env.SPINOSA_SESSION_V2_PROMPT = "1"
      expect(useV2SessionPrompt()).toBe(true)
      process.env.SPINOSA_SESSION_V2_PROMPT = "0"
      expect(useV2SessionPrompt()).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.SPINOSA_SESSION_V2_PROMPT
      else process.env.SPINOSA_SESSION_V2_PROMPT = previous
    }
  })

  test("defaults mid-run delivery to queue", () => {
    expect(resolvePromptDelivery({ busy: true })).toBe("queue")
    expect(resolvePromptDelivery({ busy: true, preferSteer: true })).toBe("steer")
    expect(resolvePromptDelivery({ busy: true, preferQueue: true })).toBe("queue")
    expect(resolvePromptDelivery({ busy: false, preferQueue: true })).toBe("steer")
    expect(resolvePromptDelivery({ busy: true, requested: "steer" })).toBe("steer")
  })

  test("spaces tool rows after text or reasoning", () => {
    expect(assistantPartGapBefore(undefined, "tool")).toBe(0)
    expect(assistantPartGapBefore("tool", "tool")).toBe(0)
    expect(assistantPartGapBefore("text", "tool")).toBe(1)
    expect(assistantPartGapBefore("reasoning", "tool")).toBe(1)
    expect(assistantPartGapBefore("text", "text")).toBe(0)
    expect(assistantPartGapBefore("tool", "reasoning")).toBe(0)
  })

  test("steer control toggles waiting label and delivery", () => {
    expect(steerControlLabel({ delivery: "queue" })).toBe("Steer")
    expect(steerControlLabel({ delivery: "steer" })).toBe("waiting for steering")
    expect(steerControlLabel({ delivery: "queue", pending: "steer" })).toBe("waiting for steering")
    expect(steerControlLabel({ delivery: "steer", pending: "queue" })).toBe("Steer")
    expect(toggleSteerDelivery("queue")).toBe("steer")
    expect(toggleSteerDelivery("steer")).toBe("queue")
  })

  test("navigates after server create on new sessions only", () => {
    expect(shouldNavigateBeforePrepare(false)).toBe(true)
    expect(shouldNavigateBeforePrepare(true)).toBe(false)
    expect(shouldSeedSessionBeforeNavigate(false)).toBe(true)
    expect(shouldSeedSessionBeforeNavigate(true)).toBe(false)
    expect(shouldNavigateBeforeCreate(false)).toBe(false)
    expect(shouldNavigateBeforeCreate(true)).toBe(false)
    expect([...newSessionSubmitPhases()]).toEqual(["create", "seed", "navigate", "prepare", "prompt"])
  })

  test("buildOptimisticSession seeds a conversation-ready session", () => {
    const id = createPendingSessionID()
    expect(id.startsWith("ses_")).toBe(true)
    const session = buildOptimisticSession({
      id,
      directory: "/tmp/workspace",
      projectID: "proj_test",
      title: "  Hello  ",
    })
    expect(session.id).toBe(id)
    expect(session.directory).toBe("/tmp/workspace")
    expect(session.projectID).toBe("proj_test")
    expect(session.title).toBe("Hello")
    expect(session.version).toBeTruthy()
    expect(session.time.created).toBeGreaterThan(0)
  })
})
