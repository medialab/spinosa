import { describe, expect, test } from "bun:test"
import { Provider } from "@/provider/provider"

function info(overrides: Partial<Provider.Info> = {}): Provider.Info {
  return {
    id: "anthropic",
    name: "Anthropic",
    source: "api",
    env: ["ANTHROPIC_API_KEY"],
    options: {},
    models: {},
    ...overrides,
  } as Provider.Info
}

describe("Provider.toPublicInfo", () => {
  test("drops the provider key", () => {
    const publicInfo = Provider.toPublicInfo(info({ key: "sk-test-must-not-leak" }))
    expect(publicInfo.key).toBeUndefined()
    expect(JSON.stringify(publicInfo)).not.toContain("sk-test-must-not-leak")
  })

  test("drops credential-bearing options entries", () => {
    const publicInfo = Provider.toPublicInfo(
      info({
        options: {
          apiKey: "sk-option-must-not-leak",
          api_key: "sk-snake-must-not-leak",
          accessToken: "at-must-not-leak",
          refreshToken: "rt-must-not-leak",
          token: "tk-must-not-leak",
          password: "pw-must-not-leak",
          secret: "sc-must-not-leak",
          baseURL: "https://api.anthropic.com",
        },
      }),
    )
    expect(JSON.stringify(publicInfo)).not.toContain("must-not-leak")
    expect(publicInfo.options.baseURL).toBe("https://api.anthropic.com")
  })

  test("still clones structurally: functions dropped, source untouched", () => {
    const original = info({
      key: "sk-test-must-not-leak",
      options: { fetch: () => undefined, baseURL: "https://example.com" },
      models: { "claude-x": { id: "claude-x", name: "Claude X" } as Provider.Model },
    })
    const publicInfo = Provider.toPublicInfo(original)

    expect(publicInfo.options.fetch).toBeUndefined()
    expect(Object.keys(publicInfo.models)).toEqual(["claude-x"])
    expect(publicInfo.models["claude-x"]?.name).toBe("Claude X")
    // The redaction must not mutate the caller's provider, which still needs the key.
    expect(original.key).toBe("sk-test-must-not-leak")
    expect(typeof original.options.fetch).toBe("function")
  })
})
