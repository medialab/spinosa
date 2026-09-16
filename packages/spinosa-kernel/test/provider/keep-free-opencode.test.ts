import { describe, expect, test } from "bun:test"
import { keepFreeOpencodeModels } from "../../src/provider/custom-loaders-basic"

describe("keepFreeOpencodeModels", () => {
  test("keeps zero-cost models and drops paid ones", () => {
    const models = {
      free: { cost: { input: 0 } },
      paid: { cost: { input: 4 } },
    }
    keepFreeOpencodeModels(models)
    expect(Object.keys(models)).toEqual(["free"])
  })

  test("treats missing cost as free so autoload does not throw", () => {
    const models: Record<string, { cost?: { input?: number } }> = {
      legacy: {},
      paid: { cost: { input: 1 } },
    }
    keepFreeOpencodeModels(models)
    expect(Object.keys(models)).toEqual(["legacy"])
  })
})
