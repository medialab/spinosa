import { describe, expect, test } from "bun:test"
import {
  LOADING_PROVIDERS_VALUE,
  RETRY_PROVIDERS_VALUE,
  findFreeSpinosaDefault,
  normalizeCustomProviderID,
  providerCatalogStatus,
  providerOptions,
  providerStatusRows,
} from "../../../../src/component/dialog-provider"

describe("providerOptions", () => {
  test("includes a synthetic Other option for custom providers", () => {
    expect(providerOptions([{ id: "openai", name: "OpenAI" }]).at(-1)).toMatchObject({
      title: "Other",
      description: "Custom provider",
      category: "Providers",
    })
  })

  test("does not use Other as the generic provider category", () => {
    expect(providerOptions([{ id: "mistral", name: "Mistral" }])[0]?.category).toBe("Providers")
  })

  test("keeps popular providers first and sorts the rest alphabetically", () => {
    expect(
      providerOptions([
        { id: "openai", name: "OpenAI" },
        { id: "custom-z", name: "Zebra Provider" },
        { id: "anthropic", name: "Anthropic" },
        { id: "mistral", name: "Mistral" },
        { id: "aws", name: "AWS Bedrock" },
      ]).map((option) => option.value),
    ).toEqual(["openai", "anthropic", "aws", "mistral", "custom-z", "__opencode_custom_provider__"])
  })

  test("does not collide with a configured provider named other", () => {
    const values = providerOptions([{ id: "other", name: "Other Provider" }]).map((option) => option.value)
    expect(new Set(values).size).toBe(values.length)
  })

  test("normalizes and validates custom provider ids", () => {
    expect(normalizeCustomProviderID("  custom-provider  ")).toBe("custom-provider")
    expect(normalizeCustomProviderID("custom_provider")).toBe("custom_provider")
    expect(normalizeCustomProviderID("@ai-sdk/custom-provider")).toBe("custom-provider")
    expect(normalizeCustomProviderID("-custom-provider")).toBeUndefined()
    expect(normalizeCustomProviderID("Custom Provider")).toBeUndefined()
  })
})

describe("providerStatusRows", () => {
  test("shows a disabled loading row while the catalog loads", () => {
    expect(
      providerStatusRows({ loading: true, failed: false, retrying: false, onRetry: () => {} }),
    ).toEqual([
      {
        title: "Loading providers…",
        value: LOADING_PROVIDERS_VALUE,
        description: "Fetching the provider list",
        category: "Providers",
        disabled: true,
      },
    ])
  })

  test("loading takes precedence over a recorded failure", () => {
    const rows = providerStatusRows({ loading: true, failed: true, retrying: false, onRetry: () => {} })
    expect(rows.map((row) => row.value)).toEqual([LOADING_PROVIDERS_VALUE])
  })

  test("shows a retry row that triggers the reload callback", () => {
    let calls = 0
    const rows = providerStatusRows({
      loading: false,
      failed: true,
      retrying: false,
      onRetry: () => {
        calls += 1
      },
    })
    expect(rows.map((row) => row.value)).toEqual([RETRY_PROVIDERS_VALUE])
    expect(rows[0]?.disabled).not.toBe(true)
    rows[0]?.onSelect?.()
    expect(calls).toBe(1)
  })

  test("disables the retry row while a retry is in flight", () => {
    const rows = providerStatusRows({ loading: false, failed: true, retrying: true, onRetry: () => {} })
    expect(rows[0]).toMatchObject({ title: "Retrying…", disabled: true })
  })

  test("shows no status rows once the catalog is available", () => {
    expect(providerStatusRows({ loading: false, failed: false, retrying: false, onRetry: () => {} })).toEqual([])
  })
})

describe("providerCatalogStatus", () => {
  test("idle/loading with an empty catalog shows the spinner", () => {
    for (const catalog of ["idle", "loading"] as const) {
      expect(providerCatalogStatus({ catalog, catalogEmpty: true, providerError: undefined })).toEqual({
        loading: true,
        failed: false,
      })
    }
  })

  test("error with an empty catalog offers a retry", () => {
    expect(
      providerCatalogStatus({ catalog: "error", catalogEmpty: true, providerError: "boom" }),
    ).toEqual({ loading: false, failed: true })
  })

  test("config-providers failure after a /provider success still offers a retry", () => {
    // Bootstrap commit never runs in this combination, so the catalog is
    // still loading — but a recorded error alone must surface the retry row.
    expect(
      providerCatalogStatus({ catalog: "loading", catalogEmpty: true, providerError: "config failed" }),
    ).toEqual({ loading: true, failed: true })
    expect(
      providerCatalogStatus({ catalog: "error", catalogEmpty: true, providerError: undefined }),
    ).toEqual({ loading: false, failed: true })
  })

  test("ready with zero providers is a genuine empty catalog (no status row)", () => {
    expect(
      providerCatalogStatus({ catalog: "ready", catalogEmpty: true, providerError: undefined }),
    ).toEqual({ loading: false, failed: false })
  })

  test("non-empty catalogs never show status rows", () => {
    for (const catalog of ["idle", "loading", "ready", "error"] as const) {
      expect(providerCatalogStatus({ catalog, catalogEmpty: false, providerError: "boom" })).toEqual({
        loading: false,
        failed: false,
      })
    }
  })
})

describe("findFreeSpinosaDefault", () => {
  const free = { id: "grok-code", cost: { input: 0 }, status: "active" as const }
  const paid = { id: "paid-model", cost: { input: 5 }, status: "active" as const }

  test("prefers a connected free OpenCode model", () => {
    expect(
      findFreeSpinosaDefault({
        connected: [{ id: "opencode", models: { "grok-code": free, paid } }],
        catalog: [{ id: "opencode", models: { other: { id: "other", cost: { input: 0 } } } }],
      }),
    ).toEqual({ providerID: "opencode", modelID: "grok-code" })
  })

  test("uses the catalog when OpenCode is not connected", () => {
    expect(
      findFreeSpinosaDefault({
        connected: [{ id: "openai", models: { gpt: paid } }],
        catalog: [{ id: "opencode", models: { "grok-code": free } }],
      }),
    ).toEqual({ providerID: "opencode", modelID: "grok-code" })
  })

  test("skips deprecated free models", () => {
    expect(
      findFreeSpinosaDefault({
        catalog: [
          {
            id: "opencode",
            models: { old: { id: "old", cost: { input: 0 }, status: "deprecated" } },
          },
        ],
      }),
    ).toBeUndefined()
  })

  test("returns nothing when every OpenCode model is paid", () => {
    expect(
      findFreeSpinosaDefault({
        connected: [{ id: "opencode", models: { paid } }],
        catalog: [{ id: "opencode", models: { paid } }],
      }),
    ).toBeUndefined()
  })

  test("treats a missing cost as free", () => {
    expect(
      findFreeSpinosaDefault({
        catalog: [{ id: "opencode", models: { legacy: { id: "legacy" } } }],
      }),
    ).toEqual({ providerID: "opencode", modelID: "legacy" })
  })
})
