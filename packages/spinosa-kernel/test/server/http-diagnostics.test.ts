import { describe, expect, test } from "bun:test"
import {
  httpDiagnostic,
  shouldLogHttpFinish,
  shouldLogHttpStart,
} from "../../src/server/http-diagnostics"

describe("HTTP diagnostics", () => {
  test("keeps a validated request correlation ID and strips query data", () => {
    const diagnostic = httpDiagnostic(
      new Request("http://127.0.0.1:4096/api/session?token=secret", {
        headers: {
          "x-spinosa-request-id": "req-123",
          "x-spinosa-renderer-id": "renderer-123",
        },
      }),
    )
    expect(diagnostic.requestID).toBe("req-123")
    expect(diagnostic.rendererID).toBe("renderer-123")
    expect(diagnostic.path).toBe("/api/session")
  })

  test("generates a safe ID when the incoming header is invalid", () => {
    const diagnostic = httpDiagnostic(
      new Request("http://127.0.0.1:4096/global/health", {
        headers: { "x-spinosa-request-id": "not a valid id" },
      }),
    )
    expect(diagnostic.requestID).toMatch(/^[A-Za-z0-9._:-]{1,128}$/)
    expect(diagnostic.requestID).not.toBe("not a valid id")
  })

  test("suppresses routine reads but retains mutations, failures, and slow requests", () => {
    expect(shouldLogHttpStart("GET")).toBe(false)
    expect(shouldLogHttpStart("POST")).toBe(true)
    expect(shouldLogHttpFinish("GET", 200, 20)).toBe(false)
    expect(shouldLogHttpFinish("GET", 503, 20)).toBe(true)
    expect(shouldLogHttpFinish("GET", 200, 1_001)).toBe(true)
    expect(shouldLogHttpFinish("POST", 200, 20)).toBe(true)
  })
})
