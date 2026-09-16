import { describe, expect, test } from "bun:test"
import { ModelsDev } from "@spinosa/kernel-core/models-dev"
import { Provider } from "@/provider/provider"

const model = (id: string): ModelsDev.Model => ({
  id,
  name: id,
  release_date: "2026-01-01",
  attachment: false,
  reasoning: false,
  temperature: true,
  tool_call: true,
  cost: { input: 1, output: 1 },
  limit: { context: 1000, output: 100 },
})

const entry = (id: string, models: Record<string, ModelsDev.Model>): ModelsDev.Provider => ({
  id,
  name: id,
  env: [],
  models,
})

describe("defaultModelIDs", () => {
  test("skips providers with zero models instead of throwing", () => {
    expect(
      Provider.defaultModelIDs({
        empty: { models: {} },
        openai: { models: { "gpt-1": { id: "gpt-1" } } },
      }),
    ).toEqual({ openai: "gpt-1" })
  })
})

describe("buildCatalogProviders", () => {
  test("converts valid entries and skips malformed ones without failing the list", () => {
    const broken = {
      id: "m1",
      name: "m1",
      release_date: "2026-01-01",
      attachment: false,
      reasoning: false,
      temperature: false,
      tool_call: false,
    } as unknown as ModelsDev.Model
    const { providers, skipped } = Provider.buildCatalogProviders({
      catalog: {
        good: entry("good", { m1: model("m1") }),
        broken: entry("broken", { m1: broken }),
      },
    })
    expect(Object.keys(providers)).toEqual(["good"])
    expect(skipped).toEqual(["broken"])
    // The surviving catalog still yields defaults instead of throwing.
    expect(Provider.defaultModelIDs(providers)).toEqual({ good: "m1" })
  })

  test("keeps zero-model entries out of defaults without throwing", () => {
    const { providers, skipped } = Provider.buildCatalogProviders({
      catalog: { empty: entry("empty", {}) },
    })
    expect(Object.keys(providers)).toEqual(["empty"])
    expect(skipped).toEqual([])
    expect(Provider.defaultModelIDs(providers)).toEqual({})
  })
})

describe("evaluateProviderCatalogSmoke", () => {
  test("fails on a missing or empty snapshot", () => {
    expect(Provider.evaluateProviderCatalogSmoke(undefined)).toEqual({
      ok: false,
      error:
        "embedded models.dev snapshot is missing or empty (expected in dev runs — this gate targets release binaries)",
    })
    expect(Provider.evaluateProviderCatalogSmoke({}).ok).toBe(false)
  })

  test("fails when every entry is malformed", () => {
    const broken = { nope: true } as unknown as ModelsDev.Provider
    const result = Provider.evaluateProviderCatalogSmoke({ broken })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/zero providers/)
  })

  test("fails when providers exist but yield zero selectable defaults", () => {
    const result = Provider.evaluateProviderCatalogSmoke({ empty: entry("empty", {}) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/zero selectable defaults/)
  })

  test("passes a healthy catalog and reports counts", () => {
    const broken = { nope: true } as unknown as ModelsDev.Provider
    const result = Provider.evaluateProviderCatalogSmoke({
      good: entry("good", { m1: model("m1") }),
      broken,
    })
    expect(result).toEqual({ ok: true, providers: 1, skipped: ["broken"], defaults: 1 })
  })
})
