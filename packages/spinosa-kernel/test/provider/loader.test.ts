import { describe, expect, test } from "bun:test"
import {
  createBundledSDK,
  factoryFromModule,
  googleVertexAnthropicBaseURL,
  invokeLanguageModel,
} from "@/provider/loader"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { Model } from "@/provider/provider"

const languageModel = {
  specificationVersion: "v3",
} as unknown as LanguageModelV3

describe("provider loader guards", () => {
  test("accepts direct and named provider factories", () => {
    const factory = () => ({ languageModel: () => languageModel })

    expect(factoryFromModule(factory, "test")).toBe(factory)
    expect(factoryFromModule({ createProvider: factory }, "test")).toBe(factory)
  })

  test("rejects modules without a create factory", () => {
    expect(() => factoryFromModule(null, "test")).toThrow("did not export a module")
    expect(() => factoryFromModule({ createProvider: "invalid" }, "test")).toThrow("has no create factory")
  })

  test("invokes function and object SDKs", () => {
    const functionSDK = () => languageModel
    const objectSDK = { languageModel: () => languageModel }

    expect(invokeLanguageModel(functionSDK, "model")).toBe(languageModel)
    expect(invokeLanguageModel(objectSDK, "model")).toBe(languageModel)
  })

  test("rejects SDKs that cannot create language models", () => {
    expect(() => invokeLanguageModel({}, "model")).toThrow("cannot create a language model")
  })

  test("validates the bundled SDK returned by a factory", () => {
    const model = {
      providerID: "test",
      api: { npm: "test" },
    } as unknown as Model
    const factory = () => ({ languageModel: () => languageModel })

    expect(createBundledSDK(factory, model, {})).toEqual({
      languageModel: expect.any(Function),
    })
    expect(() => createBundledSDK(() => ({}), model, {})).toThrow("did not return a language model factory")
  })
})

describe("provider URL descriptors", () => {
  test("builds only supported Google Vertex Anthropic regional URLs", () => {
    expect(googleVertexAnthropicBaseURL("project", "eu")).toBe(
      "https://aiplatform.eu.rep.googleapis.com/v1/projects/project/locations/eu/publishers/anthropic/models",
    )
    expect(googleVertexAnthropicBaseURL("project", "global")).toBeUndefined()
    expect(googleVertexAnthropicBaseURL(undefined, "eu")).toBeUndefined()
  })
})
