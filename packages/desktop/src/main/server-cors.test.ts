import { describe, expect, test } from "bun:test"
import { desktopSidecarCorsOrigins } from "./server-cors"

describe("desktop sidecar CORS origins", () => {
  test("allows only the loopback renderer origin in development", () => {
    expect(
      desktopSidecarCorsOrigins({ packaged: false, rendererURL: "http://localhost:5173/index.html" }),
    ).toEqual(["http://localhost:5173"])
    expect(
      desktopSidecarCorsOrigins({ packaged: false, rendererURL: "https://example.com/renderer" }),
    ).toEqual([])
  })

  test("allows the packaged custom renderer origin", () => {
    expect(desktopSidecarCorsOrigins({ packaged: true })).toEqual(["oc://renderer"])
  })
})
