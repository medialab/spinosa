import { describe, expect, test } from "bun:test"
import { truthy, value } from "../src/flag/flag"

describe("legacy environment compatibility", () => {
  test("uses OPENCODE aliases when the SPINOSA variable is absent", () => {
    const env = { OPENCODE_CONFIG: "/legacy/config.json", OPENCODE_PURE: "true" }

    expect(value("SPINOSA_CONFIG", env)).toBe("/legacy/config.json")
    expect(truthy("SPINOSA_PURE", env)).toBe(true)
  })

  test("prefers SPINOSA variables over OPENCODE aliases", () => {
    const env = {
      SPINOSA_CONFIG: "/spinosa/config.json",
      OPENCODE_CONFIG: "/legacy/config.json",
      SPINOSA_PURE: "false",
      OPENCODE_PURE: "true",
    }

    expect(value("SPINOSA_CONFIG", env)).toBe("/spinosa/config.json")
    expect(truthy("SPINOSA_PURE", env)).toBe(false)
  })
})

describe("SPINOSA_DISABLE_MODELS_FETCH", () => {
  test("reads process.env at access time instead of module load", async () => {
    const { Flag } = await import("../src/flag/flag")
    const previous = Flag.SPINOSA_DISABLE_MODELS_FETCH
    const previousEnv = process.env.SPINOSA_DISABLE_MODELS_FETCH
    try {
      Flag.SPINOSA_DISABLE_MODELS_FETCH = undefined
      process.env.SPINOSA_DISABLE_MODELS_FETCH = "1"
      expect(Boolean(Flag.SPINOSA_DISABLE_MODELS_FETCH)).toBe(true)
      process.env.SPINOSA_DISABLE_MODELS_FETCH = "0"
      expect(Boolean(Flag.SPINOSA_DISABLE_MODELS_FETCH)).toBe(false)
      Flag.SPINOSA_DISABLE_MODELS_FETCH = true
      process.env.SPINOSA_DISABLE_MODELS_FETCH = "0"
      expect(Flag.SPINOSA_DISABLE_MODELS_FETCH).toBe(true)
    } finally {
      Flag.SPINOSA_DISABLE_MODELS_FETCH = previous
      if (previousEnv === undefined) delete process.env.SPINOSA_DISABLE_MODELS_FETCH
      else process.env.SPINOSA_DISABLE_MODELS_FETCH = previousEnv
    }
  })
})
