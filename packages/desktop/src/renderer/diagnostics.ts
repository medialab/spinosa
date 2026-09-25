import type { ElectronAPI, RendererDiagnostic } from "../preload/types"

type RendererDiagnosticBridge = Pick<Partial<ElectronAPI>, "recordRendererDiagnostic">

export function isExpectedNoActiveOnboardingJobMiss(input: {
  method: string
  path: string
  status: number
  body: unknown
}) {
  if (
    input.method.toUpperCase() !== "GET" ||
    input.path !== "/experimental/onboarding/active" ||
    input.status !== 404
  ) {
    return false
  }
  return typeof input.body === "object" && input.body !== null &&
    (("name" in input.body && input.body.name === "NotFoundError") ||
      ("_tag" in input.body && input.body._tag === "NotFound"))
}

export function sendRendererDiagnostic(
  bridge: RendererDiagnosticBridge,
  diagnostic: RendererDiagnostic,
): Promise<void> {
  const record = bridge.recordRendererDiagnostic
  if (typeof record !== "function") return Promise.resolve()
  return record(diagnostic)
}
