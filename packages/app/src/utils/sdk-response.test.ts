import { expect, test } from "bun:test"
import { sdkResponseData } from "./sdk-response"

test("unwraps SDK fields responses", () => {
  const data = { type: "text", content: "startup workflow" }

  expect(sdkResponseData<typeof data>({ data, request: new Request("http://localhost"), response: new Response() })).toBe(
    data,
  )
})

test("accepts SDK data-only responses", () => {
  const data = { all: [], connected: [], default: {} }

  expect(sdkResponseData<typeof data>(data)).toBe(data)
})

test("returns undefined for an empty SDK response", () => {
  expect(sdkResponseData(undefined)).toBeUndefined()
})
