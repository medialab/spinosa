import { describe, expect, test, mock } from "bun:test"
import type { ElectronAPI, RendererDiagnostic } from "../preload/types"
import { isExpectedNoActiveOnboardingJobMiss, sendRendererDiagnostic } from "./diagnostics"

const diagnostic: RendererDiagnostic = {
  event: "http.request",
  level: "error",
  correlationID: "request-1",
}

describe("desktop renderer diagnostics bridge", () => {
  test("continues when the running preload does not expose diagnostics yet", async () => {
    const legacyBridge: Pick<Partial<ElectronAPI>, "recordRendererDiagnostic"> = {}

    await expect(sendRendererDiagnostic(legacyBridge, diagnostic)).resolves.toBeUndefined()
  })

  test("forwards diagnostics to a current preload", async () => {
    const recordRendererDiagnostic = mock(async (_value: RendererDiagnostic) => {})
    const bridge = { recordRendererDiagnostic }

    await sendRendererDiagnostic(bridge, diagnostic)

    expect(recordRendererDiagnostic).toHaveBeenCalledWith(diagnostic)
  })
})

describe("expected onboarding lookup misses", () => {
  test("recognizes the kernel's tagged no-active-job response", () => {
    expect(
      isExpectedNoActiveOnboardingJobMiss({
        method: "GET",
        path: "/experimental/onboarding/active",
        status: 404,
        body: { _tag: "NotFound" },
      }),
    ).toBe(true)
  })

  test("recognizes only the typed no-active-job response", () => {
    expect(
      isExpectedNoActiveOnboardingJobMiss({
        method: "GET",
        path: "/experimental/onboarding/active",
        status: 404,
        body: { name: "NotFoundError" },
      }),
    ).toBe(true)
  })

  test("keeps unrelated 404s and onboarding failures as errors", () => {
    expect(
      isExpectedNoActiveOnboardingJobMiss({
        method: "GET",
        path: "/experimental/onboarding/active",
        status: 503,
        body: { name: "ServiceUnavailableError" },
      }),
    ).toBe(false)
    expect(
      isExpectedNoActiveOnboardingJobMiss({
        method: "GET",
        path: "/experimental/onboarding/active",
        status: 404,
        body: { message: "Unknown route" },
      }),
    ).toBe(false)
  })
})
