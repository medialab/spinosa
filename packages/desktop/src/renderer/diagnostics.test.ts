import { describe, expect, test, mock } from "bun:test"
import type { ElectronAPI, RendererDiagnostic } from "../preload/types"
import { sendRendererDiagnostic } from "./diagnostics"

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
