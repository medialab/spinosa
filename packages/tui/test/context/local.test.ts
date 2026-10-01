import { describe, expect, test } from "bun:test"
import {
  type ModelEntry,
  parseModel,
  parseStoredModel,
  recentModels,
  resolveModelPreference,
} from "../../src/context/local"

test("parses model IDs containing slashes", () => {
  expect(parseModel("provider/family/model")).toEqual({
    providerID: "provider",
    modelID: "family/model",
  })
})

test("moves a model to the front, deduplicates, and limits recents", () => {
  const recent = Array.from({ length: 12 }, (_, index) => ({
    providerID: "provider",
    modelID: `model-${index}`,
  }))

  expect(recentModels({ providerID: "provider", modelID: "model-5" }, recent)).toEqual([
    { providerID: "provider", modelID: "model-5" },
    ...recent.slice(0, 5),
    ...recent.slice(6, 10),
  ])
})

describe("parseStoredModel", () => {
  test("accepts a complete pair", () => {
    expect(parseStoredModel({ providerID: "anthropic", modelID: "claude-x" })).toEqual({
      providerID: "anthropic",
      modelID: "claude-x",
    })
  })

  test("rejects anything unusable rather than returning a half entry", () => {
    for (const value of [
      undefined,
      null,
      "anthropic/claude-x",
      42,
      {},
      { providerID: "anthropic" },
      { modelID: "claude-x" },
      { providerID: "", modelID: "claude-x" },
      { providerID: "anthropic", modelID: "" },
      { providerID: 1, modelID: 2 },
    ]) {
      expect(parseStoredModel(value)).toBeUndefined()
    }
  })
})

describe("resolveModelPreference", () => {
  const selected: ModelEntry = { providerID: "p", modelID: "selected" }
  const agent: ModelEntry = { providerID: "p", modelID: "agent" }
  const providerDefault: ModelEntry = { providerID: "p", modelID: "provider-default" }
  const all = () => true

  test("--model wins for the run that passed it", () => {
    const resolved = resolveModelPreference(
      { launch: "p/launch", selected, agent, config: "p/config", recent: [{ providerID: "p", modelID: "recent" }] },
      all,
    )
    expect(resolved).toEqual({ providerID: "p", modelID: "launch" })
  })

  test("the saved pick beats config, the agent, and recents", () => {
    const resolved = resolveModelPreference(
      { selected, agent, config: "p/config", recent: [{ providerID: "p", modelID: "recent" }], providerDefault },
      all,
    )
    expect(resolved).toEqual(selected)
  })

  test("config is the default only until the user has picked", () => {
    expect(resolveModelPreference({ config: "p/config", providerDefault }, all)).toEqual({
      providerID: "p",
      modelID: "config",
    })
    expect(resolveModelPreference({ selected, config: "p/config", providerDefault }, all)).toEqual(selected)
  })

  test("falls through the whole chain to the provider default", () => {
    expect(resolveModelPreference({ providerDefault }, all)).toEqual(providerDefault)
    expect(resolveModelPreference({}, all)).toBeUndefined()
  })

  test("skips a stale pick instead of leaving the session with no model", () => {
    const valid = (model: ModelEntry) => model.modelID !== "selected"
    const resolved = resolveModelPreference({ selected, config: "p/config", providerDefault }, valid)
    expect(resolved).toEqual({ providerID: "p", modelID: "config" })
  })

  test("uses the newest valid recent entry when nothing above it resolves", () => {
    const recent: ModelEntry[] = [
      { providerID: "p", modelID: "gone" },
      { providerID: "p", modelID: "still-here" },
    ]
    const resolved = resolveModelPreference({ recent, providerDefault }, (m) => m.modelID !== "gone")
    expect(resolved).toEqual({ providerID: "p", modelID: "still-here" })
  })
})
